// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title PurchaseGuard
/// @notice Onchain spending guard for autonomous agents with privacy-preserving purchase evaluation.
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

    struct ConfidentialRequest {
        bytes32 intentHash;      // keccak256(itemId, price, sellerId, salt)
        address requester;
        bool fulfilled;
        bool approved;
        bool revealed;           // true after reveal phase
        uint256 referencePrice;
        uint256 timestamp;
    }

    struct AgentReview {
        bytes32 requestId;
        address reviewer;
        uint8 qualityRating;
        uint8 deliveryRating;
        uint8 valueRating;
        string comment;
        uint256 timestamp;
    }

    mapping(bytes32 => PurchaseRequest) public requests;
    mapping(bytes32 => ConfidentialRequest) public confidentialRequests;
    mapping(bytes32 => AgentReview) public reviews;
    mapping(string => bytes32[]) public itemReviews;
    mapping(string => bytes32[]) public sellerReviews;

    address public oracle;
    address public owner;
    uint256 private _nonce;

    event PurchaseRequested(bytes32 indexed requestId, string itemId, uint256 proposedPrice, string sellerId, address requester);
    event ConfidentialPurchaseRequested(bytes32 indexed requestId, bytes32 intentHash, address requester);
    event ConfidentialPurchaseRevealed(bytes32 indexed requestId, string itemId, uint256 proposedPrice, string sellerId);
    event PurchaseApproved(bytes32 indexed requestId, uint256 referencePrice);
    event PurchaseRejected(bytes32 indexed requestId, uint256 referencePrice, string reason);
    event ReviewSubmitted(bytes32 indexed requestId, string itemId, string sellerId, uint8 quality, uint8 delivery, uint8 value, address reviewer);

    error Unauthorized();
    error AlreadyFulfilled();
    error NotApproved();
    error AlreadyReviewed();
    error InvalidRating();
    error InvalidReveal();
    error AlreadyRevealed();

    modifier onlyOracle() { if (msg.sender != oracle) revert Unauthorized(); _; }
    modifier onlyOwner()  { if (msg.sender != owner)  revert Unauthorized(); _; }

    constructor(address _oracle) {
        oracle = _oracle;
        owner = msg.sender;
    }

    /// @notice Standard purchase request (public intent)
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

    /// @notice Confidential purchase — only a hash of the intent is stored onchain.
    ///         The oracle receives the plaintext via Confidential HTTP (offchain).
    ///         Competitors cannot see what the agent is buying or at what price.
    function requestConfidentialPurchase(bytes32 intentHash) external returns (bytes32 requestId) {
        requestId = keccak256(abi.encodePacked(intentHash, msg.sender, block.timestamp, _nonce++));

        confidentialRequests[requestId] = ConfidentialRequest({
            intentHash: intentHash,
            requester: msg.sender,
            fulfilled: false,
            approved: false,
            revealed: false,
            referencePrice: 0,
            timestamp: block.timestamp
        });

        emit ConfidentialPurchaseRequested(requestId, intentHash, msg.sender);
    }

    /// @notice Oracle fulfills confidential purchase decision
    function fulfillConfidentialDecision(bytes32 requestId, bool approved, uint256 referencePrice) external onlyOracle {
        ConfidentialRequest storage req = confidentialRequests[requestId];
        if (req.fulfilled) revert AlreadyFulfilled();

        req.fulfilled = true;
        req.approved = approved;
        req.referencePrice = referencePrice;

        if (approved) {
            emit PurchaseApproved(requestId, referencePrice);
        } else {
            emit PurchaseRejected(requestId, referencePrice, "Confidential evaluation failed");
        }
    }

    /// @notice Reveal phase — agent can optionally reveal purchase details after fulfillment.
    ///         Verifies the revealed data matches the original commitment hash.
    function revealPurchase(
        bytes32 requestId,
        string calldata itemId,
        uint256 proposedPrice,
        string calldata sellerId,
        bytes32 salt
    ) external {
        ConfidentialRequest storage req = confidentialRequests[requestId];
        if (req.requester != msg.sender) revert Unauthorized();
        if (req.revealed) revert AlreadyRevealed();

        bytes32 computed = keccak256(abi.encodePacked(itemId, proposedPrice, sellerId, salt));
        if (computed != req.intentHash) revert InvalidReveal();

        req.revealed = true;
        emit ConfidentialPurchaseRevealed(requestId, itemId, proposedPrice, sellerId);
    }

    /// @notice Oracle delivers the value verdict (standard mode)
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

    /// @notice Agent submits post-purchase feedback
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
    function getConfidentialRequest(bytes32 requestId) external view returns (ConfidentialRequest memory) { return confidentialRequests[requestId]; }
    function setOracle(address _oracle) external onlyOwner { oracle = _oracle; }
    function getRequest(bytes32 requestId) external view returns (PurchaseRequest memory) { return requests[requestId]; }
}
