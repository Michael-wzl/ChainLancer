// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IDispute
/// @notice Interface for JobEscrow → Dispute calls
interface IDispute {
    enum DisputePhase { Evidence, AwaitingJudge, KeyDistribution, UnderReview, Ruled, Executed }
    enum Ruling { Inconclusive, FreelancerWins, ClientWins }

    /// @notice Called by JobEscrow when a party raises a dispute
    /// @param jobId The job ID
    /// @param milestoneIdx The milestone index being disputed
    /// @param initiator The address that raised the dispute
    /// @param client The client's address
    /// @param freelancer The freelancer's address
    /// @param milestoneValue The USDC value of the disputed milestone
    /// @return disputeId The newly created dispute ID
    function createDispute(
        uint256 jobId,
        uint256 milestoneIdx,
        address initiator,
        address client,
        address freelancer,
        uint256 milestoneValue
    ) external returns (uint256 disputeId);

    /// @notice Get the current status of a dispute
    /// @param disputeId The dispute ID
    /// @return phase The current dispute phase
    /// @return ruling The ruling value (0=Inconclusive, 1=FreelancerWins, 2=ClientWins)
    function getDisputeStatus(uint256 disputeId) external view returns (DisputePhase phase, uint8 ruling);
}
