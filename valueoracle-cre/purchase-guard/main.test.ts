import { describe, expect, it } from "bun:test";
import { encodeAbiParameters, hexToBytes, parseAbiParameters } from "viem";
import { decodePurchaseEvent, initWorkflow } from "./main";

describe("purchase-guard workflow", () => {
  it("builds two EVM log-trigger handlers for the configured contract", () => {
    const handlers = initWorkflow({
      apiUrl: "http://localhost:3000",
      contractAddress: "0xfDB5020163742C340AAebAade840078CC557e1a1",
      chainSelectorName: "ethereum-testnet-sepolia",
    });

    expect(handlers).toBeArray();
    expect(handlers).toHaveLength(2);
  });

  it("decodes PurchaseRequested event payload", () => {
    const requestId =
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const data = encodeAbiParameters(
      parseAbiParameters(
        "string itemId, uint256 proposedPrice, string sellerId, address requester"
      ),
      ["laptop-001", 1100n, "seller-42", "0x1111111111111111111111111111111111111111"]
    );

    const decoded = decodePurchaseEvent({
      topics: [
        hexToBytes(
          "0x0000000000000000000000000000000000000000000000000000000000000000"
        ),
        hexToBytes(requestId),
      ],
      data: hexToBytes(data),
    } as any);

    expect(decoded.requestId).toBe(requestId);
    expect(decoded.itemId).toBe("laptop-001");
    expect(decoded.proposedPrice).toBe(1100);
    expect(decoded.sellerId).toBe("seller-42");
    expect(decoded.requester).toBe("0x1111111111111111111111111111111111111111");
  });
});
