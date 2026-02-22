/**
 * Mock Marketplace B - Simulates price data source
 */

const mockPrices = {
  'laptop-001': 1100,
  'phone-001': 900,
  'headphones-001': 299,
  'tablet-001': 420,
  'watch-001': 350
};

async function getPrice(itemId) {
  await new Promise(resolve => setTimeout(resolve, 120));
  return mockPrices[itemId] || 0;
}

module.exports = { getPrice };
