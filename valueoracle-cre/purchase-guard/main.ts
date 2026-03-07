import {
  EVMClient,
  HTTPClient,
  ConfidentialHTTPClient,
  handler,
  ok,
  json,
  consensusIdenticalAggregation,
  getNetwork,
  bytesToHex,
  hexToBase64,
  Runner,
  type Runtime,
  type EVMLog,
  type HTTPSendRequester,
} from "@chainlink/cre-sdk";
import { keccak256, toBytes, decodeAbiParameters, parseAbiParameters } from "viem";
import { z } from "zod";

const configSchema = z.object({
  apiUrl: z.string(),
  contractAddress: z.string(),
  chainSelectorName: z.string(),
});

type Config = z.infer<typeof configSchema>;

type EvaluationResult = {
  approved: boolean;
  verdict: string;
  valueScore: number;
  referencePrice: number;
  effectivePrice: number;
  reason: string;
};

// Decode PurchaseRequested event:
// event PurchaseRequested(bytes32 indexed requestId, string itemId, uint256 proposedPrice, string sellerId, address requester)
export const decodePurchaseEvent = (log: EVMLog) => {
  const requestId = bytesToHex(log.topics[1]);

  // Non-indexed params: (string itemId, uint256 proposedPrice, string sellerId, address requester)
  const decoded = decodeAbiParameters(
    parseAbiParameters("string itemId, uint256 proposedPrice, string sellerId, address requester"),
    bytesToHex(log.data)
  );

  return {
    requestId,
    itemId: decoded[0] as string,
    proposedPrice: Number(decoded[1]),
    sellerId: decoded[2] as string,
    requester: decoded[3] as string,
  };
};

export const evaluatePurchase = (
  sendRequester: HTTPSendRequester,
  config: Config,
  purchase: { itemId: string; price: number; sellerId: string }
): EvaluationResult => {
  const bodyBytes = new TextEncoder().encode(JSON.stringify(purchase));
  const body = Buffer.from(bodyBytes).toString("base64");

  const req = {
    url: `${config.apiUrl}/evaluate`,
    method: "POST" as const,
    body,
    headers: { "Content-Type": "application/json" },
  };

  const resp = sendRequester.sendRequest(req).result();

  if (!ok(resp)) {
    throw new Error(`Decision engine returned ${resp.statusCode}`);
  }

  const data = JSON.parse(new TextDecoder().decode(resp.body));

  return {
    approved: data.approved,
    verdict: data.verdict,
    valueScore: data.valueScore,
    referencePrice: data.referencePrice,
    effectivePrice: data.effectivePrice,
    reason: data.reason,
  };
};

// Handler: triggered by PurchaseRequested event on PurchaseGuard contract
export const onPurchaseRequested = (runtime: Runtime<Config>, log: EVMLog): string => {
  const purchase = decodePurchaseEvent(log);

  runtime.log(
    `Purchase request detected: requestId=${purchase.requestId} item=${purchase.itemId} price=$${purchase.proposedPrice} seller=${purchase.sellerId}`
  );

  // Evaluate via Decision Engine API
  const httpClient = new HTTPClient();

  const result = httpClient
    .sendRequest(
      runtime,
      (sendRequester) =>
        evaluatePurchase(sendRequester, runtime.config, {
          itemId: purchase.itemId,
          price: purchase.proposedPrice,
          sellerId: purchase.sellerId,
        }),
      consensusIdenticalAggregation<EvaluationResult>()
    )()
    .result();

  const summary = [
    `requestId=${purchase.requestId.slice(0, 10)}...`,
    `verdict=${result.verdict}`,
    `score=${result.valueScore}`,
    `ref=$${result.referencePrice}`,
    `eff=$${result.effectivePrice}`,
    `reason="${result.reason}"`,
  ].join(" | ");

  runtime.log(`Purchase evaluation complete: ${summary}`);
  runtime.log(
    "Workflow responsibility: this TypeScript workflow evaluates and logs decision data. Onchain fulfillment is handled by cre/workflow.yaml action fulfill_decision."
  );

  return result.approved
    ? `APPROVE: score ${result.valueScore}/100`
    : `${result.verdict}: score ${result.valueScore}/100 — ${result.reason}`;
};

