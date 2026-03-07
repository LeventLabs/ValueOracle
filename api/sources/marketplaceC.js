// Marketplace C adapter — uses FakeStoreAPI as a real external source.
// Maps item categories to FakeStoreAPI product searches.
// Falls back to cached prices if the API is unreachable.

const FAKESTORE_MAP = {
  'laptop-001': 9,     // WD 2TB Elements (electronics) — scaled to laptop range
  'phone-001': 10,     // SanDisk SSD (electronics) — scaled to phone range
  'headphones-001': 12, // WD 4TB Gaming Drive (electronics)
  'tablet-001': 11,    // Silicon Power SSD (electronics)
  'watch-001': 6,      // Solid Gold Petite Micropave (jewelery)
  'cable-001': 8       // Pierced Owl Rose Gold (jewelery) — low price item
};

// Scale FakeStoreAPI prices to our marketplace domain range.
const SCALE = {
  'laptop-001': 18,
  'phone-001': 8.5,
  'headphones-001': 5,
  'tablet-001': 8,
  'watch-001': 2,
  'cable-001': 1.2
};

const fallbackPrices = {
  'laptop-001': 1147,
  'phone-001': 923,
  'headphones-001': 312,
  'tablet-001': 478,
  'watch-001': 339,
  'cable-001': 13
};

async function getPrice(itemId) {
  const productId = FAKESTORE_MAP[itemId];
  if (!productId) return 0;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const res = await fetch(`https://fakestoreapi.com/products/${productId}`, {
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const scale = SCALE[itemId] || 1;
    return Math.round(data.price * scale);
  } catch (err) {
    return fallbackPrices[itemId] || 0;
  }
}

module.exports = { getPrice };
