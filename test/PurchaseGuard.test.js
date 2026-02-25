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

  describe("submitReview", function () {
    let requestId;

    beforeEach(async function () {
      const tx = await guard.connect(agent).requestPurchase("laptop-001", 1100, "seller-42");
      requestId = await extractRequestId(tx);
      await guard.connect(oracle).fulfillOracleDecision(requestId, true, 1100);
    });

    it("allows requester to submit review for approved purchase", async function () {
      await expect(guard.connect(agent).submitReview(requestId, 5, 4, 5, "Great laptop"))
        .to.emit(guard, "ReviewSubmitted");

      const review = await guard.getReview(requestId);
      expect(review.qualityRating).to.equal(5);
      expect(review.deliveryRating).to.equal(4);
      expect(review.valueRating).to.equal(5);
      expect(review.reviewer).to.equal(agent.address);
    });

    it("increments item and seller review counts", async function () {
      await guard.connect(agent).submitReview(requestId, 4, 4, 4, "Solid");
      expect(await guard.getItemReviewCount("laptop-001")).to.equal(1);
      expect(await guard.getSellerReviewCount("seller-42")).to.equal(1);
    });

    it("reverts if not the original requester", async function () {
      await expect(guard.connect(owner).submitReview(requestId, 5, 5, 5, "fake"))
        .to.be.revertedWithCustomError(guard, "Unauthorized");
    });

    it("reverts for rejected purchases", async function () {
      const tx2 = await guard.connect(agent).requestPurchase("laptop-001", 2500, "seller-42");
      const id2 = await extractRequestId(tx2);
      await guard.connect(oracle).fulfillOracleDecision(id2, false, 1100);

      await expect(guard.connect(agent).submitReview(id2, 5, 5, 5, "nope"))
        .to.be.revertedWithCustomError(guard, "NotApproved");
    });

    it("reverts on double review", async function () {
      await guard.connect(agent).submitReview(requestId, 5, 4, 5, "first");
      await expect(guard.connect(agent).submitReview(requestId, 3, 3, 3, "second"))
        .to.be.revertedWithCustomError(guard, "AlreadyReviewed");
    });

    it("reverts on invalid rating", async function () {
      await expect(guard.connect(agent).submitReview(requestId, 0, 4, 5, "bad"))
        .to.be.revertedWithCustomError(guard, "InvalidRating");
      await expect(guard.connect(agent).submitReview(requestId, 5, 6, 5, "bad"))
        .to.be.revertedWithCustomError(guard, "InvalidRating");
    });
  });
});
