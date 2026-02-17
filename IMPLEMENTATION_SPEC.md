# ValueOracle — Implementation Specification

## 1. Overview

A Chainlink CRE-powered oracle that allows autonomous agents to verify whether a purchase represents fair market value before funds are spent.

**Core idea:** Agents can execute transactions but cannot validate value. This oracle becomes a decision layer that approves or rejects spending based on external market data.

**Target track:** CRE & AI ($17,000 / $10,500 / $6,500)

**Hackathon requirements checklist:**
- [ ] CRE Workflow (simulated via CLI or deployed)
- [ ] Blockchain + external API/data source integration
- [ ] 3-5 minute public video
- [ ] Public GitHub repo
- [ ] README with links to all Chainlink files

---

## 2. System Architecture

```
┌──────────┐    ┌────────────────────┐    ┌──────────────────┐
│ AI Agent │───▶│ PurchaseGuard.sol  │───▶│  Chainlink CRE   │
│ (CLI)    │    │ (Sepolia)          │    │  Workflow         │
└──────────┘    └────────────────────┘    └────────┬─────────┘
                         ▲                         │
                         │                         ▼
                         │                ┌──────────────────┐
                         │                │ Decision Engine   │
                         │                │ POST /evaluate    │
                         │                │                   │
                         │                │ ┌──────────────┐ │
                         │                │ │ Marketplace A │ │
                         │                │ │ Marketplace B │ │
                         │                │ │ Seller Score  │ │
                         │                │ └──────────────┘ │
                         │                └────────┬─────────┘
                         │                         │
                         └─────────────────────────┘
                          fulfillOracleDecision()
```

**Components:**
1. Agent Trigger — CLI script simulating an autonomous agent
2. PurchaseGuard.sol — Smart contract on Sepolia
3. Chainlink CRE Workflow — Orchestration layer
4. Decision Engine API — Node.js service with mock data sources

---

## 3. Smart Contract: PurchaseGuard.sol

**Network:** Sepolia testnet

### Storage

```solidity
struct PurchaseRequest {
    string itemId;
    uint256 proposedPrice;
    string sellerId;
    address requester;
    bool fulfilled;
    bool approved;
    uint256 referencePrice;
}

mapping(bytes32 => PurchaseRequest) public requests;
```

### Functions

| Function | Access | Description |
|---|---|---|
| `requestPurchase(itemId, proposedPrice, sellerId)` | Public | Creates pending request, emits event for CRE |
| `fulfillOracleDecision(requestId, approved, referencePrice)` | Oracle only | Resolves the request onchain |

### Events

```solidity
event PurchaseRequested(bytes32 indexed requestId, string itemId, uint256 proposedPrice, string sellerId);
event PurchaseApproved(bytes32 indexed requestId, uint256 referencePrice);
event PurchaseRejected(bytes32 indexed requestId, uint256 referencePrice);
```

---

## 4. Chainlink CRE Workflow

**File:** `cre/workflow.yaml`

### Steps

| Step | Action |
|---|---|
| 1. Trigger | Listen to `PurchaseRequested` event on Sepolia |
| 2. Fetch | HTTP call to Decision Engine API with itemId, price, sellerId |
| 3. Compute | Parse response (approved, referencePrice) |
| 4. Write | Call `fulfillOracleDecision()` on PurchaseGuard.sol |

### Workflow Skeleton

```yaml
name: valueoracle-purchase-guard
triggers:
  - type: onchain_event
    config:
      contractAddress: "DEPLOYED_ADDRESS"
      eventSignature: "PurchaseRequested(bytes32,string,uint256,string)"
      network: sepolia

actions:
  - name: evaluate_purchase
    type: http_request
    config:
      method: POST
      url: "DECISION_API_URL/evaluate"
      body:
        itemId: "$(trigger.itemId)"
        price: "$(trigger.proposedPrice)"
        sellerId: "$(trigger.sellerId)"

  - name: fulfill_decision
    type: onchain_write
    config:
      contractAddress: "DEPLOYED_ADDRESS"
      function: "fulfillOracleDecision(bytes32,bool,uint256)"
      args:
        - "$(trigger.requestId)"
        - "$(evaluate_purchase.approved)"
        - "$(evaluate_purchase.referencePrice)"
      network: sepolia
```

---

## 5. Decision Engine API

**Runtime:** Node.js  
**Port:** 3000

### Endpoint

```
POST /evaluate
```

**Request:**
```json
{
  "itemId": "laptop-001",
  "price": 2500,
  "sellerId": "seller-42"
}
```

