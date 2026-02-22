/**
 * Mock Seller Reputation System
 */

const mockSellers = {
  'seller-42': { score: 0.85, totalSales: 1240 },
  'seller-99': { score: 0.30, totalSales: 45 },
  'seller-100': { score: 0.92, totalSales: 3500 },
  'seller-200': { score: 0.15, totalSales: 12 }
};

async function getScore(sellerId) {
  await new Promise(resolve => setTimeout(resolve, 80));
  return mockSellers[sellerId] || { score: 0.5, totalSales: 0 };
}

module.exports = { getScore };
