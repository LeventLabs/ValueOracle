/**
 * Mock Marketplace A - Simulates price data source
 */

const mockPrices = {
  'laptop-001': 1050,
  'phone-001': 850,
  'headphones-001': 280,
  'tablet-001': 450,
  'watch-001': 320
};

async function getPrice(itemId) {
  // Simulate API delay
  await new Promise(resolve => setTimeout(resolve, 100));
  return mockPrices[itemId] || 0;
}

module.exports = { getPrice };
