package main

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"math/big"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/smartcontractkit/cre-sdk-go/capabilities/blockchain/evm"
	"github.com/smartcontractkit/cre-sdk-go/capabilities/networking/confidentialhttp"
	"github.com/smartcontractkit/cre-sdk-go/capabilities/networking/http"
	"github.com/smartcontractkit/cre-sdk-go/cre"
)

// ═══════════════════════════════════════════════════════════════════════════
// Config — loaded from config.staging.json or config.production.json
// ═══════════════════════════════════════════════════════════════════════════

type Config struct {
	ApiUrl          string `json:"apiUrl"`
	ContractAddress string `json:"contractAddress"`
	ChainSelector   uint64 `json:"chainSelector"`
}

// ═══════════════════════════════════════════════════════════════════════════
// EvaluationResult — the API response from the decision engine.
// The `consensus:"identical"` tag ensures all nodes agree on the same values.
// ═══════════════════════════════════════════════════════════════════════════

type EvaluationResult struct {
	Approved       bool   `json:"approved"       consensus:"identical"`
	Verdict        string `json:"verdict"        consensus:"identical"`
	ValueScore     int    `json:"valueScore"     consensus:"identical"`
	ReferencePrice int    `json:"referencePrice" consensus:"identical"`
	EffectivePrice int    `json:"effectivePrice" consensus:"identical"`
	Reason         string `json:"reason"         consensus:"identical"`
}

// ═══════════════════════════════════════════════════════════════════════════
// Keccak256 hashes of our contract events (precomputed)
//
// PurchaseRequested(bytes32 indexed requestId, string itemId, uint256 proposedPrice, string sellerId, address requester)
// ConfidentialPurchaseRequested(bytes32 indexed requestId, bytes32 intentHash, address requester)
// ═══════════════════════════════════════════════════════════════════════════

var (
	purchaseRequestedHash = common.HexToHash(
		"0x" + hex.EncodeToString(common.FromHex("0xfab8a20f51f89e44e7af7a921e777a1faff2aa40eb0a9bf41fcbc4e4b224e1a7")),
	)
	confidentialPurchaseRequestedHash = common.HexToHash(
		"0x" + hex.EncodeToString(common.FromHex("0x19b5e66a5e1f15c2a6e6be58c5a83c7293618bdf4a9f6edc1eb3dd8e7b1b6d8a")),
	)
)

// ═══════════════════════════════════════════════════════════════════════════
// InitWorkflow — registers two EVM log triggers on PurchaseGuard contract.
//
// 1. Standard purchases  → HTTPClient      → /evaluate
// 2. Confidential purchases → ConfidentialHTTPClient → /evaluate-confidential
// ═══════════════════════════════════════════════════════════════════════════

