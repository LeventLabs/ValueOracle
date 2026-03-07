// Seed onchain reviews on PurchaseGuard (Sepolia).
// Flow per review: requestPurchase → fulfillOracleDecision(approved) → submitReview
// Deployer is both requester and oracle (demo setup).

require('dotenv').config();
const { ethers } = require('ethers');

const ABI = [
  'function requestPurchase(string itemId, uint256 proposedPrice, string sellerId) returns (bytes32)',
  'function fulfillOracleDecision(bytes32 requestId, bool approved, uint256 referencePrice)',
  'function submitReview(bytes32 requestId, uint8 quality, uint8 delivery, uint8 value, string comment)',
  'event PurchaseRequested(bytes32 indexed requestId, string itemId, uint256 proposedPrice, string sellerId, address requester)',
  'event ReviewSubmitted(bytes32 indexed requestId, string itemId, string sellerId, uint8 quality, uint8 delivery, uint8 value, address reviewer)'
];

const reviews = [
  { item: 'laptop-001', price: 1100, seller: 'seller-42', ref: 1099, quality: 5, delivery: 4, value: 5, comment: 'Solid laptop, fast delivery' },
  { item: 'headphones-001', price: 280, seller: 'seller-100', ref: 570, quality: 4, delivery: 5, value: 5, comment: 'Great sound quality for the price' },
  { item: 'phone-001', price: 900, seller: 'seller-42', ref: 927, quality: 5, delivery: 5, value: 4, comment: 'Good phone, slightly overpriced but coupon helped' },
];

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, ABI, wallet);

  console.log(`Seeding ${reviews.length} onchain reviews on ${process.env.CONTRACT_ADDRESS}`);
  console.log(`Wallet: ${wallet.address}\n`);

  for (const r of reviews) {
    // Step 1: Request purchase
    const tx1 = await contract.requestPurchase(r.item, r.price, r.seller);
    const receipt1 = await tx1.wait();
    const event = receipt1.logs.find(l => l.topics.length > 1);
    const requestId = event.topics[1];
    console.log(`  [${r.item}] requestPurchase: ${requestId.slice(0, 14)}...`);

    // Step 2: Approve (deployer = oracle)
    const tx2 = await contract.fulfillOracleDecision(requestId, true, r.ref);
    await tx2.wait();
    console.log(`  [${r.item}] approved (ref=${r.ref})`);

    // Step 3: Submit review
    const tx3 = await contract.submitReview(requestId, r.quality, r.delivery, r.value, r.comment);
    await tx3.wait();
    console.log(`  [${r.item}] review submitted: ${r.quality}/${r.delivery}/${r.value} "${r.comment}"`);
    console.log('');
  }

  console.log(`Done — ${reviews.length} reviews seeded onchain.`);
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
