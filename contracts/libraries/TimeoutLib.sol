// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title TimeoutLib
/// @notice Timeout validation helpers for review period
library TimeoutLib {
    /// @notice Validate that a review timeout is in the allowed set
    /// @param timeout The timeout value in seconds
    /// @return valid True if the timeout is in the allowed set
    function isValidReviewTimeout(uint256 timeout) internal pure returns (bool) {
        return (
            timeout == 1 days  ||
            timeout == 3 days  ||
            timeout == 7 days  ||
            timeout == 14 days ||
            timeout == 21 days ||
            timeout == 30 days
        );
    }
}
