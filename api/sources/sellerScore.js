// Mock seller reputation service

const sellers = {
  'seller-42': { score: 0.85, totalSales: 1240 },
  'seller-99': { score: 0.30, totalSales: 45 },
  'seller-100': { score: 0.92, totalSales: 3500 },
  'seller-200': { score: 0.15, totalSales: 12 }
};

const DEFAULT_SELLER = { score: 0.5, totalSales: 0 };

async function getScore(sellerId) {
  await new Promise(r => setTimeout(r, 50 + Math.random() * 30));
  return sellers[sellerId] || DEFAULT_SELLER;
}

module.exports = { getScore };
