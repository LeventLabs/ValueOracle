/**
 * Mock Marketplace C - Simulates price data source
 */

const mockPrices = {
  'laptop-001': 1150,
  'phone-001': 920,
  'headphones-001': 310,
  'tablet-001': 480,
  'watch-001': 340
};

async function getPrice(itemId) {
  await new Promise(resolve => setTimeout(resolve, 90));
  return mockPrices[itemId] || 0;
}

module.exports = { getPrice };
