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
  TxStatus,
  Runner,
  type Runtime,
  type EVMLog,
  type HTTPSendRequester,
} from "@chainlink/cre-sdk";
import { keccak256, toBytes, decodeAbiParameters, parseAbiParameters, encodeAbiParameters } from "viem";
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

// Write oracle decision back onchain via CRE KeystoneForwarder → PurchaseGuard.onReport()
// Report format: abi.encode(bytes32 requestId, bool approved, uint256 referencePrice, bool isConfidential)
function writeDecisionOnchain(
  runtime: Runtime<Config>,
  evmClient: EVMClient,
  requestId: string,
  approved: boolean,
  referencePrice: number,
  isConfidential: boolean
): void {
  const reportData = encodeAbiParameters(
    parseAbiParameters("bytes32 requestId, bool approved, uint256 referencePrice, bool isConfidential"),
    [requestId as `0x${string}`, approved, BigInt(referencePrice), isConfidential]
  );

  const reportResponse = runtime
    .report({
      encodedPayload: hexToBase64(reportData),
      encoderName: "evm",
      signingAlgo: "ecdsa",
      hashingAlgo: "keccak256",
    })
    .result();

  const writeResult = evmClient
    .writeReport(runtime, {
      receiver: runtime.config.contractAddress,
      report: reportResponse,
      gasConfig: { gasLimit: "300000" },
    })
    .result();

  if (writeResult.txStatus === TxStatus.SUCCESS) {
    const txHash = bytesToHex(writeResult.txHash || new Uint8Array(32));
    runtime.log(`Decision written onchain: tx=${txHash.slice(0, 14)}...`);
  } else {
    runtime.log(`Onchain write failed: status=${writeResult.txStatus} err=${writeResult.errorMessage || "unknown"}`);
  }
}

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

  // Write decision back onchain via CRE → KeystoneForwarder → PurchaseGuard.onReport()
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: runtime.config.chainSelectorName,
    isTestnet: true,
  });
  if (network) {
    const evmClient = new EVMClient(network.chainSelector.selector);
    writeDecisionOnchain(runtime, evmClient, purchase.requestId, result.approved, result.referencePrice, false);
  }

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

  // Step 1: Resolve purchase details from intent cache.
  // Agent caches details offchain (POST /intent) before submitting the confidential tx.
  // This avoids hardcoding purchase details in the workflow body.
  const httpClient = new HTTPClient();
  const intentData = httpClient
    .sendRequest(
      runtime,
      (sendRequester) => {
        const req = {
          url: `${runtime.config.apiUrl}/intent/${intentHash}`,
          method: "GET" as const,
          headers: { "Content-Type": "application/json" },
        };
        const resp = sendRequester.sendRequest(req).result();
        if (!ok(resp)) {
          throw new Error(`Intent lookup failed: ${resp.statusCode}`);
        }
        return JSON.parse(new TextDecoder().decode(resp.body)) as {
          itemId: string;
          price: number;
          sellerId: string;
        };
      },
      consensusIdenticalAggregation<{ itemId: string; price: number; sellerId: string }>()
    )()
    .result();

  runtime.log(
    `Intent resolved: item=${intentData.itemId} price=${intentData.price} seller=${intentData.sellerId}`
  );

  // Step 2: Confidential HTTP — evaluate inside secure enclave with resolved details.
  // The marketplaceApiKey is injected via Vault DON template syntax — never visible to DON nodes.
  const bodyStr = JSON.stringify({
    intentHash,
    itemId: intentData.itemId,
    price: intentData.price,
    sellerId: intentData.sellerId,
  });

  const response = confHTTPClient
    .sendRequest(runtime, {
      request: {
        url: `${runtime.config.apiUrl}/evaluate-confidential`,
        method: "POST",
        bodyString: bodyStr,
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
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: runtime.config.chainSelectorName,
    isTestnet: true,
  });

  try {
    const result = json(response) as EvaluationResult;
    runtime.log(
      `Confidential evaluation complete: requestId=${requestId.slice(0, 12)}... verdict=${result.verdict} score=${result.valueScore}`
    );

    // Write confidential decision back onchain
    if (network) {
      const evmClient = new EVMClient(network.chainSelector.selector);
      writeDecisionOnchain(runtime, evmClient, requestId, result.approved, result.referencePrice, true);
    }

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
