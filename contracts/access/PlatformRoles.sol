// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PlatformRoles
/// @notice Role definitions for access control across the ChainLancer platform
library PlatformRoles {
    /// @notice Granted to the JobEscrow contract address
    bytes32 public constant ESCROW_ROLE = keccak256("ESCROW_ROLE");

    /// @notice Granted to the Dispute contract address
    bytes32 public constant DISPUTE_ROLE = keccak256("DISPUTE_ROLE");

    /// @notice Granted to the platform admin (multisig)
    bytes32 public constant PLATFORM_ADMIN = keccak256("PLATFORM_ADMIN");

    /// @notice Granted to judge address(es)
    bytes32 public constant PLATFORM_JUDGE = keccak256("PLATFORM_JUDGE");

    /// @notice Granted to the protocol treasury address.
    /// @dev Reserved for future governance features such as treasury-controlled
    ///      fee adjustments, protocol parameter voting, or fund distribution.
    ///      Currently unused in access control checks — see audit finding I-1.
    bytes32 public constant PROTOCOL_TREASURY = keccak256("PROTOCOL_TREASURY");
}
