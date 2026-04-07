// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ReputationLib
/// @notice Scoring formulas for freelancer and client reputation
library ReputationLib {
    uint256 public constant PRECISION = 1e18;

    /// @notice Calculate freelancer reputation score
    /// @dev score = totalValueCompleted / (1 + L * 0.3 + C * 0.1)
    ///      In fixed-point: totalValueCompleted * PRECISION / (PRECISION + L * 3 * PRECISION / 10 + C * PRECISION / 10)
    /// @param totalValueCompleted Sum of V_i * m_i
    /// @param disputesLost Number of disputes lost (L)
    /// @param cancellations Number of voluntary cancellations (C)
    /// @return score Fixed-point score with 18 decimals
    function calculateFreelancerScore(
        uint256 totalValueCompleted,
        uint256 disputesLost,
        uint256 cancellations
    ) internal pure returns (uint256) {
        uint256 denominator = PRECISION
            + (disputesLost * 3 * PRECISION / 10)
            + (cancellations * PRECISION / 10);
        if (denominator == 0) return 0;
        return (totalValueCompleted * PRECISION) / denominator;
    }

    /// @notice Calculate client reputation score
    /// @dev score = totalValueCompleted * (jobsCompleted / jobsPosted) / (1 + L*0.3 + C*0.1 + A*0.05)
    /// @param totalValueCompleted Total value of completed jobs
    /// @param jobsPosted Total jobs posted
    /// @param jobsCompleted Total jobs completed
    /// @param disputesLost Number of disputes lost (L)
    /// @param jobsCancelledAfterSelection Jobs cancelled after freelancer selected (C)
    /// @param autoApproveCount Milestones auto-approved (A)
    /// @return score Fixed-point score with 18 decimals
    function calculateClientScore(
        uint256 totalValueCompleted,
        uint256 jobsPosted,
        uint256 jobsCompleted,
        uint256 disputesLost,
        uint256 jobsCancelledAfterSelection,
        uint256 autoApproveCount
    ) internal pure returns (uint256) {
        if (jobsPosted == 0) return 0;

        // completionRatio = jobsCompleted / jobsPosted (scaled by PRECISION)
        uint256 completionRatio = (jobsCompleted * PRECISION) / jobsPosted;

        // penalty = 1 + L*0.3 + C*0.1 + A*0.05
        uint256 penalty = PRECISION
            + (disputesLost * 3 * PRECISION / 10)
            + (jobsCancelledAfterSelection * PRECISION / 10)
            + (autoApproveCount * PRECISION / 20);

        if (penalty == 0) return 0;
        return (totalValueCompleted * completionRatio) / penalty;
    }
}
