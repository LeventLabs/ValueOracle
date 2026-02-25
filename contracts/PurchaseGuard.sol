// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title PurchaseGuard
/// @notice Onchain spending guard for autonomous agents. Requires oracle approval before purchase execution.
contract PurchaseGuard {
    struct PurchaseRequest {
        string itemId;
        uint256 proposedPrice;
        string sellerId;
        address requester;
        bool fulfilled;
        bool approved;
        uint256 referencePrice;
        uint256 timestamp;
    }

    mapping(bytes32 => PurchaseRequest) public requests;

    address public oracle;
    address public owner;
    uint256 private _nonce;

    event PurchaseRequested(bytes32 indexed requestId, string itemId, uint256 proposedPrice, string sellerId, address requester);
    event PurchaseApproved(bytes32 indexed requestId, uint256 referencePrice);
    event PurchaseRejected(bytes32 indexed requestId, uint256 referencePrice, string reason);

    error Unauthorized();
    error AlreadyFulfilled();

    modifier onlyOracle() { if (msg.sender != oracle) revert Unauthorized(); _; }
    modifier onlyOwner()  { if (msg.sender != owner)  revert Unauthorized(); _; }

    constructor(address _oracle) {
        oracle = _oracle;
        owner = msg.sender;
    }

    /// @notice Submit purchase intent for oracle evaluation
    function requestPurchase(
        string calldata itemId,
        uint256 proposedPrice,
        string calldata sellerId
    ) external returns (bytes32 requestId) {
        requestId = keccak256(abi.encodePacked(itemId, proposedPrice, sellerId, msg.sender, block.timestamp, _nonce++));

        requests[requestId] = PurchaseRequest({
            itemId: itemId,
            proposedPrice: proposedPrice,
            sellerId: sellerId,
            requester: msg.sender,
            fulfilled: false,
            approved: false,
            referencePrice: 0,
            timestamp: block.timestamp
        });

        emit PurchaseRequested(requestId, itemId, proposedPrice, sellerId, msg.sender);
    }

    /// @notice Oracle delivers the value verdict
    function fulfillOracleDecision(bytes32 requestId, bool approved, uint256 referencePrice) external onlyOracle {
        PurchaseRequest storage req = requests[requestId];
        if (req.fulfilled) revert AlreadyFulfilled();

        req.fulfilled = true;
        req.approved = approved;
        req.referencePrice = referencePrice;

        if (approved) {
            emit PurchaseApproved(requestId, referencePrice);
        } else {
            string memory reason = req.proposedPrice > (referencePrice * 110) / 100
                ? "Price exceeds market value"
                : "Seller trust score too low";
            emit PurchaseRejected(requestId, referencePrice, reason);
        }
    }

    function setOracle(address _oracle) external onlyOwner { oracle = _oracle; }
    function getRequest(bytes32 requestId) external view returns (PurchaseRequest memory) { return requests[requestId]; }
}
