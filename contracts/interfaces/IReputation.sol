// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IReputation
/// @notice Interface for the soulbound Reputation contract
interface IReputation {
    enum Tier { New, Bronze, Silver, Gold }

    /// @notice Record a milestone completion (clean or via dispute)
    /// @param freelancer The freelancer's address
    /// @param milestoneValue The USDC value of the milestone
    /// @param wasDisputed Whether the milestone was disputed
    /// @param freelancerWon If disputed, whether the freelancer won
    function recordMilestoneCompletion(
        address freelancer,
        uint256 milestoneValue,
        bool wasDisputed,
        bool freelancerWon
    ) external;

    /// @notice Record a dispute loss for a freelancer
    /// @param freelancer The freelancer's address
    function recordFreelancerDisputeLoss(address freelancer) external;

    /// @notice Record a dispute loss for a client
    /// @param client The client's address
    function recordClientDisputeLoss(address client) external;

    /// @notice Record a new job posted by a client
    /// @param client The client's address
    function recordClientJobPosted(address client) external;

    /// @notice Record a cancellation after freelancer selection
    /// @param client The client's address
    function recordClientCancellation(address client) external;

    /// @notice Record a milestone auto-approval for a client
    /// @param client The client's address
    function recordClientAutoApprove(address client) external;

    /// @notice Increment totalMilestoneCount for a client (called per milestone resolution)
    /// @param client The client's address
    function recordMilestoneResolved(address client) external;

    /// @notice Record a job completion for a client
    /// @param client The client's address
    /// @param totalValue Total job value
    /// @param milestoneCount Number of milestones in the completed job
    function recordJobCompleted(address client, uint256 totalValue, uint256 milestoneCount) external;

    /// @notice Record a job completion for a freelancer
    /// @param freelancer The freelancer's address
    function recordFreelancerJobCompleted(address freelancer) external;

    /// @notice Record a cancellation penalty for a freelancer
    /// @param freelancer The freelancer's address
    function recordFreelancerCancellation(address freelancer) external;

    /// @notice Get the trust tier for a client (determines behavior bond requirement)
    /// @param client The client's address
    /// @return tier The client's tier
    function getClientTier(address client) external view returns (Tier);

    /// @notice Get the trust tier for a freelancer
    /// @param freelancer The freelancer's address
    /// @return tier The freelancer's tier
    function getFreelancerTier(address freelancer) external view returns (Tier);

    /// @notice Get the freelancer's reputation score
    /// @param user The freelancer's address
    /// @return score Fixed-point score (18 decimals)
    function getFreelancerScore(address user) external view returns (uint256);

    /// @notice Get the client's reputation score
    /// @param user The client's address
    /// @return score Fixed-point score (18 decimals)
    function getClientScore(address user) external view returns (uint256);
}
