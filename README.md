# ValueOracle

**AI agents can spend money, but they cannot verify value. We built the missing trust layer for agent commerce.**

ValueOracle is a verifiable commerce oracle powered by Chainlink CRE that protects autonomous agents from overpaying, fraud, and price manipulation. Think of Chainlink price feeds — but for real-world product decisions.

> Built for [Convergence: A Chainlink Hackathon](https://chain.link/hackathon) — CRE & AI Track

---

## Problem

Autonomous AI agents can initiate transactions, but they lack economic reasoning:

- They **cannot compare** market prices across sources
- They **cannot detect** price manipulation or outliers
- They **cannot verify** seller trustworthiness

This creates unacceptable financial risk in agent-driven commerce.

## Solution

ValueOracle acts as a **decision oracle** between an agent's purchase intent and the actual transaction. Before any funds move, the oracle:

1. Aggregates prices from multiple marketplace sources
2. Detects outliers and manipulation
3. Scores seller reputation
4. Returns a verifiable **approve/reject** decision onchain

```
Financial Oracle → token price
ValueOracle     → real-world purchase decision
```

## Architecture

```
┌─────────┐     ┌──────────────────┐     ┌─────────────────┐
│ AI Agent │────▶│ PurchaseGuard.sol│────▶│  Chainlink CRE  │
└─────────┘     │  (Smart Contract)│     │    Workflow      │
                └──────────────────┘     └────────┬────────┘
                         ▲                        │
                         │                        ▼
                         │               ┌─────────────────┐
                         │               │ Offchain Decision│
                         │               │    Engine        │
                         │               │                  │
                         │               │ • Marketplace A  │
                         │               │ • Marketplace B  │
                         │               │ • Seller Score   │
                         │               └────────┬────────┘
                         │                        │
                         └────────────────────────┘
                           Oracle Response (approve/reject)
```

**Flow:**
1. Agent submits purchase intent → `PurchaseGuard.sol`
2. Contract emits `PurchaseRequested` event
3. Chainlink CRE workflow triggers, fetches external data
4. Decision engine evaluates price fairness
5. Oracle returns signed result → contract approves or rejects

## Tech Stack

| Component | Technology |
|---|---|
| Smart Contract | Solidity (Sepolia) |
| Oracle Layer | Chainlink CRE |
| Decision API | Node.js |
| Agent Trigger | CLI / Script |
| Data Sources | Mock marketplace APIs |

## Project Structure

```
ValueOracle/
├── contracts/
│   └── PurchaseGuard.sol          # ← Chainlink oracle consumer
├── cre/
│   └── workflow.yaml              # ← Chainlink CRE workflow definition
├── api/
│   ├── server.js                  # Decision engine API
│   └── sources/                   # Marketplace data adapters
├── agent/
│   └── cli.js                     # Demo agent trigger
├── scripts/
│   ├── deploy.js                  # Contract deployment
│   └── simulate.js                # End-to-end simulation
└── test/
    └── PurchaseGuard.test.js
```

## Chainlink Integration Files

> Required by hackathon: links to all files that use Chainlink

| File | Purpose |
|---|---|
| [`contracts/PurchaseGuard.sol`](./contracts/PurchaseGuard.sol) | Smart contract receiving oracle decisions |
| [`cre/workflow.yaml`](./cre/workflow.yaml) | CRE workflow definition — triggers on events, fetches data, returns decision |
| [`scripts/simulate.js`](./scripts/simulate.js) | CRE CLI simulation script |

## Quick Start

```bash
# Clone
git clone https://github.com/leventlabs/ValueOracle.git
cd ValueOracle

# Install dependencies
npm install

# Deploy contract (Sepolia)
npx hardhat run scripts/deploy.js --network sepolia

# Start decision API
node api/server.js

# Run CRE workflow simulation
cre simulate cre/workflow.yaml

# Demo: Agent attempts overpriced purchase (rejected)
node agent/cli.js buy "Laptop" --price 2500

# Demo: Agent attempts fair purchase (approved)
node agent/cli.js buy "Laptop" --price 1100
```

## Decision Logic

```
referencePrice = median(allSourcePrices)

if proposedPrice <= referencePrice × 1.10 → ✅ APPROVE
if proposedPrice >  referencePrice × 1.10 → ❌ REJECT
if sellerReputation < threshold            → ❌ REJECT
```

## Demo Scenarios

| Scenario | Price | Market Median | Result |
|---|---|---|---|
| Overpriced laptop | $2,500 | $1,100 | ❌ Rejected onchain |
| Fair price laptop | $1,100 | $1,100 | ✅ Approved onchain |
| Low reputation seller | $1,000 | $1,100 | ❌ Rejected (trust) |

## Demo Video

🔗 [Watch the 3-5 minute demo](https://youtu.be/TODO)

The video demonstrates:
1. Agent submits purchase intent
2. CRE workflow triggers and fetches marketplace data
3. Oracle produces verifiable decision
4. Smart contract approves or rejects the transaction onchain


## Why This Matters — The Post-SaaS Agent Economy

AI agents are rapidly commoditizing every SaaS tool. They auto-switch providers, negotiate prices, and collapse 30 dashboards into a single chat. Switching costs are gone. Brand loyalty is gone. Margins are racing to zero.

But there's one thing agents **cannot** automate: **trust**.

An agent can move your database from Supabase to Neon overnight. It can cancel your Stripe and set up a competitor. But when it comes to *spending money* — comparing prices across sources, detecting manipulation, verifying seller reputation — it's flying blind.

**ValueOracle is the missing trust layer for this new economy.**

Just as Stripe's fraud detection gets smarter with every transaction across millions of businesses, ValueOracle builds collective commerce intelligence across every agent decision. More agents → better data → smarter decisions → more agents. That's a moat AI agents can't commoditize.

> In a world where agents automate everything, the infrastructure that makes agents *trustworthy* becomes the most valuable layer of all.

## Future Vision

- Real marketplace integrations (Amazon, eBay, etc.)
- Reputation oracle with historical data
- Subscription & recurring payment protection
- Wallet-level spending policies
- Cross-chain verification

## Team

**LeventLabs** — [levent@leventlabs.com](mailto:levent@leventlabs.com)

## License

MIT
