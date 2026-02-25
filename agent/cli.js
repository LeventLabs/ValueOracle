#!/usr/bin/env node

const { Command } = require('commander');
const { ethers } = require('ethers');
require('dotenv').config();

const ABI = [
  "function requestPurchase(string itemId, uint256 proposedPrice, string sellerId) returns (bytes32)",
  "function submitReview(bytes32 requestId, uint8 qualityRating, uint8 deliveryRating, uint8 valueRating, string comment)",
  "function getReview(bytes32 requestId) view returns (tuple(bytes32 requestId, address reviewer, uint8 qualityRating, uint8 deliveryRating, uint8 valueRating, string comment, uint256 timestamp))",
  "event PurchaseRequested(bytes32 indexed requestId, string itemId, uint256 proposedPrice, string sellerId, address requester)",
  "event PurchaseApproved(bytes32 indexed requestId, uint256 referencePrice)",
  "event PurchaseRejected(bytes32 indexed requestId, uint256 referencePrice, string reason)",
  "event ReviewSubmitted(bytes32 indexed requestId, string itemId, string sellerId, uint8 quality, uint8 delivery, uint8 value, address reviewer)"
];

function getContract() {
  const { SEPOLIA_RPC_URL, PRIVATE_KEY, CONTRACT_ADDRESS } = process.env;
  if (!CONTRACT_ADDRESS) throw new Error('CONTRACT_ADDRESS not set in .env');
  if (!SEPOLIA_RPC_URL) throw new Error('SEPOLIA_RPC_URL not set in .env');
  if (!PRIVATE_KEY) throw new Error('PRIVATE_KEY not set in .env');

  const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  return new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);
}

const program = new Command();
program.name('valueoracle-agent').version('1.0.0');

program
  .command('buy')
  .argument('<itemId>', 'Product identifier')
  .option('-p, --price <amount>', 'Proposed price', '1000')
  .option('-s, --seller <id>', 'Seller identifier', 'seller-42')
  .action(async (itemId, opts) => {
    console.log(`\nPurchase request: ${itemId} @ $${opts.price} from ${opts.seller}`);

    try {
      const contract = getContract();
      const tx = await contract.requestPurchase(itemId, ethers.parseUnits(opts.price, 0), opts.seller);
      console.log(`tx: ${tx.hash}`);

      const receipt = await tx.wait();
      console.log(`confirmed in block ${receipt.blockNumber}`);
      console.log('Waiting for oracle fulfillment...');
    } catch (err) {
      console.error(`Failed: ${err.message}`);
      process.exit(1);
    }
  });

program
  .command('review')
  .argument('<requestId>', 'Purchase request ID (bytes32 hash)')
  .option('-q, --quality <n>', 'Quality rating 1-5', '5')
  .option('-d, --delivery <n>', 'Delivery rating 1-5', '4')
  .option('-v, --value <n>', 'Value rating 1-5', '5')
  .option('-c, --comment <text>', 'Review comment', 'Good purchase')
  .action(async (requestId, opts) => {
    console.log(`\nSubmitting review for ${requestId}`);
    console.log(`  quality=${opts.quality} delivery=${opts.delivery} value=${opts.value}`);

    try {
      const contract = getContract();
      const tx = await contract.submitReview(requestId, opts.quality, opts.delivery, opts.value, opts.comment);
      console.log(`tx: ${tx.hash}`);

      const receipt = await tx.wait();
      console.log(`confirmed in block ${receipt.blockNumber}`);
      console.log('Review submitted onchain');
    } catch (err) {
      console.error(`Failed: ${err.message}`);
      process.exit(1);
    }
  });

program.parse();
