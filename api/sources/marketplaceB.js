// Mock adapter for Marketplace B

const prices = {
  'laptop-001': 1095,
  'phone-001': 899,
  'headphones-001': 295,
  'tablet-001': 419,
  'watch-001': 345,
  'cable-001': 11
};

async function getPrice(itemId) {
  await new Promise(r => setTimeout(r, 90 + Math.random() * 60));
  return prices[itemId] || 0;
}

module.exports = { getPrice };
