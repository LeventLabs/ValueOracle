const express = require('express');
const cors = require('cors');
const marketplaceA = require('./sources/marketplaceA');
const marketplaceB = require('./sources/marketplaceB');
const marketplaceC = require('./sources/marketplaceC');
const sellerScore = require('./sources/sellerScore');

const app = express();
app.use(cors());
app.use(express.json());

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

function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
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
    const productData = marketplaceA.getProductData(itemId);

    const { valueScore, breakdown } = calculateValueScore({
      proposedPrice: price,
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
    const deviation = ((price - referencePrice) / referencePrice * 100).toFixed(1);
    const reason = buildReason(approved, breakdown, deviation, seller, productData, valueScore, sellerBlocked);

    res.json({
      approved, verdict, valueScore, referencePrice, reason, breakdown, sources,
      product: { rating: productData.rating, reviewCount: productData.reviewCount, returnRate: productData.returnRate },
      seller: { score: seller.score, totalSales: seller.totalSales }
    });
  } catch (err) {
    console.error('POST /evaluate failed:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'ValueOracle Decision Engine' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`ValueOracle Decision Engine | port ${PORT}`);
});
