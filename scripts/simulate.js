/**
 * End-to-end CRE workflow simulation.
 * Requires the decision API to be running (npm run api).
 */

const API = 'http://localhost:3000';

const scenarios = [
  { name: "Fair purchase",     itemId: "laptop-001", price: 1100, sellerId: "seller-42",  expect: true },
  { name: "Overpriced",        itemId: "laptop-001", price: 2500, sellerId: "seller-42",  expect: false },
  { name: "Untrusted seller",  itemId: "laptop-001", price: 1000, sellerId: "seller-99",  expect: false },
  { name: "Low quality item",  itemId: "cable-001",  price: 25,   sellerId: "seller-200", expect: false },
  { name: "Good deal",         itemId: "headphones-001", price: 280, sellerId: "seller-100", expect: true },
  { name: "Cashback saves it", itemId: "phone-001",  price: 950,  sellerId: "seller-42",  expect: true }
];

async function evaluate(itemId, price, sellerId) {
  const res = await fetch(`${API}/evaluate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemId, price, sellerId })
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

async function run() {
  console.log('ValueOracle CRE Simulation\n');

  let passed = 0;

  for (const s of scenarios) {
    process.stdout.write(`  ${s.name.padEnd(22)}`);

    try {
      const d = await evaluate(s.itemId, s.price, s.sellerId);
      const ok = d.approved === s.expect;
      passed += ok ? 1 : 0;

      const tag = ok ? 'PASS' : 'FAIL';
      const verdict = d.approved ? 'approved' : 'rejected';
      const dealInfo = d.deal && (d.deal.cashback || d.deal.coupon || d.deal.shippingFee)
        ? `  eff=$${d.effectivePrice}` : '';
      const reviewInfo = d.seller.reviewStats
        ? `  reviews=${d.seller.reviewStats.count}(${d.seller.reviewStats.overall}/5)` : '';
      console.log(`${tag}  score=${d.valueScore}  ${verdict}  ref=$${d.referencePrice}${dealInfo}${reviewInfo}  "${d.reason}"`);
    } catch (err) {
      console.log(`ERR   ${err.message}`);
    }
  }

  // Review API check
  console.log('\nReview API:');
  try {
    const sellerRes = await fetch(`${API}/reviews/seller/seller-42`).then(r => r.json());
    const itemRes = await fetch(`${API}/reviews/item/laptop-001`).then(r => r.json());
    console.log(`  seller-42: ${sellerRes.reviews.length} reviews, avg ${sellerRes.stats.overall}/5`);
    console.log(`  laptop-001: ${itemRes.reviews.length} reviews`);
  } catch (err) {
    console.log(`  ERR: ${err.message}`);
  }

  console.log(`\n${passed}/${scenarios.length} passed`);
  process.exit(passed === scenarios.length ? 0 : 1);
}

fetch(`${API}/health`)
  .then(() => run())
  .catch(() => {
    console.error('Decision API not reachable. Start it with: npm run api');
    process.exit(1);
  });
