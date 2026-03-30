// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IDataAvailability
/// @notice Interface for the DataAvailability CID registry
interface IDataAvailability {
    enum ContentType { Agreement, Deliverable, Evidence, Proposal }

    /// @notice Register a CID on-chain for data availability tracking
    /// @param cid The IPFS CID string
    /// @param contentType The type of content
    /// @param jobId The associated job ID
    /// @return cidHash The keccak256 hash of the CID
    function registerCID(
        string calldata cid,
        ContentType contentType,
        uint256 jobId
    ) external returns (bytes32 cidHash);

    /// @notice Set retention expiry for all CIDs of a job
    /// @param jobId The job ID
    /// @param expiryTimestamp The timestamp after which content may be unpinned
    function setRetentionExpiry(uint256 jobId, uint256 expiryTimestamp) external;

    /// @notice Get a CID record by its hash
    /// @param cidHash The keccak256 hash of the CID
    function getCIDRecord(bytes32 cidHash) external view returns (
        string memory cid,
        ContentType contentType,
        address uploader,
        uint256 jobId,
        uint256 registeredAt,
        uint256 retentionExpiry
    );

    /// @notice Get all CID hashes for a job
    /// @param jobId The job ID
    /// @return cidHashes Array of CID hashes
    function getJobCIDs(uint256 jobId) external view returns (bytes32[] memory cidHashes);
}
