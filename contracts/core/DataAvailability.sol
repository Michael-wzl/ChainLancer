// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/access/extensions/AccessControlDefaultAdminRulesUpgradeable.sol";
import "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import "../interfaces/IDataAvailability.sol";
import "../access/PlatformRoles.sol";

/// @title DataAvailability
/// @notice On-chain CID registry for IPFS content. Emits events consumed by
///         the platform's off-chain IPFS pinning service for data availability.
contract DataAvailability is IDataAvailability, AccessControlDefaultAdminRulesUpgradeable, UUPSUpgradeable {
    // ── Constants ──
    uint256 public constant MAX_CIDS_PER_JOB = 50;

    // ── Storage ──
    struct CIDRecord {
        string cid;
        ContentType contentType;
        address uploader;
        uint256 jobId;
        uint256 registeredAt;
        uint256 retentionExpiry;
        bool pinned;
    }

    mapping(bytes32 => CIDRecord) internal _cidRecords;   // keccak256(cid) => CIDRecord
    mapping(uint256 => bytes32[]) internal _jobCIDs;       // jobId => list of CID hashes

    // ── Events ──
    event CIDRegistered(uint256 indexed jobId, string cid, ContentType contentType, address uploader);
    event RetentionExpirySet(uint256 indexed jobId, uint256 expiryTimestamp);
    event PinningConfirmed(bytes32 indexed cidHash, uint256 indexed jobId);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initializer replaces constructor for proxy pattern
    /// @param initialAdmin The initial admin address
    /// @param adminTransferDelay Delay (seconds) for admin transfer via AccessControlDefaultAdminRules
    function initialize(address initialAdmin, uint48 adminTransferDelay) external initializer {
        __AccessControlDefaultAdminRules_init(adminTransferDelay, initialAdmin);
    }

    /// @notice Authorize contract upgrades — restricted to DEFAULT_ADMIN_ROLE
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    /// @inheritdoc IDataAvailability
    function registerCID(
        string calldata cid,
        ContentType contentType,
        uint256 jobId
    ) external override returns (bytes32 cidHash) {
        // M-6: Only system contracts can register CIDs
        require(
            hasRole(PlatformRoles.ESCROW_ROLE, msg.sender) ||
            hasRole(PlatformRoles.DISPUTE_ROLE, msg.sender) ||
            hasRole(DEFAULT_ADMIN_ROLE, msg.sender),
            "Not authorized to register CID"
        );
        require(bytes(cid).length > 0, "Empty CID");

        cidHash = keccak256(bytes(cid));
        // Allow duplicate CIDs: if already registered, return existing hash
        if (_cidRecords[cidHash].registeredAt != 0) {
            return cidHash;
        }
        // M-7: Cap CIDs per job
        require(_jobCIDs[jobId].length < MAX_CIDS_PER_JOB, "Too many CIDs for this job");

        _cidRecords[cidHash] = CIDRecord({
            cid: cid,
            contentType: contentType,
            uploader: msg.sender,
            jobId: jobId,
            registeredAt: block.timestamp,
            retentionExpiry: 0,
            pinned: false
        });
        _jobCIDs[jobId].push(cidHash);

        emit CIDRegistered(jobId, cid, contentType, msg.sender);
    }

    /// @inheritdoc IDataAvailability
    function setRetentionExpiry(uint256 jobId, uint256 expiryTimestamp) external override {
        // Only authorized contracts (JobEscrow, Dispute) can set expiry
        require(
            hasRole(PlatformRoles.ESCROW_ROLE, msg.sender) ||
            hasRole(PlatformRoles.DISPUTE_ROLE, msg.sender) ||
            hasRole(DEFAULT_ADMIN_ROLE, msg.sender),
            "Not authorized"
        );

        bytes32[] storage cidHashes = _jobCIDs[jobId];
        for (uint256 i = 0; i < cidHashes.length; i++) {
            _cidRecords[cidHashes[i]].retentionExpiry = expiryTimestamp;
        }

        emit RetentionExpirySet(jobId, expiryTimestamp);
    }

    /// @inheritdoc IDataAvailability
    function getCIDRecord(bytes32 cidHash) external view override returns (
        string memory cid,
        ContentType contentType,
        address uploader,
        uint256 jobId,
        uint256 registeredAt,
        uint256 retentionExpiry
    ) {
        CIDRecord storage record = _cidRecords[cidHash];
        return (
            record.cid,
            record.contentType,
            record.uploader,
            record.jobId,
            record.registeredAt,
            record.retentionExpiry
        );
    }

    /// @notice Confirm that a CID has been pinned by the off-chain service
    /// @param cidHash The keccak256 hash of the CID
    function confirmPinning(bytes32 cidHash) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_cidRecords[cidHash].registeredAt > 0, "CID not registered");
        require(!_cidRecords[cidHash].pinned, "Already pinned");
        _cidRecords[cidHash].pinned = true;
        emit PinningConfirmed(cidHash, _cidRecords[cidHash].jobId);
    }

    /// @notice Check whether a CID's pinning has been confirmed
    /// @param cidHash The keccak256 hash of the CID
    /// @return True if pinning confirmed
    function isPinned(bytes32 cidHash) external view returns (bool) {
        return _cidRecords[cidHash].pinned;
    }

    /// @notice Check whether a CID's retention period has expired
    /// @param cidHash The keccak256 hash of the CID
    /// @return True if retention has expired and content may be unpinned
    function isRetentionExpired(bytes32 cidHash) external view returns (bool) {
        CIDRecord storage record = _cidRecords[cidHash];
        if (record.registeredAt == 0) return false;
        if (record.retentionExpiry == 0) return false; // No expiry set yet
        return block.timestamp > record.retentionExpiry;
    }

    /// @inheritdoc IDataAvailability
    function getJobCIDs(uint256 jobId) external view override returns (bytes32[] memory cidHashes) {
        return _jobCIDs[jobId];
    }
}
