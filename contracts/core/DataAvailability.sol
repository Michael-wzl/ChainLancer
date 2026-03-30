// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "../interfaces/IDataAvailability.sol";
import "../access/PlatformRoles.sol";

/// @title DataAvailability
/// @notice On-chain CID registry for IPFS content. Emits events consumed by
///         the platform's off-chain IPFS pinning service for data availability.
contract DataAvailability is IDataAvailability, AccessControl {
    // ── Storage ──
    struct CIDRecord {
        string cid;
        ContentType contentType;
        address uploader;
        uint256 jobId;
        uint256 registeredAt;
        uint256 retentionExpiry;
    }

    mapping(bytes32 => CIDRecord) internal _cidRecords;   // keccak256(cid) => CIDRecord
    mapping(uint256 => bytes32[]) internal _jobCIDs;       // jobId => list of CID hashes

    // ── Events ──
    event CIDRegistered(uint256 indexed jobId, string cid, ContentType contentType, address uploader);
    event RetentionExpirySet(uint256 indexed jobId, uint256 expiryTimestamp);

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /// @inheritdoc IDataAvailability
    function registerCID(
        string calldata cid,
        ContentType contentType,
        uint256 jobId
    ) external override returns (bytes32 cidHash) {
        require(bytes(cid).length > 0, "Empty CID");

        cidHash = keccak256(bytes(cid));
        require(_cidRecords[cidHash].registeredAt == 0, "CID already registered");

        _cidRecords[cidHash] = CIDRecord({
            cid: cid,
            contentType: contentType,
            uploader: msg.sender,
            jobId: jobId,
            registeredAt: block.timestamp,
            retentionExpiry: 0
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

    /// @inheritdoc IDataAvailability
    function getJobCIDs(uint256 jobId) external view override returns (bytes32[] memory cidHashes) {
        return _jobCIDs[jobId];
    }
}
