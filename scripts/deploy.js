const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);

  // Demo: deployer acts as oracle. In production, use Chainlink CRE node address.
  const PurchaseGuard = await hre.ethers.getContractFactory("PurchaseGuard");
  const contract = await PurchaseGuard.deploy(deployer.address);
  await contract.waitForDeployment();

  const addr = await contract.getAddress();
  console.log(`PurchaseGuard deployed: ${addr}`);
  console.log(`\nCONTRACT_ADDRESS=${addr}`);
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
