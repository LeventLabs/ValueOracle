# ValueOracle CRE Workflow (purchase-guard)

This package contains the Chainlink CRE workflow implementation for ValueOracle.

## What this folder does

- `main.ts`: decodes `PurchaseRequested` logs and evaluates purchases through the decision API.
- `workflow.yaml`: CRE CLI target settings (staging/production artifact config).
- `config.staging.json`: local simulation config (API URL, contract address, chain selector).

## Important responsibility split

- `valueoracle-cre/purchase-guard/main.ts` is the TypeScript evaluation workflow used for simulation and workflow logic.
- `cre/workflow.yaml` is the declarative CRE flow that performs onchain writes:
  - `fulfillOracleDecision(bytes32,bool,uint256)`
  - `fulfillConfidentialDecision(bytes32,bool,uint256)`

This split is intentional and matches the demo architecture.

## Local simulation

1. Start decision API from project root:

```bash
npm run api
```

2. Install CRE workflow dependencies:

```bash
cd valueoracle-cre/purchase-guard
bun install
```

3. Run CRE simulation from project root:

```bash
cre workflow simulate purchase-guard --non-interactive --trigger-index 0 \
  --evm-tx-hash <TX_HASH> --evm-event-index 0 --target staging-settings
```

## Tests

```bash
cd valueoracle-cre/purchase-guard
bun test
```
