// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "../interfaces/IReputation.sol";
import "../access/PlatformRoles.sol";
import "../libraries/ReputationLib.sol";

/// @title Reputation
/// @notice Soulbound (non-transferable) on-chain reputation scores for clients and freelancers.
///         State can only be mutated by authorized callers (JobEscrow via ESCROW_ROLE).
contract Reputation is IReputation, AccessControl {
    using ReputationLib for *;

    // ── Structs ──
    struct FreelancerProfile {
        uint256 totalValueCompleted;     // Sum of V_i * m_i
        uint256 jobsCompleted;
        uint256 disputesLost;
        uint256 reputationScore;         // Cached, recalculated on update
    }

    struct ClientProfile {
        uint256 totalValueCompleted;
        uint256 jobsPosted;
        uint256 jobsCompleted;
        uint256 jobsCancelledAfterSelection;  // C in the formula
        uint256 autoApproveCount;             // A in the formula
        uint256 disputesLost;                 // L in the formula
        uint256 reputationScore;              // Cached
    }

    // ── State ──
    mapping(address => FreelancerProfile) public freelancerProfiles;
    mapping(address => ClientProfile) public clientProfiles;

    // ── Events ──
    event FreelancerScoreUpdated(address indexed user, uint256 newScore, uint256 totalValueCompleted);
    event ClientScoreUpdated(address indexed user, uint256 newScore, uint256 totalValueCompleted);
    event TierChanged(address indexed user, Tier oldTier, Tier newTier);

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

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

    /// @inheritdoc IReputation
    function recordDisputeLoss(address user) external override onlyRole(PlatformRoles.ESCROW_ROLE) {
        // Could be either client or freelancer
        FreelancerProfile storage fp = freelancerProfiles[user];
        ClientProfile storage cp = clientProfiles[user];

        // Increment disputes lost for whichever profile has activity
        // In practice, the caller knows which role the user played
        if (fp.totalValueCompleted > 0 || fp.jobsCompleted > 0) {
            fp.disputesLost += 1;
            _recalculateFreelancerScore(user);
        }
        if (cp.jobsPosted > 0) {
            cp.disputesLost += 1;
            _recalculateClientScore(user);
        }
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
    function recordJobCompleted(address client, uint256 totalValue) external override onlyRole(PlatformRoles.ESCROW_ROLE) {
        ClientProfile storage cp = clientProfiles[client];
        cp.jobsCompleted += 1;
        cp.totalValueCompleted += totalValue;
        _recalculateClientScore(client);
    }

    /// @inheritdoc IReputation
    function recordFreelancerJobCompleted(address freelancer) external override onlyRole(PlatformRoles.ESCROW_ROLE) {
        freelancerProfiles[freelancer].jobsCompleted += 1;
    }

    // ═══════════════════════════════════════════════════════════════
    //                      VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════

    /// @inheritdoc IReputation
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
    function getClientScore(address user) external view override returns (uint256) {
        return clientProfiles[user].reputationScore;
    }

    /// @notice Get the full freelancer profile
    function getFreelancerProfile(address user) external view returns (
        uint256 totalValueCompleted,
        uint256 jobsCompleted,
        uint256 disputesLost,
        uint256 reputationScore
    ) {
        FreelancerProfile storage p = freelancerProfiles[user];
        return (p.totalValueCompleted, p.jobsCompleted, p.disputesLost, p.reputationScore);
    }

    /// @notice Get the full client profile
    function getClientProfile(address user) external view returns (
        uint256 totalValueCompleted,
        uint256 jobsPosted,
        uint256 jobsCompleted,
        uint256 jobsCancelledAfterSelection,
        uint256 autoApproveCount,
        uint256 disputesLost,
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
            p.disputesLost
        );
        p.reputationScore = newScore;
        emit FreelancerScoreUpdated(user, newScore, p.totalValueCompleted);
    }

    function _recalculateClientScore(address user) internal {
        ClientProfile storage p = clientProfiles[user];

        // Capture old tier before recalculation
        Tier oldTier = this.getClientTier(user);

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
        Tier newTier = this.getClientTier(user);
        if (newTier != oldTier) {
            emit TierChanged(user, oldTier, newTier);
        }
    }

    /// @dev Calculate auto-approve rate as a percentage (0-100)
    function _autoApproveRate(ClientProfile storage p) internal view returns (uint256) {
        uint256 totalMilestones = p.jobsCompleted * 3; // Approximate: assume avg 3 milestones per job
        if (totalMilestones == 0) return 0;
        return (p.autoApproveCount * 100) / totalMilestones;
    }
}
