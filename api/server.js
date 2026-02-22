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
 * Decision Engine API
 * Evaluates purchase requests by aggregating market data
 */
app.post('/evaluate', async (req, res) => {
  try {
    const { itemId, price, sellerId } = req.body;

    if (!itemId || !price || !sellerId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Fetch prices from multiple sources
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

    // Decision logic
    const priceThreshold = referencePrice * 1.10;
    const sellerThreshold = 0.5;

    const isPriceFair = price <= priceThreshold;
    const isSellerTrusted = seller.score >= sellerThreshold;
    const approved = isPriceFair && isSellerTrusted;

    let reason = '';
    if (!isPriceFair) {
      const deviation = ((price - referencePrice) / referencePrice * 100).toFixed(1);
      reason = `Price exceeds market median by ${deviation}%`;
    } else if (!isSellerTrusted) {
      reason = `Seller trust score too low (${seller.score.toFixed(2)})`;
    } else {
      reason = 'Fair price and trusted seller';
    }

    res.json({
      approved,
      referencePrice,
      reason,
      sources,
      sellerScore: seller.score,
      sellerSales: seller.totalSales
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
