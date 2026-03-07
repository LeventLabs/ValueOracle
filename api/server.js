const express = require('express');
const cors = require('cors');
require('dotenv').config();
const marketplaceA = require('./sources/marketplaceA');
const marketplaceB = require('./sources/marketplaceB');
const marketplaceC = require('./sources/marketplaceC');
const sellerScore = require('./sources/sellerScore');

const app = express();
app.use(cors());
app.use(express.json());

// In-memory intent cache — agent stores purchase details offchain keyed by intentHash.
// CRE confidential workflow queries this instead of hardcoding purchase details.
const intentCache = new Map();

const WEIGHTS = {
  priceFairness: 0.35,
  qualitySignal: 0.25,
  sellerTrust: 0.25,
  valueRatio: 0.15
};

const THRESHOLDS = {
  approve: 70,
  caution: 40
};

// LLM-powered purchase analysis via Groq (LLaMA 3.3 70B).
// Adds natural-language reasoning to the rule-based value score.
// Gracefully skips if GROQ_API_KEY is not set.
async function getAIAnalysis({ itemId, price, effectivePrice, referencePrice, valueScore, verdict, seller, product, deal, breakdown }) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  const prompt = `You are a purchase advisor for autonomous AI agents. Analyze this purchase decision in 2-3 sentences.

Item: ${itemId}, Proposed: $${price}, Effective: $${effectivePrice} (after cashback/coupons/shipping), Market median: $${referencePrice}
Seller score: ${seller.score}/1.0 (${seller.totalSales} sales), Product: ${product.rating}/5 stars (${product.reviewCount} reviews, ${product.returnRate}% returns)
Deal: cashback=$${deal.cashback}, coupon=$${deal.coupon}, shipping=$${deal.shippingFee}
Score breakdown: price=${breakdown.priceFairness}, quality=${breakdown.qualitySignal}, trust=${breakdown.sellerTrust}, value=${breakdown.valueRatio}
Engine verdict: ${verdict} (score ${valueScore}/100)

Give a brief, actionable analysis. Be specific about why this is or isn't a good deal.`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 150,
        temperature: 0.3
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!res.ok) return null;
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.error('AI analysis failed:', err.message || err);
    return null;
  }
}

function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// Flag sources that deviate >40% from median — potential manipulation or stale data
function detectOutliers(sources, medianPrice) {
  const OUTLIER_THRESHOLD = 0.4;
  return sources.map(s => {
    const deviation = Math.abs(s.price - medianPrice) / medianPrice;
    return {
      ...s,
      outlier: deviation > OUTLIER_THRESHOLD,
      deviation: +(deviation * 100).toFixed(1)
    };
  });
}

function clamp(val, min = 0, max = 100) {
  return Math.max(min, Math.min(max, val));
}

function calculateValueScore({ proposedPrice, referencePrice, rating, reviewCount, returnRate, sellerScoreVal }) {
  const priceRatio = referencePrice / Math.max(proposedPrice, 1);
  const priceFairness = clamp(priceRatio * 100);

  const ratingScore = (rating / 5) * 50;
  const reviewScore = clamp(reviewCount / 10000, 0, 1) * 30;
  const returnScore = clamp((20 - returnRate) / 20, 0, 1) * 20;
  const qualitySignal = ratingScore + reviewScore + returnScore;

  const sellerTrust = sellerScoreVal * 100;

  const qualityPerDollar = (rating * 20) / (proposedPrice / referencePrice);
  const valueRatio = clamp(qualityPerDollar);

  const raw =
    priceFairness * WEIGHTS.priceFairness +
    qualitySignal * WEIGHTS.qualitySignal +
    sellerTrust * WEIGHTS.sellerTrust +
    valueRatio * WEIGHTS.valueRatio;

  return {
    valueScore: clamp(Math.round(raw)),
    breakdown: {
      priceFairness: Math.round(priceFairness),
      qualitySignal: Math.round(qualitySignal),
      sellerTrust: Math.round(sellerTrust),
      valueRatio: Math.round(valueRatio)
    }
  };
}

