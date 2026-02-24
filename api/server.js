const express = require('express');
const cors = require('cors');
const marketplaceA = require('./sources/marketplaceA');
const marketplaceB = require('./sources/marketplaceB');
const marketplaceC = require('./sources/marketplaceC');
const sellerScore = require('./sources/sellerScore');

const app = express();
app.use(cors());
app.use(express.json());

/**
 * Value Score Formula:
 * valueScore = priceFairness×0.35 + qualitySignal×0.25 + sellerTrust×0.25 + valueRatio×0.15
 * 
 * score >= 70 → APPROVE
 * 40-69       → CAUTION (still rejected for safety)
 * score < 40  → REJECT
 */
function calculateValueScore({ proposedPrice, referencePrice, rating, reviewCount, returnRate, sellerScoreVal }) {
  // Price Fairness (35%) - how close to market median
  const priceRatio = referencePrice / Math.max(proposedPrice, 1);
  const priceFairness = Math.min(priceRatio * 100, 100);

  // Quality Signal (25%) - product rating, reviews, return rate
  const ratingScore = (rating / 5) * 50;
  const reviewScore = Math.min(reviewCount / 10000, 1) * 30;
  const returnScore = Math.max(0, (20 - returnRate) / 20) * 20;
  const qualitySignal = ratingScore + reviewScore + returnScore;

  // Seller Trust (25%) - seller reputation
  const sellerTrust = sellerScoreVal * 100;

  // Value Ratio (15%) - quality-to-price ratio vs alternatives
  const qualityPerDollar = (rating * 20) / (proposedPrice / referencePrice);
  const valueRatio = Math.min(qualityPerDollar, 100);

  const valueScore = Math.round(
    priceFairness * 0.35 +
    qualitySignal * 0.25 +
    sellerTrust * 0.25 +
    valueRatio * 0.15
  );

  return {
    valueScore: Math.max(0, Math.min(100, valueScore)),
    breakdown: {
      priceFairness: Math.round(priceFairness),
      qualitySignal: Math.round(qualitySignal),
      sellerTrust: Math.round(sellerTrust),
      valueRatio: Math.round(valueRatio)
    }
  };
}

/**
 * Decision Engine API
 * Evaluates purchase requests using the 4-component Value Score formula
 */
app.post('/evaluate', async (req, res) => {
  try {
    const { itemId, price, sellerId } = req.body;

    if (!itemId || price === undefined || price === null || !sellerId) {
      return res.status(400).json({ error: 'Missing required fields: itemId, price, sellerId' });
    }

    if (typeof price !== 'number' || price < 0) {
      return res.status(400).json({ error: 'Price must be a non-negative number' });
    }

    // Fetch data from all sources in parallel
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

    // Calculate reference price (median)
    const prices = sources.map(s => s.price).sort((a, b) => a - b);
    const referencePrice = prices[Math.floor(prices.length / 2)];

    // Get product quality data
    const productData = marketplaceA.getProductData(itemId);

    // Calculate Value Score
    const { valueScore, breakdown } = calculateValueScore({
      proposedPrice: price,
      referencePrice,
      rating: productData.rating,
      reviewCount: productData.reviewCount,
      returnRate: productData.returnRate,
      sellerScoreVal: seller.score
    });

    // Decision based on Value Score
    let verdict, approved;
    if (valueScore >= 70) {
      verdict = 'APPROVE';
      approved = true;
    } else if (valueScore >= 40) {
      verdict = 'CAUTION';
      approved = false;
    } else {
      verdict = 'REJECT';
      approved = false;
    }

    // Build reason
    const deviation = ((price - referencePrice) / referencePrice * 100).toFixed(1);
    let reason;
    if (approved) {
      reason = 'Fair price and trusted seller';
    } else if (breakdown.priceFairness < 50) {
      reason = `Price ${deviation}% above market median — poor value`;
    } else if (breakdown.sellerTrust < 50) {
      reason = `Seller trust score too low (${seller.score.toFixed(2)}/1.0) — fraud risk`;
    } else if (breakdown.qualitySignal < 40) {
      reason = `Low product quality (${productData.rating}★, ${productData.returnRate}% returns)`;
    } else {
      reason = `Value score ${valueScore}/100 below approval threshold`;
    }

    res.json({
      approved,
      verdict,
      valueScore,
      referencePrice,
      reason,
      breakdown,
      sources,
      product: {
        rating: productData.rating,
        reviewCount: productData.reviewCount,
        returnRate: productData.returnRate
      },
      seller: {
        score: seller.score,
        totalSales: seller.totalSales
      }
    });

  } catch (error) {
    console.error('Evaluation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'ValueOracle Decision Engine' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🛡️  ValueOracle Decision Engine running on port ${PORT}`);
});
