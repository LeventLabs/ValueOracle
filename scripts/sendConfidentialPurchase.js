// Send a ConfidentialPurchaseRequested tx on Sepolia for CRE simulate testing.
const hre = require("hardhat");

async function main() {
  const [signer] = await hre.ethers.getSigners();
  const contractAddr = "0x22BEa4788e8AaFF94D3D575AA23Ec429AD198fFc";

  const PurchaseGuard = await hre.ethers.getContractAt("PurchaseGuard", contractAddr);

  // Create an intent hash: keccak256(itemId, price, sellerId, salt)
  const salt = hre.ethers.randomBytes(32);
  const intentHash = hre.ethers.keccak256(
    hre.ethers.AbiCoder.defaultAbiCoder().encode(
      ["string", "uint256", "string", "bytes32"],
      ["laptop-001", 1100, "seller-42", salt]
    )
  );

  console.log(`Sender: ${signer.address}`);
  console.log(`Intent hash: ${intentHash}`);

  const tx = await PurchaseGuard.requestConfidentialPurchase(intentHash);
  console.log(`Tx hash: ${tx.hash}`);

  const receipt = await tx.wait();
  console.log(`Block: ${receipt.blockNumber}`);
  console.log(`Status: ${receipt.status === 1 ? "success" : "failed"}`);
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