function buildReason(approved, breakdown, deviation, seller, productData, valueScore, sellerBlocked) {
  if (sellerBlocked) return `Seller trust critically low (${seller.score.toFixed(2)}/1.0) — blocked`;
  if (approved) return 'Fair price and trusted seller';
  if (breakdown.priceFairness < 50) return `Price ${deviation}% above market median`;
  if (breakdown.sellerTrust < 50) return `Seller trust too low (${seller.score.toFixed(2)}/1.0)`;
  if (breakdown.qualitySignal < 40) return `Low product quality (${productData.rating}/5, ${productData.returnRate}% returns)`;
  return `Value score ${valueScore}/100 below threshold`;
}

app.post('/evaluate', async (req, res) => {
  try {
    const { itemId, price, sellerId } = req.body;

    if (!itemId || price === undefined || price === null || !sellerId) {
      return res.status(400).json({ error: 'Missing required fields: itemId, price, sellerId' });
    }
    if (typeof price !== 'number' || price < 0) {
      return res.status(400).json({ error: 'Price must be a non-negative number' });
    }

    const [priceA, priceB, priceC, seller] = await Promise.all([
      marketplaceA.getPrice(itemId),
      marketplaceB.getPrice(itemId),
      marketplaceC.getPrice(itemId),
      sellerScore.getScore(sellerId)
    ]);

    const sources = [
      { name: 'marketplaceA', price: priceA },
      { name: 'marketplaceB', price: priceB },
      { name: 'marketplaceC', price: priceC }
    ].filter(s => s.price > 0);

    if (sources.length === 0) {
      return res.status(404).json({ error: 'Item not found in any marketplace' });
    }

    const referencePrice = median(sources.map(s => s.price));
    const sourcesWithOutliers = detectOutliers(sources, referencePrice);
    const outlierCount = sourcesWithOutliers.filter(s => s.outlier).length;
    const productData = marketplaceA.getProductData(itemId);
    const dealData = marketplaceA.getDealData(itemId);

    // Effective price = proposed - cashback - coupon + shipping
    const effectivePrice = price - dealData.cashback - dealData.coupon + dealData.shippingFee;

    const { valueScore, breakdown } = calculateValueScore({
      proposedPrice: effectivePrice,
      referencePrice,
      rating: productData.rating,
      reviewCount: productData.reviewCount,
      returnRate: productData.returnRate,
      sellerScoreVal: seller.score
    });

    // Hard-cut: reject if seller trust is critically low regardless of score
    const sellerBlocked = seller.score < 0.4;
    const approved = !sellerBlocked && valueScore >= THRESHOLDS.approve;
    const verdict = approved ? 'APPROVE' : valueScore >= THRESHOLDS.caution ? 'CAUTION' : 'REJECT';
    const deviation = ((effectivePrice - referencePrice) / referencePrice * 100).toFixed(1);
    const reason = buildReason(approved, breakdown, deviation, seller, productData, valueScore, sellerBlocked);

    // LLM analysis — runs in parallel, non-blocking, optional
    const aiAnalysis = await getAIAnalysis({
      itemId, price, effectivePrice, referencePrice, valueScore, verdict,
      seller, product: productData, deal: dealData, breakdown
    });

    res.json({
      approved, verdict, valueScore, referencePrice, reason, breakdown,
      sources: sourcesWithOutliers,
      outlierCount,
      effectivePrice: Math.round(effectivePrice),
      deal: dealData,
      product: { rating: productData.rating, reviewCount: productData.reviewCount, returnRate: productData.returnRate },
      seller: { score: seller.score, totalSales: seller.totalSales, reviewStats: seller.reviewStats || null },
      aiAnalysis
    });
  } catch (err) {
    console.error('POST /evaluate failed:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Confidential evaluation — receives plaintext offchain via Confidential HTTP.
// In production, this runs inside a CRE secure enclave. The intentHash links
// the offchain evaluation to the onchain commitment without revealing purchase details.
app.post('/evaluate-confidential', async (req, res) => {
  try {
    const { itemId, price, sellerId, intentHash } = req.body;

    if (!itemId || price === undefined || !sellerId || !intentHash) {
      return res.status(400).json({ error: 'Missing fields: itemId, price, sellerId, intentHash' });
    }

    const [priceA, priceB, priceC, seller] = await Promise.all([
      marketplaceA.getPrice(itemId),
      marketplaceB.getPrice(itemId),
      marketplaceC.getPrice(itemId),
      sellerScore.getScore(sellerId)
    ]);

    const sources = [
      { name: 'marketplaceA', price: priceA },
      { name: 'marketplaceB', price: priceB },
      { name: 'marketplaceC', price: priceC }
    ].filter(s => s.price > 0);

    if (sources.length === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }

    const referencePrice = median(sources.map(s => s.price));
    const sourcesWithOutliers = detectOutliers(sources, referencePrice);
    const productData = marketplaceA.getProductData(itemId);
    const dealData = marketplaceA.getDealData(itemId);
    const effectivePrice = price - dealData.cashback - dealData.coupon + dealData.shippingFee;

    const { valueScore, breakdown } = calculateValueScore({
      proposedPrice: effectivePrice,
      referencePrice,
      rating: productData.rating,
      reviewCount: productData.reviewCount,
      returnRate: productData.returnRate,
      sellerScoreVal: seller.score
    });

    const sellerBlocked = seller.score < 0.4;
    const approved = !sellerBlocked && valueScore >= THRESHOLDS.approve;
    const verdict = approved ? 'APPROVE' : valueScore >= THRESHOLDS.caution ? 'CAUTION' : 'REJECT';

    // Response is encrypted in transit via Confidential HTTP — only the oracle enclave sees it.
    // The onchain fulfillment only writes: (requestId, approved, referencePrice) — no purchase details.
    res.json({
      confidential: true,
      intentHash,
      approved, verdict, valueScore, referencePrice, breakdown,
      effectivePrice: Math.round(effectivePrice)
    });
  } catch (err) {
    console.error('POST /evaluate-confidential failed:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/reviews/seller/:sellerId', async (req, res) => {
  const score = await sellerScore.getScore(req.params.sellerId);
  const reviews = await sellerScore.getSellerReviews(req.params.sellerId);
  res.json({ sellerId: req.params.sellerId, reviews, stats: score.reviewStats });
});

app.get('/reviews/item/:itemId', (_req, res) => {
  const reviews = sellerScore.getItemReviews(_req.params.itemId);
  res.json({ itemId: _req.params.itemId, reviews });
});

// Cache purchase details offchain — agent calls this before submitting confidential tx.
// CRE workflow retrieves details by intentHash instead of hardcoding them.
app.post('/intent', (req, res) => {
  const { intentHash, itemId, price, sellerId } = req.body;
  if (!intentHash || !itemId || price === undefined || !sellerId) {
    return res.status(400).json({ error: 'Missing fields: intentHash, itemId, price, sellerId' });
  }
  intentCache.set(intentHash, { itemId, price, sellerId, timestamp: Date.now() });
  res.json({ cached: true, intentHash });
});

app.get('/intent/:intentHash', (req, res) => {
  const data = intentCache.get(req.params.intentHash);
  if (!data) return res.status(404).json({ error: 'Intent not found' });
  res.json(data);
});

app.get('/health', (_req, res) => {
  const rpc = process.env.SEPOLIA_RPC_URL ? 'set' : 'missing';
  const addr = process.env.CONTRACT_ADDRESS || 'missing';
  res.json({ status: 'ok', service: 'ValueOracle Decision Engine', chain: { rpc, contract: addr } });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`ValueOracle Decision Engine | port ${PORT}`);
});
