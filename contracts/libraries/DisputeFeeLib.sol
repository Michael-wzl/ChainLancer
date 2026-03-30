// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title DisputeFeeLib
/// @notice Dispute fee calculation: max(10 USDC, min(1% * milestoneValue, 1000 USDC))
library DisputeFeeLib {
    uint256 public constant FEE_BASE = 10e6;       // 10 USDC (6 decimals)
    uint256 public constant FEE_CAP = 1_000e6;     // 1,000 USDC
    uint256 public constant FEE_BPS = 100;          // 1%

    /// @notice Calculate dispute fee: max(10 USDC, min(1% * milestoneValue, 1000 USDC))
    /// @param milestoneValue The USDC value of the disputed milestone (6 decimals)
    /// @return fee The dispute fee in USDC (6 decimals)
    function calculateFee(uint256 milestoneValue) internal pure returns (uint256) {
        uint256 proportional = (milestoneValue * FEE_BPS) / 10_000;
        uint256 capped = proportional < FEE_CAP ? proportional : FEE_CAP;
        return capped > FEE_BASE ? capped : FEE_BASE;
    }
}
