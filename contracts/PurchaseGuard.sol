// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title PurchaseGuard
 * @notice Smart contract that protects AI agents from overpaying by requiring oracle approval
 * @dev Integrates with Chainlink CRE for offchain value verification
 */
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

    event PurchaseRequested(
        bytes32 indexed requestId,
        string itemId,
        uint256 proposedPrice,
        string sellerId,
        address requester
    );
    
    event PurchaseApproved(
        bytes32 indexed requestId,
        uint256 referencePrice
    );
    
    event PurchaseRejected(
        bytes32 indexed requestId,
        uint256 referencePrice,
        string reason
    );

    modifier onlyOracle() {
        require(msg.sender == oracle, "Only oracle can fulfill");
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    constructor(address _oracle) {
        oracle = _oracle;
        owner = msg.sender;
    }

    /**
     * @notice Agent submits purchase intent for oracle evaluation
     * @param itemId Product identifier
     * @param proposedPrice Price agent is willing to pay (in wei or smallest unit)
     * @param sellerId Seller identifier
     * @return requestId Unique request identifier
     */
    function requestPurchase(
        string memory itemId,
        uint256 proposedPrice,
        string memory sellerId
    ) external returns (bytes32) {
        bytes32 requestId = keccak256(
            abi.encodePacked(itemId, proposedPrice, sellerId, msg.sender, block.timestamp)
        );

        require(!requests[requestId].fulfilled, "Request already exists");

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
        return requestId;
    }

    /**
     * @notice Oracle fulfills the request with approval decision
     * @param requestId Request to fulfill
     * @param approved Whether purchase represents fair value
     * @param referencePrice Market reference price from oracle
     */
    function fulfillOracleDecision(
        bytes32 requestId,
        bool approved,
        uint256 referencePrice
    ) external onlyOracle {
        PurchaseRequest storage request = requests[requestId];
        require(!request.fulfilled, "Already fulfilled");

        request.fulfilled = true;
        request.approved = approved;
        request.referencePrice = referencePrice;

        if (approved) {
            emit PurchaseApproved(requestId, referencePrice);
        } else {
            string memory reason = request.proposedPrice > referencePrice * 110 / 100
                ? "Price exceeds market value"
                : "Seller trust score too low";
            emit PurchaseRejected(requestId, referencePrice, reason);
        }
    }

    /**
     * @notice Update oracle address
     */
    function setOracle(address _oracle) external onlyOwner {
        oracle = _oracle;
    }

    /**
     * @notice Get request details
     */
    function getRequest(bytes32 requestId) external view returns (PurchaseRequest memory) {
        return requests[requestId];
    }
}
