// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/access/extensions/AccessControlDefaultAdminRulesUpgradeable.sol";
import "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import "../interfaces/IReputation.sol";
import "../access/PlatformRoles.sol";
import "../libraries/ReputationLib.sol";

/// @title Reputation
/// @notice Soulbound (non-transferable) on-chain reputation scores for clients and freelancers.
///         State can only be mutated by authorized callers (JobEscrow via ESCROW_ROLE).
contract Reputation is IReputation, AccessControlDefaultAdminRulesUpgradeable, UUPSUpgradeable {
    using ReputationLib for *;

    // ── Structs ──
    struct FreelancerProfile {
        uint256 totalValueCompleted;     // Sum of V_i * m_i
        uint256 jobsCompleted;
        uint256 disputesLost;
        uint256 cancellations;           // Tracks voluntary cancellation penalties (separate from disputesLost)
        uint256 reputationScore;         // Cached, recalculated on update
    }

    struct ClientProfile {
        uint256 totalValueCompleted;
        uint256 jobsPosted;
        uint256 jobsCompleted;
        uint256 jobsCancelledAfterSelection;  // C in the formula
        uint256 autoApproveCount;             // A in the formula
        uint256 disputesLost;                 // L in the formula
        uint256 totalMilestoneCount;          // Actual milestone count across all completed jobs
        uint256 reputationScore;              // Cached
    }

    // ── State ──
    mapping(address => FreelancerProfile) public freelancerProfiles;
    mapping(address => ClientProfile) public clientProfiles;

    // ── Events ──
    event FreelancerScoreUpdated(address indexed user, uint256 newScore, uint256 totalValueCompleted);
    event ClientScoreUpdated(address indexed user, uint256 newScore, uint256 totalValueCompleted);
    event TierChanged(address indexed user, Tier oldTier, Tier newTier);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initializer replaces constructor for proxy pattern
    /// @param initialAdmin The initial admin address
    /// @param adminTransferDelay Delay (seconds) for admin transfer via AccessControlDefaultAdminRules
    function initialize(address initialAdmin, uint48 adminTransferDelay) external initializer {
        __AccessControlDefaultAdminRules_init(adminTransferDelay, initialAdmin);
    }

    /// @notice Authorize contract upgrades — restricted to DEFAULT_ADMIN_ROLE
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    // ═══════════════════════════════════════════════════════════════
    //                    RESTRICTED FUNCTIONS
    // ═══════════════════════════════════════════════════════════════

    /// @inheritdoc IReputation
    function recordMilestoneCompletion(
        address freelancer,
        uint256 milestoneValue,
        bool wasDisputed,
        bool freelancerWon
    ) external override onlyRole(PlatformRoles.ESCROW_ROLE) {
        FreelancerProfile storage fp = freelancerProfiles[freelancer];

        // Multiplier: 1.0 if clean, 0.5 if disputed+won, 0.0 if disputed+lost
        if (!wasDisputed) {
            fp.totalValueCompleted += milestoneValue;
        } else if (freelancerWon) {
            fp.totalValueCompleted += milestoneValue / 2;
        }
        // If disputed and lost: no value added

        _recalculateFreelancerScore(freelancer);
    }

    /// @notice Increment totalMilestoneCount for a client (called per milestone resolution)
    /// @dev SC-4: Fixes under-counting by incrementing per-milestone instead of bulk on job completion
    function recordMilestoneResolved(address client) external onlyRole(PlatformRoles.ESCROW_ROLE) {
        clientProfiles[client].totalMilestoneCount += 1;
    }

    /// @inheritdoc IReputation
    function recordFreelancerDisputeLoss(address freelancer)
        external override onlyRole(PlatformRoles.ESCROW_ROLE)
    {
        freelancerProfiles[freelancer].disputesLost += 1;
        _recalculateFreelancerScore(freelancer);
    }

    /// @inheritdoc IReputation
    function recordClientDisputeLoss(address client)
        external override onlyRole(PlatformRoles.ESCROW_ROLE)
    {
        clientProfiles[client].disputesLost += 1;
        _recalculateClientScore(client);
    }

    /// @inheritdoc IReputation
    function recordClientJobPosted(address client) external override onlyRole(PlatformRoles.ESCROW_ROLE) {
        clientProfiles[client].jobsPosted += 1;
        _recalculateClientScore(client);
    }

    /// @inheritdoc IReputation
    function recordClientCancellation(address client) external override onlyRole(PlatformRoles.ESCROW_ROLE) {
        clientProfiles[client].jobsCancelledAfterSelection += 1;
        _recalculateClientScore(client);
    }

    /// @inheritdoc IReputation
    function recordClientAutoApprove(address client) external override onlyRole(PlatformRoles.ESCROW_ROLE) {
        clientProfiles[client].autoApproveCount += 1;
        _recalculateClientScore(client);
    }

    /// @inheritdoc IReputation
    /// @dev SC-4: milestoneCount param retained for interface compatibility but no longer used here.
    ///      totalMilestoneCount is now incremented per-milestone via recordMilestoneResolved().
    function recordJobCompleted(address client, uint256 totalValue, uint256 /* milestoneCount */) external override onlyRole(PlatformRoles.ESCROW_ROLE) {
        ClientProfile storage cp = clientProfiles[client];
        cp.jobsCompleted += 1;
        cp.totalValueCompleted += totalValue;
        _recalculateClientScore(client);
    }

    /// @inheritdoc IReputation
    /// @dev L-4: Now recalculates score so the jobsCompleted increment is reflected.
    function recordFreelancerJobCompleted(address freelancer) external override onlyRole(PlatformRoles.ESCROW_ROLE) {
        freelancerProfiles[freelancer].jobsCompleted += 1;
        _recalculateFreelancerScore(freelancer);
    }

    /// @inheritdoc IReputation
    function recordFreelancerCancellation(address freelancer) external override onlyRole(PlatformRoles.ESCROW_ROLE) {
        // Increment dedicated cancellation counter (not disputesLost)
        freelancerProfiles[freelancer].cancellations += 1;
        _recalculateFreelancerScore(freelancer);
    }

    // ═══════════════════════════════════════════════════════════════
    //                      VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════

    /// @inheritdoc IReputation
    /// @dev L-1: Tier thresholds use strict greater-than (> 90, > 75, > 50) intentionally.
    ///      This means exactly 90% completion does NOT qualify for Gold — the client must
    ///      exceed the threshold. Integer division truncation is acceptable here because
    ///      the thresholds are designed as "strictly above" requirements.
    function getClientTier(address user) external view override returns (Tier) {
        ClientProfile storage p = clientProfiles[user];

        if (
            p.totalValueCompleted >= 50_000e6 &&
            p.jobsPosted > 0 &&
            (p.jobsCompleted * 100 / p.jobsPosted) > 90 &&
            _autoApproveRate(p) < 10
        ) {
            return Tier.Gold;
        }
        if (
            p.totalValueCompleted >= 10_000e6 &&
            p.jobsPosted > 0 &&
            (p.jobsCompleted * 100 / p.jobsPosted) > 75 &&
            _autoApproveRate(p) < 20
        ) {
            return Tier.Silver;
        }
        if (
            p.totalValueCompleted >= 1_000e6 &&
            p.jobsPosted > 0 &&
            (p.jobsCompleted * 100 / p.jobsPosted) > 50
        ) {
            return Tier.Bronze;
        }
        return Tier.New;
    }

    /// @inheritdoc IReputation
    function getFreelancerScore(address user) external view override returns (uint256) {
        return freelancerProfiles[user].reputationScore;
    }

    /// @inheritdoc IReputation
    /// @dev DESIGN DEVIATION (G-3): The design spec (§5.5) lists only value
    ///      thresholds for freelancer tiers. This implementation ALSO requires
    ///      a completion ratio (50%/75%/90% for Bronze/Silver/Gold) to prevent
    ///      low-quality freelancers from advancing by volume alone.
    ///      This is an intentional enhancement.
    /// @dev L-1: Tier thresholds use strict greater-than (> 90, > 75, > 50) intentionally.
    ///      Exactly 90% completion does NOT qualify for Gold — the freelancer must exceed it.
    function getFreelancerTier(address user) external view override returns (Tier) {
        FreelancerProfile storage p = freelancerProfiles[user];
        uint256 negativeOutcomes = p.disputesLost + p.cancellations;

        if (
            p.totalValueCompleted >= 50_000e6 &&
            p.jobsCompleted > 0 &&
            (p.jobsCompleted * 100 / (p.jobsCompleted + negativeOutcomes)) > 90
        ) {
            return Tier.Gold;
        }
        if (
            p.totalValueCompleted >= 10_000e6 &&
            p.jobsCompleted > 0 &&
            (p.jobsCompleted * 100 / (p.jobsCompleted + negativeOutcomes)) > 75
        ) {
            return Tier.Silver;
        }
        if (
            p.totalValueCompleted >= 1_000e6 &&
            p.jobsCompleted > 0 &&
            (p.jobsCompleted * 100 / (p.jobsCompleted + negativeOutcomes)) > 50
        ) {
            return Tier.Bronze;
        }
        return Tier.New;
    }

    /// @inheritdoc IReputation
    function getClientScore(address user) external view override returns (uint256) {
        return clientProfiles[user].reputationScore;
    }

    /// @notice Get the full freelancer profile
    function getFreelancerProfile(address user) external view returns (
        uint256 totalValueCompleted,
        uint256 jobsCompleted,
        uint256 disputesLost,
        uint256 cancellations,
        uint256 reputationScore
    ) {
        FreelancerProfile storage p = freelancerProfiles[user];
        return (p.totalValueCompleted, p.jobsCompleted, p.disputesLost, p.cancellations, p.reputationScore);
    }

    /// @notice Get the full client profile
    function getClientProfile(address user) external view returns (
        uint256 totalValueCompleted,
        uint256 jobsPosted,
        uint256 jobsCompleted,
        uint256 jobsCancelledAfterSelection,
        uint256 autoApproveCount,
        uint256 disputesLost,
        uint256 totalMilestoneCount,
        uint256 reputationScore
    ) {
        ClientProfile storage p = clientProfiles[user];
        return (
            p.totalValueCompleted,
            p.jobsPosted,
            p.jobsCompleted,
            p.jobsCancelledAfterSelection,
            p.autoApproveCount,
            p.disputesLost,
            p.totalMilestoneCount,
            p.reputationScore
        );
    }

    // ═══════════════════════════════════════════════════════════════
    //                    INTERNAL HELPERS
    // ═══════════════════════════════════════════════════════════════

    function _recalculateFreelancerScore(address user) internal {
        FreelancerProfile storage p = freelancerProfiles[user];
        uint256 newScore = ReputationLib.calculateFreelancerScore(
            p.totalValueCompleted,
            p.disputesLost,
            p.cancellations
        );
        p.reputationScore = newScore;
        emit FreelancerScoreUpdated(user, newScore, p.totalValueCompleted);
    }

    function _recalculateClientScore(address user) internal {
        ClientProfile storage p = clientProfiles[user];

        // L-5: Use internal tier lookup to avoid external self-call gas overhead
        Tier oldTier = _getClientTierInternal(user);

        uint256 newScore = ReputationLib.calculateClientScore(
            p.totalValueCompleted,
            p.jobsPosted,
            p.jobsCompleted,
            p.disputesLost,
            p.jobsCancelledAfterSelection,
            p.autoApproveCount
        );
        p.reputationScore = newScore;
        emit ClientScoreUpdated(user, newScore, p.totalValueCompleted);

        // Check if tier changed and emit event
        Tier newTier = _getClientTierInternal(user);
        if (newTier != oldTier) {
            emit TierChanged(user, oldTier, newTier);
        }
    }

    /// @dev L-5: Internal version of getClientTier to avoid external self-call gas overhead
    function _getClientTierInternal(address user) internal view returns (Tier) {
        ClientProfile storage p = clientProfiles[user];

        if (
            p.totalValueCompleted >= 50_000e6 &&
            p.jobsPosted > 0 &&
            (p.jobsCompleted * 100 / p.jobsPosted) > 90 &&
            _autoApproveRate(p) < 10
        ) {
            return Tier.Gold;
        }
        if (
            p.totalValueCompleted >= 10_000e6 &&
            p.jobsPosted > 0 &&
            (p.jobsCompleted * 100 / p.jobsPosted) > 75 &&
            _autoApproveRate(p) < 20
        ) {
            return Tier.Silver;
        }
        if (
            p.totalValueCompleted >= 1_000e6 &&
            p.jobsPosted > 0 &&
            (p.jobsCompleted * 100 / p.jobsPosted) > 50
        ) {
            return Tier.Bronze;
        }
        return Tier.New;
    }

    /// @dev Calculate auto-approve rate as a percentage (0-100)
    function _autoApproveRate(ClientProfile storage p) internal view returns (uint256) {
        if (p.totalMilestoneCount == 0) return 0;
        return (p.autoApproveCount * 100) / p.totalMilestoneCount;
    }
}
