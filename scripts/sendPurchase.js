// Send a PurchaseRequested tx on Sepolia for CRE simulate testing.
const hre = require("hardhat");

async function main() {
  const contractAddr = "0x22BEa4788e8AaFF94D3D575AA23Ec429AD198fFc";
  const PurchaseGuard = await hre.ethers.getContractAt("PurchaseGuard", contractAddr);

  const tx = await PurchaseGuard.requestPurchase("laptop-001", 1100, "seller-42");
  console.log(`Tx hash: ${tx.hash}`);

  const receipt = await tx.wait();
  console.log(`Block: ${receipt.blockNumber}`);
  console.log(`Status: ${receipt.status === 1 ? "success" : "failed"}`);
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
