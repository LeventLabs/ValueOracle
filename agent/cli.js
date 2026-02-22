#!/usr/bin/env node

const { Command } = require('commander');
const { ethers } = require('ethers');
require('dotenv').config();

const program = new Command();

program
  .name('valueoracle-agent')
  .description('AI Agent CLI for ValueOracle purchase requests')
  .version('1.0.0');

program
  .command('buy')
  .description('Submit purchase request to ValueOracle')
  .argument('<itemId>', 'Product identifier')
  .option('-p, --price <amount>', 'Proposed price', '1000')
  .option('-s, --seller <id>', 'Seller identifier', 'seller-42')
  .action(async (itemId, options) => {
    try {
      console.log('🤖 AI Agent initiating purchase...\n');
      console.log(`   Item: ${itemId}`);
      console.log(`   Price: $${options.price}`);
      console.log(`   Seller: ${options.seller}\n`);

      if (!process.env.CONTRACT_ADDRESS) {
        console.error('❌ CONTRACT_ADDRESS not set in .env');
        process.exit(1);
      }

      // Connect to contract
      const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
      const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
      
      const abi = [
        "function requestPurchase(string itemId, uint256 proposedPrice, string sellerId) returns (bytes32)",
        "event PurchaseRequested(bytes32 indexed requestId, string itemId, uint256 proposedPrice, string sellerId, address requester)",
        "event PurchaseApproved(bytes32 indexed requestId, uint256 referencePrice)",
        "event PurchaseRejected(bytes32 indexed requestId, uint256 referencePrice, string reason)"
      ];
      
      const contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, abi, wallet);

      console.log('📡 Submitting to PurchaseGuard contract...');
      const tx = await contract.requestPurchase(
        itemId,
        ethers.parseUnits(options.price, 0),
        options.seller
      );
      
      console.log(`   Transaction: ${tx.hash}`);
      console.log('   Waiting for confirmation...\n');
      
      const receipt = await tx.wait();
      console.log('✅ Request submitted onchain');
      console.log('⏳ Waiting for Chainlink CRE oracle response...\n');
      console.log('   (In production, oracle fulfills automatically)');
      console.log('   (For demo, run: npm run simulate)\n');

    } catch (error) {
      console.error('❌ Error:', error.message);
      process.exit(1);
    }
  });

program.parse();
