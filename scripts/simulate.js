/**
 * End-to-end simulation of ValueOracle flow
 * Simulates: Agent → Contract → Oracle → Decision
 */

const scenarios = [
  {
    name: "Fair Purchase",
    itemId: "laptop-001",
    price: 1100,
    sellerId: "seller-42",
    expectedResult: "✅ APPROVED"
  },
  {
    name: "Overpriced Item",
    itemId: "laptop-001",
    price: 2500,
    sellerId: "seller-42",
    expectedResult: "❌ REJECTED"
  },
  {
    name: "Untrusted Seller",
    itemId: "laptop-001",
    price: 1000,
    sellerId: "seller-99",
    expectedResult: "❌ REJECTED"
  }
];

async function simulateDecisionAPI(itemId, price, sellerId) {
  // Simulate API call to decision engine
  const response = await fetch('http://localhost:3000/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemId, price, sellerId })
  });
  return await response.json();
}

async function runSimulation() {
  console.log("🛡️  ValueOracle CRE Workflow Simulation\n");
  console.log("=" .repeat(60));

  for (const scenario of scenarios) {
    console.log(`\n📦 Scenario: ${scenario.name}`);
    console.log(`   Item: ${scenario.itemId}`);
    console.log(`   Proposed Price: $${scenario.price}`);
    console.log(`   Seller: ${scenario.sellerId}`);
    console.log(`   Expected: ${scenario.expectedResult}\n`);

    try {
      // Step 1: Agent submits request (simulated)
      console.log("   [1] Agent → PurchaseGuard.requestPurchase()");
      
      // Step 2: CRE workflow triggers (simulated)
      console.log("   [2] Chainlink CRE detects PurchaseRequested event");
      
      // Step 3: Decision engine evaluation
      console.log("   [3] CRE → Decision Engine API");
      const decision = await simulateDecisionAPI(
        scenario.itemId,
        scenario.price,
        scenario.sellerId
      );
      
      console.log(`   [4] Decision: ${decision.approved ? '✅ APPROVED' : '❌ REJECTED'}`);
      console.log(`       Reference Price: $${decision.referencePrice}`);
      console.log(`       Reason: ${decision.reason}`);
      console.log(`       Seller Score: ${decision.sellerScore.toFixed(2)}`);
      
      // Step 4: Oracle fulfills onchain (simulated)
      console.log("   [5] CRE → PurchaseGuard.fulfillOracleDecision()");
      
      const match = decision.approved === scenario.expectedResult.includes('APPROVED');
      console.log(`\n   Result: ${match ? '✅ PASS' : '❌ FAIL'}`);
      
    } catch (error) {
      console.error(`   ❌ Error: ${error.message}`);
    }
    
    console.log("   " + "-".repeat(56));
  }
  
  console.log("\n✅ Simulation complete");
  console.log("\nNote: This simulates the CRE workflow locally.");
  console.log("In production, Chainlink CRE handles steps 2-5 automatically.");
}

// Check if API is running
fetch('http://localhost:3000/health')
  .then(() => runSimulation())
  .catch(() => {
    console.error("❌ Decision API not running!");
    console.error("Start it with: npm run api");
    process.exit(1);
  });
