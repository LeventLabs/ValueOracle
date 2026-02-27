import {
  CronCapability,
  HTTPClient,
  handler,
  ok,
  consensusIdenticalAggregation,
  type Runtime,
  type HTTPSendRequester,
  Runner,
} from "@chainlink/cre-sdk";
import { z } from "zod";

const configSchema = z.object({
  schedule: z.string(),
  apiUrl: z.string(),
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

// Sample purchase payload — in production this comes from an onchain event
const SAMPLE_PURCHASE = {
  itemId: "laptop-001",
  price: 1100,
  sellerId: "seller-42",
};

const evaluatePurchase = (
  sendRequester: HTTPSendRequester,
  config: Config
): EvaluationResult => {
  const bodyBytes = new TextEncoder().encode(JSON.stringify(SAMPLE_PURCHASE));
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

const onCronTrigger = (runtime: Runtime<Config>): string => {
  runtime.log("ValueOracle purchase evaluation triggered");

  const httpClient = new HTTPClient();

  const result = httpClient
    .sendRequest(
      runtime,
      evaluatePurchase,
      consensusIdenticalAggregation<EvaluationResult>()
    )(runtime.config)
    .result();

  const summary = [
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
  return [
    handler(
      new CronCapability().trigger({ schedule: config.schedule }),
      onCronTrigger
    ),
  ];
};

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema });
  await runner.run(initWorkflow);
}
