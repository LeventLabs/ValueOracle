// Mock seller reputation service with agent review integration

const sellers = {
  'seller-42': { score: 0.85, totalSales: 1240 },
  'seller-99': { score: 0.30, totalSales: 45 },
  'seller-100': { score: 0.92, totalSales: 3500 },
  'seller-200': { score: 0.15, totalSales: 12 }
};

// Onchain agent reviews (mock — in production, read from PurchaseGuard contract)
const agentReviews = {
  'seller-42': [
    { quality: 5, delivery: 4, value: 5, item: 'laptop-001' },
    { quality: 4, delivery: 5, value: 4, item: 'headphones-001' },
    { quality: 5, delivery: 5, value: 5, item: 'phone-001' }
  ],
  'seller-100': [
    { quality: 5, delivery: 5, value: 5, item: 'headphones-001' },
    { quality: 4, delivery: 4, value: 4, item: 'tablet-001' }
  ],
  'seller-99': [
    { quality: 2, delivery: 1, value: 1, item: 'laptop-001' }
  ]
};

const DEFAULT_SELLER = { score: 0.5, totalSales: 0 };

function getReviewStats(sellerId) {
  const reviews = agentReviews[sellerId];
  if (!reviews || reviews.length === 0) return null;

  const avg = (field) => reviews.reduce((s, r) => s + r[field], 0) / reviews.length;
  return {
    count: reviews.length,
    avgQuality: +avg('quality').toFixed(2),
    avgDelivery: +avg('delivery').toFixed(2),
    avgValue: +avg('value').toFixed(2),
    overall: +((avg('quality') + avg('delivery') + avg('value')) / 3).toFixed(2)
  };
}

async function getScore(sellerId) {
  await new Promise(r => setTimeout(r, 50 + Math.random() * 30));
  const base = sellers[sellerId] || DEFAULT_SELLER;
  const reviewStats = getReviewStats(sellerId);

  // Blend base reputation with agent review data (30% weight when reviews exist)
  let finalScore = base.score;
  if (reviewStats && reviewStats.count >= 1) {
    const reviewScore = reviewStats.overall / 5; // normalize to 0-1
    const reviewWeight = Math.min(reviewStats.count * 0.1, 0.3); // max 30% influence
    finalScore = base.score * (1 - reviewWeight) + reviewScore * reviewWeight;
  }

  return {
    score: +finalScore.toFixed(3),
    totalSales: base.totalSales,
    reviewStats
  };
}

function getSellerReviews(sellerId) {
  return agentReviews[sellerId] || [];
}

function getItemReviews(itemId) {
  const results = [];
  for (const [sellerId, reviews] of Object.entries(agentReviews)) {
    for (const r of reviews) {
      if (r.item === itemId) results.push({ ...r, sellerId });
    }
  }
  return results;
}

module.exports = { getScore, getReviewStats, getSellerReviews, getItemReviews };
