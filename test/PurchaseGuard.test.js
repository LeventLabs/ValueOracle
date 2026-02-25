const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PurchaseGuard", function () {
  let guard, owner, oracle, agent;

  async function extractRequestId(tx, eventName) {
    const receipt = await tx.wait();
    const log = receipt.logs.find(l => {
      try { return guard.interface.parseLog(l).name === eventName; }
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
      const id = await extractRequestId(tx, "PurchaseRequested");

      const req = await guard.getRequest(id);
      expect(req.itemId).to.equal("laptop-001");
      expect(req.proposedPrice).to.equal(1100);
      expect(req.requester).to.equal(agent.address);
      expect(req.fulfilled).to.be.false;
    });

    it("generates unique ids for same params in same block", async function () {
      const tx1 = await guard.connect(agent).requestPurchase("laptop-001", 1100, "seller-42");
      const tx2 = await guard.connect(agent).requestPurchase("laptop-001", 1100, "seller-42");
      const id1 = await extractRequestId(tx1, "PurchaseRequested");
      const id2 = await extractRequestId(tx2, "PurchaseRequested");
      expect(id1).to.not.equal(id2);
    });
  });

  describe("fulfillOracleDecision", function () {
    let requestId;

    beforeEach(async function () {
      const tx = await guard.connect(agent).requestPurchase("laptop-001", 1100, "seller-42");
      requestId = await extractRequestId(tx, "PurchaseRequested");
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
      requestId = await extractRequestId(tx, "PurchaseRequested");
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
      const id2 = await extractRequestId(tx2, "PurchaseRequested");
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

  describe("confidential purchase", function () {
    const salt = ethers.hexlify(ethers.randomBytes(32));
    let intentHash;

    beforeEach(function () {
      intentHash = ethers.solidityPackedKeccak256(
        ['string', 'uint256', 'string', 'bytes32'],
        ["laptop-001", 1100, "seller-42", salt]
      );
    });

    it("stores commitment without revealing purchase details", async function () {
      const tx = await guard.connect(agent).requestConfidentialPurchase(intentHash);
      const id = await extractRequestId(tx, "ConfidentialPurchaseRequested");

      const req = await guard.getConfidentialRequest(id);
      expect(req.intentHash).to.equal(intentHash);
      expect(req.requester).to.equal(agent.address);
      expect(req.fulfilled).to.be.false;
      expect(req.revealed).to.be.false;
    });

    it("oracle can fulfill confidential decision", async function () {
      const tx = await guard.connect(agent).requestConfidentialPurchase(intentHash);
      const id = await extractRequestId(tx, "ConfidentialPurchaseRequested");

      await expect(guard.connect(oracle).fulfillConfidentialDecision(id, true, 1095))
        .to.emit(guard, "PurchaseApproved");

      const req = await guard.getConfidentialRequest(id);
      expect(req.approved).to.be.true;
      expect(req.referencePrice).to.equal(1095);
    });

    it("requester can reveal after fulfillment", async function () {
      const tx = await guard.connect(agent).requestConfidentialPurchase(intentHash);
      const id = await extractRequestId(tx, "ConfidentialPurchaseRequested");
      await guard.connect(oracle).fulfillConfidentialDecision(id, true, 1095);

      await expect(guard.connect(agent).revealPurchase(id, "laptop-001", 1100, "seller-42", salt))
        .to.emit(guard, "ConfidentialPurchaseRevealed");

      const req = await guard.getConfidentialRequest(id);
      expect(req.revealed).to.be.true;
    });

    it("reverts reveal with wrong data", async function () {
      const tx = await guard.connect(agent).requestConfidentialPurchase(intentHash);
      const id = await extractRequestId(tx, "ConfidentialPurchaseRequested");

      await expect(guard.connect(agent).revealPurchase(id, "laptop-001", 9999, "seller-42", salt))
        .to.be.revertedWithCustomError(guard, "InvalidReveal");
    });

    it("reverts double reveal", async function () {
      const tx = await guard.connect(agent).requestConfidentialPurchase(intentHash);
      const id = await extractRequestId(tx, "ConfidentialPurchaseRequested");
      await guard.connect(oracle).fulfillConfidentialDecision(id, true, 1095);
      await guard.connect(agent).revealPurchase(id, "laptop-001", 1100, "seller-42", salt);

      await expect(guard.connect(agent).revealPurchase(id, "laptop-001", 1100, "seller-42", salt))
        .to.be.revertedWithCustomError(guard, "AlreadyRevealed");
    });

    it("non-requester cannot reveal", async function () {
      const tx = await guard.connect(agent).requestConfidentialPurchase(intentHash);
      const id = await extractRequestId(tx, "ConfidentialPurchaseRequested");

      await expect(guard.connect(owner).revealPurchase(id, "laptop-001", 1100, "seller-42", salt))
        .to.be.revertedWithCustomError(guard, "Unauthorized");
    });
  });
});
