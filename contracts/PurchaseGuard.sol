// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title PurchaseGuard
/// @notice Onchain spending guard for autonomous agents with post-purchase feedback.
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

    struct AgentReview {
        bytes32 requestId;
        address reviewer;
        uint8 qualityRating;   // 1-5
        uint8 deliveryRating;  // 1-5
        uint8 valueRating;     // 1-5
        string comment;
        uint256 timestamp;
    }

    mapping(bytes32 => PurchaseRequest) public requests;
    mapping(bytes32 => AgentReview) public reviews;
    mapping(string => bytes32[]) public itemReviews;  // itemId => reviewIds
    mapping(string => bytes32[]) public sellerReviews; // sellerId => reviewIds

    address public oracle;
    address public owner;
    uint256 private _nonce;

    event PurchaseRequested(bytes32 indexed requestId, string itemId, uint256 proposedPrice, string sellerId, address requester);
    event PurchaseApproved(bytes32 indexed requestId, uint256 referencePrice);
    event PurchaseRejected(bytes32 indexed requestId, uint256 referencePrice, string reason);
    event ReviewSubmitted(bytes32 indexed requestId, string itemId, string sellerId, uint8 quality, uint8 delivery, uint8 value, address reviewer);

    error Unauthorized();
    error AlreadyFulfilled();
    error NotApproved();
    error AlreadyReviewed();
    error InvalidRating();

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

    /// @notice Agent submits post-purchase feedback (only for approved purchases, only by original requester)
    function submitReview(
        bytes32 requestId,
        uint8 qualityRating,
        uint8 deliveryRating,
        uint8 valueRating,
        string calldata comment
    ) external {
        PurchaseRequest storage req = requests[requestId];
        if (req.requester != msg.sender) revert Unauthorized();
        if (!req.approved) revert NotApproved();
        if (reviews[requestId].timestamp != 0) revert AlreadyReviewed();
        if (qualityRating < 1 || qualityRating > 5 || deliveryRating < 1 || deliveryRating > 5 || valueRating < 1 || valueRating > 5) revert InvalidRating();

        reviews[requestId] = AgentReview({
            requestId: requestId,
            reviewer: msg.sender,
            qualityRating: qualityRating,
            deliveryRating: deliveryRating,
            valueRating: valueRating,
            comment: comment,
            timestamp: block.timestamp
        });

        itemReviews[req.itemId].push(requestId);
        sellerReviews[req.sellerId].push(requestId);

        emit ReviewSubmitted(requestId, req.itemId, req.sellerId, qualityRating, deliveryRating, valueRating, msg.sender);
    }

    function getReview(bytes32 requestId) external view returns (AgentReview memory) { return reviews[requestId]; }
    function getItemReviewCount(string calldata itemId) external view returns (uint256) { return itemReviews[itemId].length; }
    function getSellerReviewCount(string calldata sellerId) external view returns (uint256) { return sellerReviews[sellerId].length; }
    function setOracle(address _oracle) external onlyOwner { oracle = _oracle; }
    function getRequest(bytes32 requestId) external view returns (PurchaseRequest memory) { return requests[requestId]; }
}
