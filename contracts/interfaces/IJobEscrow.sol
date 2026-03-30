// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IJobEscrow
/// @notice Interface for Dispute → JobEscrow callbacks
interface IJobEscrow {
    enum JobState { Open, Applications, Active, Completed, Cancelled, Abandoned }
    enum MilestoneStatus { Pending, InReview, Approved, AutoApproved, Disputed, Resolved }

    /// @notice Called by Dispute.sol to apply a ruling's fund redistribution.
    /// @dev Only callable by the address with DISPUTE_ROLE.
    ///      Atomically: updates milestone status, redistributes funds,
    ///      triggers reputation update.
    /// @param jobId The job ID
    /// @param milestoneIdx The milestone index
    /// @param ruling 0 = Inconclusive, 1 = FreelancerWins, 2 = ClientWins
    /// @param freelancerShareBps BPS (0-10000) of milestone value going to freelancer
    /// @param depositSlashBps BPS of freelancer deposit to slash (ClientWins only)
    function executeDisputeRuling(
        uint256 jobId,
        uint256 milestoneIdx,
        uint8 ruling,
        uint256 freelancerShareBps,
        uint256 depositSlashBps
    ) external;

    /// @notice Selected freelancer explicitly rejects the offer
    /// @param jobId The job ID
    function rejectOffer(uint256 jobId) external;

    /// @notice Anyone can clear a stale offer after T_STAKE expires
    /// @param jobId The job ID
    function expireOffer(uint256 jobId) external;

    /// @notice View: get job info for dispute validation
    function getJobInfo(uint256 jobId) external view returns (
        address client,
        address freelancer,
        JobState state,
        uint256 totalValue,
        uint256 freelancerDeposit,
        uint256 behaviorBond,
        uint256 reviewTimeout
    );

    /// @notice View: get milestone info for dispute validation
    function getMilestoneInfo(uint256 jobId, uint256 milestoneIdx) external view returns (
        uint256 value,
        MilestoneStatus status,
        uint256 submittedAt
    );
}
