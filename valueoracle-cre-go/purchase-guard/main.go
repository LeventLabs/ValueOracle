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

type Config struct {
	ApiUrl          string `json:"apiUrl"`
	ContractAddress string `json:"contractAddress"`
	ChainSelector   uint64 `json:"chainSelector"`
}

// Decision engine response. consensus:"identical" ensures all nodes agree.
type EvaluationResult struct {
	Approved       bool   `json:"approved"       consensus:"identical"`
	Verdict        string `json:"verdict"        consensus:"identical"`
	ValueScore     int    `json:"valueScore"     consensus:"identical"`
	ReferencePrice int    `json:"referencePrice" consensus:"identical"`
	EffectivePrice int    `json:"effectivePrice" consensus:"identical"`
	Reason         string `json:"reason"         consensus:"identical"`
}

// Precomputed event topic hashes
var (
	// keccak256("PurchaseRequested(bytes32,string,uint256,string,address)")
	purchaseRequestedHash = common.HexToHash("0x988c14f7beb894f08706497c45dc5e51c2512175516cb23ab286daafc4cc3e8e")

	// keccak256("ConfidentialPurchaseRequested(bytes32,bytes32,address)")
	confidentialPurchaseRequestedHash = common.HexToHash("0x931d2b54641525ce2c56d62962767aef20740d6e655ffc705e2935a6f0afc62d")
)

// InitWorkflow registers two EVM log triggers on PurchaseGuard:
// 1. Standard purchases  -> http.Client        -> /evaluate
// 2. Confidential purchases -> confidentialhttp.Client -> /evaluate-confidential
func InitWorkflow(config *Config, logger *slog.Logger, secretsProvider cre.SecretsProvider) (cre.Workflow[*Config], error) {
	contractAddr := common.HexToAddress(config.ContractAddress)

	standardTrigger := evm.LogTrigger(config.ChainSelector, &evm.FilterLogTriggerRequest{
		Addresses: [][]byte{contractAddr.Bytes()},
		Topics: []*evm.TopicValues{
			{Values: [][]byte{purchaseRequestedHash.Bytes()}},
		},
	})

	confidentialTrigger := evm.LogTrigger(config.ChainSelector, &evm.FilterLogTriggerRequest{
		Addresses: [][]byte{contractAddr.Bytes()},
		Topics: []*evm.TopicValues{
			{Values: [][]byte{confidentialPurchaseRequestedHash.Bytes()}},
		},
	})

	return cre.Workflow[*Config]{
		cre.Handler(standardTrigger, onStandardPurchase),
		cre.Handler(confidentialTrigger, onConfidentialPurchase),
	}, nil
}

// Standard purchase handler — public intent, consensus-based HTTP
func onStandardPurchase(config *Config, runtime cre.Runtime, log *evm.Log) (string, error) {
	logger := runtime.Logger()
	requestId := common.BytesToHash(log.Topics[1])

	// Decode non-indexed params: (string itemId, uint256 proposedPrice, string sellerId, address requester)
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
		return "", fmt.Errorf("decode PurchaseRequested: %w", err)
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

	payload := fmt.Sprintf(
		`{"itemId":"%s","price":%d,"sellerId":"%s"}`,
		itemId, proposedPrice.Int64(), sellerId,
	)

	httpClient := &http.Client{}

	fetchDecision := func(config *Config, logger *slog.Logger, sendRequester *http.SendRequester) (EvaluationResult, error) {
		httpResp, reqErr := sendRequester.SendRequest(&http.Request{
			Url:    config.ApiUrl + "/evaluate",
			Method: "POST",
			Body:   []byte(payload),
			Headers: map[string]string{
				"Content-Type": "application/json",
			},
		}).Await()

		if reqErr != nil {
			return EvaluationResult{}, fmt.Errorf("HTTP request failed: %w", reqErr)
		}

		var result EvaluationResult
		if parseErr := json.Unmarshal(httpResp.Body, &result); parseErr != nil {
			return EvaluationResult{}, fmt.Errorf("parse response: %w", parseErr)
		}
		return result, nil
	}

	result, err := http.SendRequest[*Config, EvaluationResult](
		config,
		runtime,
		httpClient,
		fetchDecision,
		cre.ConsensusAggregationFromTags[EvaluationResult](),
	).Await()
	if err != nil {
		return "", fmt.Errorf("decision engine call failed: %w", err)
	}

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

// Confidential purchase handler — enclave execution via ConfidentialHTTPClient.
// API credentials injected inside enclave via Vault DON template syntax.
// Response AES-GCM encrypted before leaving enclave.
func onConfidentialPurchase(config *Config, runtime cre.Runtime, log *evm.Log) (string, error) {
	logger := runtime.Logger()
	requestId := common.BytesToHash(log.Topics[1])

	// Decode non-indexed params: (bytes32 intentHash, address requester)
	bytes32Type, _ := abi.NewType("bytes32", "", nil)
	addressType, _ := abi.NewType("address", "", nil)

	args := abi.Arguments{
		{Type: bytes32Type, Name: "intentHash"},
		{Type: addressType, Name: "requester"},
	}

	decoded, err := args.Unpack(log.Data)
	if err != nil {
		return "", fmt.Errorf("decode ConfidentialPurchaseRequested: %w", err)
	}

	intentHash := decoded[0].([32]byte)
	intentHashHex := "0x" + hex.EncodeToString(intentHash[:])

	logger.Info("Confidential purchase request detected",
		"requestId", requestId.Hex()[:12]+"...",
		"intentHash", intentHashHex[:12]+"...",
	)

	// {{.marketplaceApiKey}} resolved only inside the secure enclave
	payload := fmt.Sprintf(
		`{"intentHash":"%s","auth":"{{.marketplaceApiKey}}"}`,
		intentHashHex,
	)

	client := confidentialhttp.Client{}
	resp, err := client.SendRequest(runtime, &confidentialhttp.ConfidentialHTTPRequest{
		Request: &confidentialhttp.HTTPRequest{
			Url:    config.ApiUrl + "/evaluate-confidential",
			Method: "POST",
			Body:   &confidentialhttp.HTTPRequest_BodyString{BodyString: payload},
			MultiHeaders: map[string]*confidentialhttp.HeaderValues{
				"Content-Type":  {Values: []string{"application/json"}},
				"Authorization": {Values: []string{"Bearer {{.marketplaceApiKey}}"}},
			},
			EncryptOutput: true,
		},
		VaultDonSecrets: []*confidentialhttp.SecretIdentifier{
			{Key: "marketplaceApiKey"},
			{Key: "san_marino_aes_gcm_encryption_key"},
		},
	}).Await()

	if err != nil {
		return "", fmt.Errorf("confidential HTTP request failed: %w", err)
	}

	// In production the response is AES-GCM encrypted — decrypt offchain.
	// In simulation the CRE simulator returns plaintext.
	var result EvaluationResult
	if parseErr := json.Unmarshal(resp.Body, &result); parseErr != nil {
		logger.Info("Confidential response received (encrypted)",
			"requestId", requestId.Hex()[:12]+"...",
			"bodyLength", len(resp.Body),
		)
		return fmt.Sprintf("CONFIDENTIAL_RESULT: requestId=%s encrypted_len=%d",
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

func main() {
	fmt.Println("ValueOracle Go Workflow — run with: cre workflow simulate")
}
