import {
  EVMClient,
  HTTPClient,
  handler,
  ok,
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
const decodePurchaseEvent = (log: EVMLog) => {
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

const evaluatePurchase = (
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
const onPurchaseRequested = (runtime: Runtime<Config>, log: EVMLog): string => {
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

  return result.approved
    ? `APPROVE: score ${result.valueScore}/100`
    : `${result.verdict}: score ${result.valueScore}/100 — ${result.reason}`;
};

const initWorkflow = (config: Config) => {
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

  return [
    handler(
      evmClient.logTrigger({
        addresses: [hexToBase64(config.contractAddress)],
        topics: [{ values: [hexToBase64(purchaseRequestedHash)] }],
      }),
      onPurchaseRequested
    ),
  ];
};

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema });
  await runner.run(initWorkflow);
}
