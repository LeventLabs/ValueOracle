/**
 * Mock Marketplace A - Simulates price + product quality data source
 */

const mockPrices = {
  'laptop-001': 1050,
  'phone-001': 850,
  'headphones-001': 280,
  'tablet-001': 450,
  'watch-001': 320,
  'cable-001': 10
};

const mockProducts = {
  'laptop-001': { rating: 4.7, reviewCount: 12400, returnRate: 2.1 },
  'phone-001': { rating: 4.5, reviewCount: 31000, returnRate: 1.8 },
  'headphones-001': { rating: 4.6, reviewCount: 8700, returnRate: 3.4 },
  'tablet-001': { rating: 4.3, reviewCount: 5600, returnRate: 4.2 },
  'watch-001': { rating: 4.1, reviewCount: 3200, returnRate: 5.1 },
  'cable-001': { rating: 2.8, reviewCount: 140, returnRate: 18.5 }
};

const defaultProduct = { rating: 3.0, reviewCount: 0, returnRate: 10.0 };

async function getPrice(itemId) {
  await new Promise(resolve => setTimeout(resolve, 100));
  return mockPrices[itemId] || 0;
}

function getProductData(itemId) {
  return mockProducts[itemId] || defaultProduct;
}

module.exports = { getPrice, getProductData };
