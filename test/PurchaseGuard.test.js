const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PurchaseGuard", function () {
  let guard, owner, oracle, agent;

  async function extractRequestId(tx) {
    const receipt = await tx.wait();
    const log = receipt.logs.find(l => {
      try { return guard.interface.parseLog(l).name === "PurchaseRequested"; }
      catch { return false; }
    });
    return guard.interface.parseLog(log).args.requestId;
  }

  beforeEach(async function () {
    [owner, oracle, agent] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("PurchaseGuard");
    guard = await Factory.deploy(oracle.address);
    await guard.waitForDeployment();
  });

  describe("requestPurchase", function () {
    it("emits PurchaseRequested and stores request", async function () {
      const tx = await guard.connect(agent).requestPurchase("laptop-001", 1100, "seller-42");
      const id = await extractRequestId(tx);

      const req = await guard.getRequest(id);
      expect(req.itemId).to.equal("laptop-001");
      expect(req.proposedPrice).to.equal(1100);
      expect(req.requester).to.equal(agent.address);
      expect(req.fulfilled).to.be.false;
    });

    it("generates unique ids for same params in same block", async function () {
      const tx1 = await guard.connect(agent).requestPurchase("laptop-001", 1100, "seller-42");
      const tx2 = await guard.connect(agent).requestPurchase("laptop-001", 1100, "seller-42");
      const id1 = await extractRequestId(tx1);
      const id2 = await extractRequestId(tx2);
      expect(id1).to.not.equal(id2);
    });
  });

  describe("fulfillOracleDecision", function () {
    let requestId;

    beforeEach(async function () {
      const tx = await guard.connect(agent).requestPurchase("laptop-001", 1100, "seller-42");
      requestId = await extractRequestId(tx);
    });

    it("approves and emits PurchaseApproved", async function () {
      await expect(guard.connect(oracle).fulfillOracleDecision(requestId, true, 1100))
        .to.emit(guard, "PurchaseApproved");

      const req = await guard.getRequest(requestId);
      expect(req.fulfilled).to.be.true;
      expect(req.approved).to.be.true;
    });

    it("rejects and emits PurchaseRejected", async function () {
      await expect(guard.connect(oracle).fulfillOracleDecision(requestId, false, 1100))
        .to.emit(guard, "PurchaseRejected");

      const req = await guard.getRequest(requestId);
      expect(req.approved).to.be.false;
    });

    it("reverts when called by non-oracle", async function () {
      await expect(guard.connect(agent).fulfillOracleDecision(requestId, true, 1100))
        .to.be.revertedWithCustomError(guard, "Unauthorized");
    });

    it("reverts on double fulfillment", async function () {
      await guard.connect(oracle).fulfillOracleDecision(requestId, true, 1100);
      await expect(guard.connect(oracle).fulfillOracleDecision(requestId, true, 1100))
        .to.be.revertedWithCustomError(guard, "AlreadyFulfilled");
    });
  });

  describe("access control", function () {
    it("owner can update oracle", async function () {
      await guard.connect(owner).setOracle(agent.address);
      expect(await guard.oracle()).to.equal(agent.address);
    });

    it("non-owner cannot update oracle", async function () {
      await expect(guard.connect(agent).setOracle(agent.address))
        .to.be.revertedWithCustomError(guard, "Unauthorized");
    });
  });
});
