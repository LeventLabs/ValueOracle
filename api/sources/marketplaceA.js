// Mock adapter for Marketplace A (primary source — includes product metadata + deals)

const prices = {
  'laptop-001': 1049,
  'phone-001': 847,
  'headphones-001': 279,
  'tablet-001': 449,
  'watch-001': 318,
  'cable-001': 9
};

const products = {
  'laptop-001': { rating: 4.7, reviewCount: 12400, returnRate: 2.1 },
  'phone-001': { rating: 4.5, reviewCount: 31000, returnRate: 1.8 },
  'headphones-001': { rating: 4.6, reviewCount: 8700, returnRate: 3.4 },
  'tablet-001': { rating: 4.3, reviewCount: 5600, returnRate: 4.2 },
  'watch-001': { rating: 4.1, reviewCount: 3200, returnRate: 5.1 },
  'cable-001': { rating: 2.8, reviewCount: 140, returnRate: 18.5 }
};

const deals = {
  'laptop-001': { cashback: 52, coupon: 0, shippingFee: 0 },
  'phone-001': { cashback: 0, coupon: 40, shippingFee: 0 },
  'headphones-001': { cashback: 14, coupon: 0, shippingFee: 8 },
  'tablet-001': { cashback: 0, coupon: 0, shippingFee: 15 },
  'watch-001': { cashback: 0, coupon: 25, shippingFee: 12 },
  'cable-001': { cashback: 0, coupon: 0, shippingFee: 5 }
};

const DEFAULT_PRODUCT = { rating: 3.0, reviewCount: 0, returnRate: 10.0 };
const DEFAULT_DEAL = { cashback: 0, coupon: 0, shippingFee: 0 };

async function getPrice(itemId) {
  await new Promise(r => setTimeout(r, 80 + Math.random() * 40));
  return prices[itemId] || 0;
}

function getProductData(itemId) {
  return products[itemId] || DEFAULT_PRODUCT;
}

function getDealData(itemId) {
  return deals[itemId] || DEFAULT_DEAL;
}

module.exports = { getPrice, getProductData, getDealData };
