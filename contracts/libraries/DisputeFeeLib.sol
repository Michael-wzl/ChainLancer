// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title DisputeFeeLib
/// @notice Dispute fee calculation: max(50 USDC, 10% * milestoneValue)
library DisputeFeeLib {
    uint256 public constant FEE_BASE = 50e6;        // 50 USDC (6 decimals)
    uint256 public constant FEE_BPS = 1000;          // 10%

    /// @notice Calculate dispute fee: max(50 USDC, 10% * milestoneValue)
    /// @param milestoneValue The USDC value of the disputed milestone (6 decimals)
    /// @return fee The dispute fee in USDC (6 decimals)
    function calculateFee(uint256 milestoneValue) internal pure returns (uint256) {
        uint256 proportional = (milestoneValue * FEE_BPS) / 10_000;
        return proportional > FEE_BASE ? proportional : FEE_BASE;
    }
}