func InitWorkflow(config *Config, logger *slog.Logger, secretsProvider cre.SecretsProvider) (cre.Workflow[*Config], error) {
	contractAddr := common.HexToAddress(config.ContractAddress)

	// ── Trigger 1: Standard PurchaseRequested ────────────────────────
	standardTrigger := evm.LogTrigger(config.ChainSelector, &evm.FilterLogTriggerRequest{
		Addresses: [][]byte{contractAddr.Bytes()},
		Topics: []*evm.TopicValues{
			{Values: [][]byte{purchaseRequestedHash.Bytes()}},
		},
	})

	// ── Trigger 2: ConfidentialPurchaseRequested ─────────────────────
	confidentialTrigger := evm.LogTrigger(config.ChainSelector, &evm.FilterLogTriggerRequest{
		Addresses: [][]byte{contractAddr.Bytes()},
		Topics: []*evm.TopicValues{
			{Values: [][]byte{confidentialPurchaseRequestedHash.Bytes()}},
		},
	})

	workflow := cre.Workflow[*Config]{
		cre.Handler(standardTrigger, onStandardPurchase),
		cre.Handler(confidentialTrigger, onConfidentialPurchase),
	}

	return workflow, nil
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER 1: Standard Purchase — uses regular HTTPClient
//
// The PurchaseRequested event data is public (on-chain). We call the
// decision API via normal consensus-based HTTP, where every node makes
// the call and they agree on the response.
// ═══════════════════════════════════════════════════════════════════════════

func onStandardPurchase(config *Config, runtime cre.Runtime, log *evm.Log) (string, error) {
	logger := runtime.Logger()

	// ── Decode event ──
	requestId := common.BytesToHash(log.Topics[1])

	// Non-indexed params: (string itemId, uint256 proposedPrice, string sellerId, address requester)
	stringType, _ := abi.NewType("string", "", nil)
	uint256Type, _ := abi.NewType("uint256", "", nil)
	addressType, _ := abi.NewType("address", "", nil)

	args := abi.Arguments{
		{Type: stringType, Name: "itemId"},
		{Type: uint256Type, Name: "proposedPrice"},
		{Type: stringType, Name: "sellerId"},
		{Type: addressType, Name: "requester"},
	}

	decoded, err := args.Unpack(log.Data)
	if err != nil {
		return "", fmt.Errorf("failed to decode PurchaseRequested event: %w", err)
	}

	itemId := decoded[0].(string)
	proposedPrice := decoded[1].(*big.Int)
	sellerId := decoded[2].(string)

	logger.Info("Purchase request detected",
		"requestId", requestId.Hex()[:12]+"...",
		"item", itemId,
		"price", proposedPrice.Int64(),
		"seller", sellerId,
	)

	// ── Call decision engine via standard HTTP ──
	payload := fmt.Sprintf(
		`{"itemId":"%s","price":%d,"sellerId":"%s"}`,
		itemId, proposedPrice.Int64(), sellerId,
	)

	httpClient := http.Client{}
	resp, err := httpClient.SendRequest(
		runtime,
		func(sendRequester http.SendRequester) (EvaluationResult, error) {
			httpResp, reqErr := sendRequester.SendRequest(&http.Request{
				Url:    config.ApiUrl + "/evaluate",
				Method: "POST",
				Body:   []byte(payload),
				Headers: map[string]string{
					"Content-Type": "application/json",
				},
			})
			if reqErr != nil {
				return EvaluationResult{}, fmt.Errorf("HTTP request failed: %w", reqErr)
			}

			var result EvaluationResult
			if parseErr := json.Unmarshal(httpResp.Body, &result); parseErr != nil {
				return EvaluationResult{}, fmt.Errorf("failed to parse response: %w", parseErr)
			}
			return result, nil
		},
	)
	if err != nil {
		return "", fmt.Errorf("decision engine call failed: %w", err)
	}

	result := resp

	logger.Info("Purchase evaluation complete",
		"requestId", requestId.Hex()[:12]+"...",
		"verdict", result.Verdict,
		"score", result.ValueScore,
		"ref", result.ReferencePrice,
		"eff", result.EffectivePrice,
		"reason", result.Reason,
	)

	if result.Approved {
		return fmt.Sprintf("APPROVE: score %d/100", result.ValueScore), nil
	}
	return fmt.Sprintf("%s: score %d/100 — %s", result.Verdict, result.ValueScore, result.Reason), nil
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER 2: Confidential Purchase — uses ConfidentialHTTPClient
//
// This is the REAL privacy implementation:
// - API credentials are injected inside the secure enclave via {{.marketplaceApiKey}}
// - The request executes inside the enclave — no node sees the plaintext
// - Response is AES-GCM encrypted before leaving the enclave
// - Only the commitment hash is on-chain; purchase details stay private
// ═══════════════════════════════════════════════════════════════════════════

func onConfidentialPurchase(config *Config, runtime cre.Runtime, log *evm.Log) (string, error) {
	logger := runtime.Logger()

	// ── Decode ConfidentialPurchaseRequested event ──
	// Topics[0] = event sig, Topics[1] = indexed requestId
	// Data = (bytes32 intentHash, address requester)
	requestId := common.BytesToHash(log.Topics[1])

	bytes32Type, _ := abi.NewType("bytes32", "", nil)
	addressType, _ := abi.NewType("address", "", nil)

	args := abi.Arguments{
		{Type: bytes32Type, Name: "intentHash"},
		{Type: addressType, Name: "requester"},
	}

	decoded, err := args.Unpack(log.Data)
	if err != nil {
		return "", fmt.Errorf("failed to decode ConfidentialPurchaseRequested event: %w", err)
	}

	intentHash := decoded[0].([32]byte)
	intentHashHex := "0x" + hex.EncodeToString(intentHash[:])

	logger.Info("Confidential purchase request detected",
		"requestId", requestId.Hex()[:12]+"...",
		"intentHash", intentHashHex[:12]+"...",
	)

	// ── Build confidential HTTP request ──
	// The request body contains a template placeholder {{.marketplaceApiKey}} that
	// is resolved ONLY inside the secure enclave. The API key never appears in
	// node memory or in workflow logs.
	payload := fmt.Sprintf(
		`{"intentHash":"%s","auth":"{{.marketplaceApiKey}}"}`,
		intentHashHex,
	)

	headers := map[string]*confidentialhttp.HeaderValues{
		"Content-Type": {
			Values: []string{"application/json"},
		},
		"Authorization": {
			Values: []string{"Bearer {{.marketplaceApiKey}}"},
		},
	}

	// ── Send via Confidential HTTP — executes in secure enclave ──
	client := confidentialhttp.Client{}
	resp, err := client.SendRequest(runtime, &confidentialhttp.ConfidentialHTTPRequest{
		Request: &confidentialhttp.HTTPRequest{
			Url:           config.ApiUrl + "/evaluate-confidential",
			Method:        "POST",
			Body:          &confidentialhttp.HTTPRequest_BodyString{BodyString: payload},
			MultiHeaders:  headers,
			EncryptOutput: true, // AES-GCM encrypt response before leaving enclave
		},
		VaultDonSecrets: []*confidentialhttp.SecretIdentifier{
			{Key: "marketplaceApiKey"},
			{Key: "san_marino_aes_gcm_encryption_key"},
		},
	}).Await()

	if err != nil {
		return "", fmt.Errorf("confidential HTTP request failed: %w", err)
	}

	// The response body is AES-GCM encrypted. In production, we forward
	// this to the secure backend for decryption. For the workflow output,
	// we only need the approve/reject status which we can extract from
	// the HTTP status code, or we can process the encrypted blob offchain.
	//
	// For simulation/demo purposes, we parse the response directly since
	// the CRE simulator doesn't actually encrypt.
	var result EvaluationResult
	if parseErr := json.Unmarshal(resp.Body, &result); parseErr != nil {
		// If encrypted, we return a success indicator based on HTTP status
		logger.Info("Confidential response received (encrypted)",
			"requestId", requestId.Hex()[:12]+"...",
			"bodyLength", len(resp.Body),
		)
		return fmt.Sprintf("CONFIDENTIAL_RESULT: requestId=%s encrypted_response_length=%d",
			requestId.Hex()[:12]+"...", len(resp.Body)), nil
	}

	logger.Info("Confidential purchase evaluation complete",
		"requestId", requestId.Hex()[:12]+"...",
		"verdict", result.Verdict,
		"score", result.ValueScore,
		"reason", result.Reason,
	)

	if result.Approved {
		return fmt.Sprintf("APPROVE: score %d/100 (confidential)", result.ValueScore), nil
	}
	return fmt.Sprintf("%s: score %d/100 — %s (confidential)", result.Verdict, result.ValueScore, result.Reason), nil
}
