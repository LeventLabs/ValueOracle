const hre = require("hardhat");

// Sepolia MockKeystoneForwarder — used for CRE simulation
const MOCK_FORWARDER_SEPOLIA = "0x15fC6ae953E024d975e77382eEeC56A9101f9F88";

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);

  // Demo: deployer acts as oracle. In production, use Chainlink CRE node address.
  const PurchaseGuard = await hre.ethers.getContractFactory("PurchaseGuard");
  const contract = await PurchaseGuard.deploy(deployer.address, MOCK_FORWARDER_SEPOLIA);
  await contract.waitForDeployment();

  const addr = await contract.getAddress();
  console.log(`PurchaseGuard deployed: ${addr}`);
  console.log(`Forwarder: ${MOCK_FORWARDER_SEPOLIA}`);
  console.log(`\nCONTRACT_ADDRESS=${addr}`);
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