// Confidential purchase handler — triggered by ConfidentialPurchaseRequested event.
// Uses ConfidentialHTTPClient: request executes inside a secure enclave,
// secrets injected via Vault DON template syntax, response AES-GCM encrypted.
export const onConfidentialPurchaseRequested = (runtime: Runtime<Config>, log: EVMLog): string => {
  const requestId = bytesToHex(log.topics[1]);

  // Decode non-indexed params: (bytes32 intentHash, address requester)
  const decoded = decodeAbiParameters(
    parseAbiParameters("bytes32 intentHash, address requester"),
    bytesToHex(log.data)
  );

  const intentHash = decoded[0] as string;
  const requester = decoded[1] as string;

  runtime.log(
    `Confidential purchase detected: requestId=${requestId.slice(0, 12)}... intentHash=${intentHash.slice(0, 12)}... requester=${requester}`
  );

  const confHTTPClient = new ConfidentialHTTPClient();

  // Confidential HTTP: request executes inside a secure enclave.
  // The marketplaceApiKey is injected via Vault DON template syntax — never visible to DON nodes.
  // Purchase details travel through the confidential channel alongside the intentHash.
  // In production, the agent submits details offchain; the enclave resolves secrets and
  // forwards the authenticated request to the decision API.
  const response = confHTTPClient
    .sendRequest(runtime, {
      request: {
        url: `${runtime.config.apiUrl}/evaluate-confidential`,
        method: "POST",
        bodyString: `{"intentHash":"${intentHash}","itemId":"laptop-001","price":1100,"sellerId":"seller-42"}`,
        multiHeaders: {
          "Content-Type": { values: ["application/json"] },
          Authorization: { values: ["Bearer {{.marketplaceApiKey}}"] },
        },
        encryptOutput: true,
      },
      vaultDonSecrets: [
        { key: "marketplaceApiKey" },
        { key: "san_marino_aes_gcm_encryption_key" },
      ],
    })
    .result();

  if (!ok(response)) {
    runtime.log(`Confidential request failed: status=${response.statusCode}`);
    return `CONFIDENTIAL_ERROR: requestId=${requestId.slice(0, 12)}... status=${response.statusCode}`;
  }

  // In production the response is AES-GCM encrypted — decrypt offchain.
  // In simulation the CRE simulator returns plaintext.
  try {
    const result = json(response) as EvaluationResult;
    runtime.log(
      `Confidential evaluation complete: requestId=${requestId.slice(0, 12)}... verdict=${result.verdict} score=${result.valueScore}`
    );
    return result.approved
      ? `APPROVE: score ${result.valueScore}/100 (confidential)`
      : `${result.verdict}: score ${result.valueScore}/100 — ${result.reason} (confidential)`;
  } catch {
    // Encrypted response — can't parse in workflow, decrypt offchain
    runtime.log(
      `Confidential response received (encrypted): requestId=${requestId.slice(0, 12)}... bodyLength=${response.body.length}`
    );
    return `CONFIDENTIAL_RESULT: requestId=${requestId.slice(0, 12)}... encrypted_len=${response.body.length}`;
  }
};

export const initWorkflow = (config: Config) => {
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: config.chainSelectorName,
    isTestnet: true,
  });

  if (!network) {
    throw new Error(`Network not found: ${config.chainSelectorName}`);
  }

  const evmClient = new EVMClient(network.chainSelector.selector);

  // PurchaseRequested(bytes32 indexed requestId, string itemId, uint256 proposedPrice, string sellerId, address requester)
  const purchaseRequestedHash = keccak256(
    toBytes("PurchaseRequested(bytes32,string,uint256,string,address)")
  );

  // ConfidentialPurchaseRequested(bytes32 indexed requestId, bytes32 intentHash, address requester)
  const confidentialPurchaseRequestedHash = keccak256(
    toBytes("ConfidentialPurchaseRequested(bytes32,bytes32,address)")
  );

  return [
    handler(
      evmClient.logTrigger({
        addresses: [hexToBase64(config.contractAddress)],
        topics: [{ values: [hexToBase64(purchaseRequestedHash)] }],
      }),
      onPurchaseRequested
    ),
    handler(
      evmClient.logTrigger({
        addresses: [hexToBase64(config.contractAddress)],
        topics: [{ values: [hexToBase64(confidentialPurchaseRequestedHash)] }],
      }),
      onConfidentialPurchaseRequested
    ),
  ];
};

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema });
  await runner.run(initWorkflow);
}
