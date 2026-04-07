// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IReputation.sol";

/// @title JobEscrowLib
/// @notice External library for JobEscrow to reduce contract size below the 24KB EVM limit.
///         Contains dispute ruling fund distribution logic and tier-based BPS helpers.
/// @dev Functions are `public` so the library is deployed separately and called via delegatecall.
library JobEscrowLib {
    // ── Constants (must mirror JobEscrow) ──
    uint256 public constant PROTOCOL_FEE_BPS = 200;             // 2%
    uint256 public constant BOND_SLASH_MAX_BPS = 300;            // 3% of milestone value
    uint256 public constant DEPOSIT_SLASH_MAX_BPS = 5000;        // 50% of deposit

    uint256 public constant FREELANCER_DEPOSIT_NEW_BPS = 750;
    uint256 public constant FREELANCER_DEPOSIT_BRONZE_BPS = 500;
    uint256 public constant FREELANCER_DEPOSIT_SILVER_BPS = 250;
    uint256 public constant FREELANCER_DEPOSIT_GOLD_BPS = 100;

    uint256 public constant BEHAVIOR_BOND_NEW_BPS = 750;
    uint256 public constant BEHAVIOR_BOND_BRONZE_BPS = 500;
    uint256 public constant BEHAVIOR_BOND_SILVER_BPS = 250;
    uint256 public constant BEHAVIOR_BOND_GOLD_BPS = 100;

    // ── Structs for passing data to library (avoids stack-too-deep) ──
    struct RulingContext {
        address freelancer;
        address client;
        address treasury;
        uint256 freelancerDeposit;
        uint256 behaviorBond;
        uint256 totalValue;
        uint256 msValue;
        uint256 disputeFee;
        address disputeInitiator;
        bool bondRefunded;
    }

    struct RulingResult {
        uint256 freelancerCredit;
        uint256 clientCredit;
        uint256 treasuryCredit;
        uint256 newDeposit;
        uint256 newBond;
        bool markBondRefunded;
        address feeRecipient;
        uint256 feeAmount;
    }

    /// @notice Compute fund distribution for a dispute ruling
    /// @param ctx All context needed for the computation
    /// @param ruling 0 = Inconclusive, 1 = FreelancerWins, 2 = ClientWins
    /// @param freelancerShareBps BPS (0-10000) of distributable going to freelancer
    /// @param depositSlashBps BPS of freelancer deposit to slash (ClientWins only)
    /// @return result The computed fund distribution
    function computeRulingDistribution(
        RulingContext memory ctx,
        uint8 ruling,
        uint256 freelancerShareBps,
        uint256 depositSlashBps
    ) public pure returns (RulingResult memory result) {
        uint256 fee = (ctx.msValue * PROTOCOL_FEE_BPS) / 10_000;
        uint256 distributable = ctx.msValue - fee;

        result.treasuryCredit = fee;
        result.newDeposit = ctx.freelancerDeposit;
        result.newBond = ctx.behaviorBond;

        uint256 freelancerAmount = (distributable * freelancerShareBps) / 10_000;
        uint256 clientAmount = distributable - freelancerAmount;

        if (ruling == 1) {
            // FreelancerWins
            result.freelancerCredit = freelancerAmount;
            result.clientCredit = clientAmount;

            // Bond slash: up to 3% of milestone value from behavior bond to treasury
            if (ctx.behaviorBond > 0 && !ctx.bondRefunded) {
                uint256 bondSlash = (ctx.msValue * BOND_SLASH_MAX_BPS) / 10_000;
                if (bondSlash > ctx.behaviorBond) {
                    bondSlash = ctx.behaviorBond;
                }
                result.newBond = ctx.behaviorBond - bondSlash;
                result.treasuryCredit += bondSlash;
            }

            // Dispute fee
            if (ctx.disputeFee > 0) {
                if (ctx.disputeInitiator == ctx.freelancer) {
                    result.feeRecipient = ctx.freelancer;
                    result.feeAmount = ctx.disputeFee;
                    result.freelancerCredit += ctx.disputeFee;
                } else {
                    result.feeRecipient = ctx.treasury;
                    result.feeAmount = ctx.disputeFee;
                    result.treasuryCredit += ctx.disputeFee;
                }
            }
        } else if (ruling == 2) {
            // ClientWins
            result.freelancerCredit = freelancerAmount;
            result.clientCredit = clientAmount;

            // Deposit slash — proportional to this milestone's share of total job value
            if (depositSlashBps > 0 && ctx.freelancerDeposit > 0 && ctx.totalValue > 0) {
                uint256 proportionalDeposit = (ctx.freelancerDeposit * ctx.msValue) / ctx.totalValue;
                uint256 depositSlash = (proportionalDeposit * depositSlashBps) / 10_000;
                if (depositSlash > ctx.freelancerDeposit) {
                    depositSlash = ctx.freelancerDeposit;
                }
                result.newDeposit = ctx.freelancerDeposit - depositSlash;
                result.treasuryCredit += depositSlash;
            }

            // Dispute fee
            if (ctx.disputeFee > 0) {
                if (ctx.disputeInitiator == ctx.client) {
                    result.feeRecipient = ctx.client;
                    result.feeAmount = ctx.disputeFee;
                    result.clientCredit += ctx.disputeFee;
                } else {
                    result.feeRecipient = ctx.treasury;
                    result.feeAmount = ctx.disputeFee;
                    result.treasuryCredit += ctx.disputeFee;
                }
            }
        } else {
            // Inconclusive (ruling == 0)
            result.freelancerCredit = freelancerAmount;
            result.clientCredit = clientAmount;

            // Dispute fee goes to treasury (not refunded to either party)
            if (ctx.disputeFee > 0) {
                result.feeRecipient = ctx.treasury;
                result.feeAmount = ctx.disputeFee;
                result.treasuryCredit += ctx.disputeFee;
            }
        }
    }

    /// @notice Returns behavior bond rate in BPS based on client tier
    function getBehaviorBondBps(IReputation.Tier tier) public pure returns (uint256) {
        if (tier == IReputation.Tier.Gold) return BEHAVIOR_BOND_GOLD_BPS;
        if (tier == IReputation.Tier.Silver) return BEHAVIOR_BOND_SILVER_BPS;
        if (tier == IReputation.Tier.Bronze) return BEHAVIOR_BOND_BRONZE_BPS;
        return BEHAVIOR_BOND_NEW_BPS;
    }

    /// @notice Returns freelancer deposit rate in BPS based on freelancer tier
    function getFreelancerDepositBps(IReputation.Tier tier) public pure returns (uint256) {
        if (tier == IReputation.Tier.Gold) return FREELANCER_DEPOSIT_GOLD_BPS;
        if (tier == IReputation.Tier.Silver) return FREELANCER_DEPOSIT_SILVER_BPS;
        if (tier == IReputation.Tier.Bronze) return FREELANCER_DEPOSIT_BRONZE_BPS;
        return FREELANCER_DEPOSIT_NEW_BPS;
    }
}
