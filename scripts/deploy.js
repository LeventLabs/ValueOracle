const hre = require("hardhat");

async function main() {
  console.log("🚀 Deploying PurchaseGuard to Sepolia...");

  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  // For demo, use deployer as oracle (in production, use Chainlink CRE address)
  const oracleAddress = deployer.address;

  const PurchaseGuard = await hre.ethers.getContractFactory("PurchaseGuard");
  const contract = await PurchaseGuard.deploy(oracleAddress);

  await contract.waitForDeployment();
  const address = await contract.getAddress();

  console.log("✅ PurchaseGuard deployed to:", address);
  console.log("Oracle address:", oracleAddress);
  console.log("\nAdd to .env:");
  console.log(`CONTRACT_ADDRESS=${address}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
