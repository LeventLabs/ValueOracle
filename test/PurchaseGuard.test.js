const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PurchaseGuard", function () {
  let purchaseGuard;
  let owner;
  let oracle;
  let agent;

  beforeEach(async function () {
    [owner, oracle, agent] = await ethers.getSigners();
    
    const PurchaseGuard = await ethers.getContractFactory("PurchaseGuard");
    purchaseGuard = await PurchaseGuard.deploy(oracle.address);
    await purchaseGuard.waitForDeployment();
  });

  describe("Purchase Request", function () {
    it("Should create a purchase request", async function () {
      const tx = await purchaseGuard.connect(agent).requestPurchase(
        "laptop-001",
        1100,
        "seller-42"
      );
      
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => {
        try {
          return purchaseGuard.interface.parseLog(log).name === "PurchaseRequested";
        } catch {
          return false;
        }
      });
      
      expect(event).to.not.be.undefined;
    });

    it("Should store request details correctly", async function () {
      const tx = await purchaseGuard.connect(agent).requestPurchase(
        "laptop-001",
        1100,
        "seller-42"
      );
      
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => {
        try {
          return purchaseGuard.interface.parseLog(log).name === "PurchaseRequested";
        } catch {
          return false;
        }
      });
      
      const parsedEvent = purchaseGuard.interface.parseLog(event);
      const requestId = parsedEvent.args.requestId;
      
      const request = await purchaseGuard.getRequest(requestId);
      expect(request.itemId).to.equal("laptop-001");
      expect(request.proposedPrice).to.equal(1100);
      expect(request.sellerId).to.equal("seller-42");
      expect(request.requester).to.equal(agent.address);
      expect(request.fulfilled).to.be.false;
    });
  });

  describe("Oracle Fulfillment", function () {
    let requestId;

    beforeEach(async function () {
      const tx = await purchaseGuard.connect(agent).requestPurchase(
        "laptop-001",
        1100,
        "seller-42"
      );
      
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => {
        try {
          return purchaseGuard.interface.parseLog(log).name === "PurchaseRequested";
        } catch {
          return false;
        }
      });
      
      const parsedEvent = purchaseGuard.interface.parseLog(event);
      requestId = parsedEvent.args.requestId;
    });

    it("Should allow oracle to approve purchase", async function () {
      await expect(
        purchaseGuard.connect(oracle).fulfillOracleDecision(requestId, true, 1100)
      ).to.emit(purchaseGuard, "PurchaseApproved");

      const request = await purchaseGuard.getRequest(requestId);
      expect(request.fulfilled).to.be.true;
      expect(request.approved).to.be.true;
      expect(request.referencePrice).to.equal(1100);
    });

    it("Should allow oracle to reject purchase", async function () {
      await expect(
        purchaseGuard.connect(oracle).fulfillOracleDecision(requestId, false, 1100)
      ).to.emit(purchaseGuard, "PurchaseRejected");

      const request = await purchaseGuard.getRequest(requestId);
      expect(request.fulfilled).to.be.true;
      expect(request.approved).to.be.false;
    });

    it("Should reject fulfillment from non-oracle", async function () {
      await expect(
        purchaseGuard.connect(agent).fulfillOracleDecision(requestId, true, 1100)
      ).to.be.revertedWith("Only oracle can fulfill");
    });

    it("Should prevent double fulfillment", async function () {
      await purchaseGuard.connect(oracle).fulfillOracleDecision(requestId, true, 1100);
      
      await expect(
        purchaseGuard.connect(oracle).fulfillOracleDecision(requestId, true, 1100)
      ).to.be.revertedWith("Already fulfilled");
    });
  });

  describe("Access Control", function () {
    it("Should allow owner to update oracle", async function () {
      const newOracle = agent.address;
      await purchaseGuard.connect(owner).setOracle(newOracle);
      expect(await purchaseGuard.oracle()).to.equal(newOracle);
    });

    it("Should reject oracle update from non-owner", async function () {
      await expect(
        purchaseGuard.connect(agent).setOracle(agent.address)
      ).to.be.revertedWith("Only owner");
    });
  });
});
