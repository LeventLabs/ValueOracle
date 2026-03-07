// Seller reputation service with onchain agent review integration.
// Reads reviews from PurchaseGuard contract on Sepolia when RPC is available,
// falls back to cached data otherwise.

const { ethers } = require('ethers');

const sellers = {
  'seller-42': { score: 0.85, totalSales: 1240 },
  'seller-99': { score: 0.30, totalSales: 45 },
  'seller-100': { score: 0.92, totalSales: 3500 },
  'seller-200': { score: 0.15, totalSales: 12 }
};

// Fallback review data — used when contract reads fail or no reviews exist onchain yet
const fallbackReviews = {
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

const REVIEW_ABI = [
  'function getSellerReviewCount(string sellerId) view returns (uint256)',
  'function sellerReviews(string sellerId, uint256 index) view returns (bytes32)',
  'function getReview(bytes32 requestId) view returns (tuple(bytes32 requestId, address reviewer, uint8 qualityRating, uint8 deliveryRating, uint8 valueRating, string comment, uint256 timestamp))'
];

let contract = null;

function getContract() {
  if (contract) return contract;
  const rpc = process.env.SEPOLIA_RPC_URL;
  const addr = process.env.CONTRACT_ADDRESS;
  if (!rpc || !addr) return null;

  try {
    const provider = new ethers.JsonRpcProvider(rpc);
    contract = new ethers.Contract(addr, REVIEW_ABI, provider);
    return contract;
  } catch {
    return null;
  }
}

// Simple TTL cache for onchain review fetches — avoids duplicate RPC calls
const reviewCache = new Map();
const CACHE_TTL = 30000; // 30 seconds

// Try reading reviews from onchain, fall back to cached data
async function fetchOnchainReviews(sellerId) {
  const cached = reviewCache.get(sellerId);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  const c = getContract();
  if (!c) return null;

  try {
    const count = await c.getSellerReviewCount(sellerId);
    const n = Number(count);
    if (n === 0) return null;

    // Read up to 10 most recent reviews to avoid excessive RPC calls
    const limit = Math.min(n, 10);
    const reviews = [];
    for (let i = n - limit; i < n; i++) {
      const reqId = await c.sellerReviews(sellerId, i);
      const r = await c.getReview(reqId);
      reviews.push({
        quality: Number(r.qualityRating),
        delivery: Number(r.deliveryRating),
        value: Number(r.valueRating),
        comment: r.comment,
        onchain: true
      });
    }
    reviewCache.set(sellerId, { data: reviews, ts: Date.now() });
    return reviews;
  } catch (err) {
    console.error(`Onchain review fetch failed for ${sellerId}:`, err.message);
    return null;
  }
}

const DEFAULT_SELLER = { score: 0.5, totalSales: 0 };

function computeReviewStats(reviews) {
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
  const base = sellers[sellerId] || DEFAULT_SELLER;

  // Try onchain first, fall back to cached reviews
  let reviews = await fetchOnchainReviews(sellerId);
  const source = reviews ? 'onchain' : 'cache';
  if (!reviews) reviews = fallbackReviews[sellerId] || [];

  const reviewStats = computeReviewStats(reviews);
  if (reviewStats) reviewStats.source = source;

  // Blend base reputation with agent review data (30% weight when reviews exist)
  let finalScore = base.score;
  if (reviewStats && reviewStats.count >= 1) {
    const reviewScore = reviewStats.overall / 5;
    const reviewWeight = Math.min(reviewStats.count * 0.1, 0.3);
    finalScore = base.score * (1 - reviewWeight) + reviewScore * reviewWeight;
  }

  return {
    score: +finalScore.toFixed(3),
    totalSales: base.totalSales,
    reviewStats
  };
}

async function getSellerReviews(sellerId) {
  const onchain = await fetchOnchainReviews(sellerId);
  return onchain || fallbackReviews[sellerId] || [];
}

function getItemReviews(itemId) {
  const results = [];
  for (const [sellerId, reviews] of Object.entries(fallbackReviews)) {
    for (const r of reviews) {
      if (r.item === itemId) results.push({ ...r, sellerId });
    }
  }
  return results;
}

module.exports = { getScore, computeReviewStats, getSellerReviews, getItemReviews };
