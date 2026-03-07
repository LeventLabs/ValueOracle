// Marketplace B — DummyJSON Products API
// Falls back to cached prices if unreachable.

const DUMMYJSON_MAP = {
  'laptop-001': 1,    // maps to DummyJSON product ID
  'phone-001': 2,
  'headphones-001': 3,
  'tablet-001': 4,
  'watch-001': 6,
  'cable-001': 5
};

// Price multipliers — DummyJSON prices scaled to our domain
const SCALE = {
  'laptop-001': 110,
  'phone-001': 60,
  'headphones-001': 75,
  'tablet-001': 55,
  'watch-001': 50,
  'cable-001': 2
};

const fallbackPrices = {
  'laptop-001': 1095,
  'phone-001': 899,
  'headphones-001': 295,
  'tablet-001': 419,
  'watch-001': 345,
  'cable-001': 11
};

async function getPrice(itemId) {
  const productId = DUMMYJSON_MAP[itemId];
  if (!productId) return 0;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const res = await fetch(`https://dummyjson.com/products/${productId}`, {
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    // Use the real API price, scaled to our domain
    const scale = SCALE[itemId] || 1;
    return Math.round(data.price * scale);
  } catch (err) {
    // Fallback to cached price if API is down
    return fallbackPrices[itemId] || 0;
  }
}

module.exports = { getPrice };
