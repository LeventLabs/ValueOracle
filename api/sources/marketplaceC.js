// Mock adapter for Marketplace C

const prices = {
  'laptop-001': 1147,
  'phone-001': 923,
  'headphones-001': 312,
  'tablet-001': 478,
  'watch-001': 339,
  'cable-001': 13
};

async function getPrice(itemId) {
  await new Promise(r => setTimeout(r, 70 + Math.random() * 50));
  return prices[itemId] || 0;
}

module.exports = { getPrice };