**Response:**
```json
{
  "approved": false,
  "referencePrice": 1100,
  "reason": "Price exceeds 110% of market median",
  "sources": [
    { "name": "marketplaceA", "price": 1050 },
    { "name": "marketplaceB", "price": 1100 },
    { "name": "marketplaceC", "price": 1150 }
  ],
  "sellerScore": 0.85
}
```

### Decision Algorithm

```
referencePrice = median(allSourcePrices)

APPROVE if:
  - proposedPrice <= referencePrice * 1.10
  - sellerScore >= 0.5

REJECT if:
  - proposedPrice > referencePrice * 1.10
  - OR sellerScore < 0.5
```

### Mock Data Sources

| Source | Endpoint | Returns |
|---|---|---|
| Marketplace A | `GET /api/marketplace-a/:itemId` | `{ price, available }` |
| Marketplace B | `GET /api/marketplace-b/:itemId` | `{ price, available }` |
| Marketplace C | `GET /api/marketplace-c/:itemId` | `{ price, available }` |
| Seller Score | `GET /api/seller/:sellerId` | `{ score, totalSales }` |

---

## 6. Agent CLI

**File:** `agent/cli.js`

```bash
# Fair price — should be approved
node agent/cli.js buy "laptop-001" --price 1100 --seller "seller-42"

# Overpriced — should be rejected
node agent/cli.js buy "laptop-001" --price 2500 --seller "seller-42"

# Bad seller — should be rejected
node agent/cli.js buy "laptop-001" --price 1000 --seller "seller-99"
```

The CLI:
1. Calls `requestPurchase()` on PurchaseGuard.sol
2. Waits for oracle fulfillment event
3. Prints result (approved/rejected with reason)

---

## 7. Demo Scenarios

| # | Scenario | Price | Median | Seller Score | Expected |
|---|---|---|---|---|---|
| 1 | Fair purchase | $1,100 | $1,100 | 0.85 | ✅ Approved |
| 2 | Overpriced | $2,500 | $1,100 | 0.85 | ❌ Rejected (price) |
| 3 | Bad seller | $1,000 | $1,100 | 0.30 | ❌ Rejected (trust) |

---

## 8. File Map

```
ValueOracle/
├── contracts/
│   └── PurchaseGuard.sol           # Solidity contract [CHAINLINK]
├── cre/
│   └── workflow.yaml               # CRE workflow [CHAINLINK]
├── api/
│   ├── server.js                   # Decision engine
│   └── sources/
│       ├── marketplaceA.js         # Mock source
│       ├── marketplaceB.js         # Mock source
│       ├── marketplaceC.js         # Mock source
│       └── sellerScore.js          # Mock reputation
├── agent/
│   └── cli.js                      # Agent trigger
├── scripts/
│   ├── deploy.js                   # Hardhat deploy
│   └── simulate.js                 # CRE simulation [CHAINLINK]
├── test/
│   └── PurchaseGuard.test.js       # Contract tests
├── hardhat.config.js
├── package.json
├── README.md
└── IMPLEMENTATION_SPEC.md
```

---

## 9. Development Plan

| Day | Task | Deliverable |
|---|---|---|
| 1-2 | Repo setup, Hardhat config, PurchaseGuard.sol | Deployed contract on Sepolia |
| 3-4 | Decision API + mock sources | Working `/evaluate` endpoint |
| 5-7 | CRE workflow definition + simulation | `cre simulate` passing |
| 8-9 | Agent CLI + end-to-end integration | Full flow working |
| 10-11 | Demo scenarios + edge cases | 3 demo scenarios verified |
| 12-13 | Video recording + README polish | Submission-ready |

---

## 10. Dependencies

```json
{
  "dependencies": {
    "@chainlink/contracts": "latest",
    "ethers": "^6.x",
    "express": "^4.x",
    "commander": "^11.x"
  },
  "devDependencies": {
    "hardhat": "^2.x",
    "@nomicfoundation/hardhat-toolbox": "^4.x"
  }
}
```

---

## 11. Environment Variables

```env
SEPOLIA_RPC_URL=
PRIVATE_KEY=
CONTRACT_ADDRESS=
DECISION_API_URL=http://localhost:3000
```

---

## 12. Judging Criteria Alignment

| Criteria | How We Address It |
|---|---|
| **Blockchain usage** | Onchain purchase guard contract on Sepolia |
| **External data** | Multi-source price aggregation via API |
| **CRE integration** | Workflow triggers on event, fetches data, writes decision |
| **AI / Agent** | Autonomous agent initiates purchase, oracle decides |
| **Innovation** | First commerce decision oracle — price feeds for products |
| **Presentation** | Clear problem → solution → demo narrative |
