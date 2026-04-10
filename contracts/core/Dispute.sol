// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/access/extensions/AccessControlDefaultAdminRulesUpgradeable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import "../interfaces/IDispute.sol";
import "../interfaces/IJobEscrow.sol";
import "../interfaces/IDataAvailability.sol";
import "../access/PlatformRoles.sol";

/// @title Dispute
/// @notice Handles dispute lifecycle: creation, evidence submission, judge assignment,
///         key distribution, ruling, and execution. Never holds or transfers USDC directly —
///         all fund redistribution is delegated to JobEscrow via executeDisputeRuling().
contract Dispute is IDispute, AccessControlDefaultAdminRulesUpgradeable, ReentrancyGuard, UUPSUpgradeable {
    // ── Constants ──
    uint256 public constant T_EVIDENCE = 5 days;
    uint256 public constant T_KEY_DISTRIBUTION = 2 days;
    uint256 public constant T_RULING = 14 days;
    uint256 public constant T_JUDGE_ASSIGNMENT = 3 days;
    uint256 public constant KEY_DEFAULT_SLASH_BPS = 5000;
    uint256 public constant MAX_EVIDENCE_PER_PARTY = 20;

    // ── State ──
    IJobEscrow public jobEscrow;
    IDataAvailability public dataAvailability;

    uint256 public nextDisputeId;

    struct DisputeData {
        uint256 jobId;
        uint256 milestoneIdx;
        address initiator;
        address client;
        address freelancer;
        uint256 milestoneValue;
        address judge;
        bytes ephemeralPubKey;
        uint256 evidenceDeadline;
        uint256 keyDistributionDeadline;
        uint256 rulingDeadline;
        bool clientKeySubmitted;
        bool freelancerKeySubmitted;
        Ruling ruling;
        bytes32 reasoningHash;
        uint256 freelancerShareBps;
        uint256 depositSlashBps;
        DisputePhase phase;
        // ── Added after initial deployment (must stay at end for UUPS compatibility) ──
        uint256 judgeAssignmentDeadline;
    }

    struct Evidence {
        address submitter;
        bytes32 evidenceHash;
        string evidenceCID;
        uint256 submittedAt;
    }

    mapping(uint256 => DisputeData) public disputes;
    mapping(uint256 => Evidence[]) public evidenceSubmissions;
    mapping(uint256 => mapping(address => uint256)) public evidenceCount; // L-7: per-party evidence count
    mapping(uint256 => mapping(address => bytes)) public encryptedKeys;

    // ── Events ──
    event DisputeCreated(uint256 indexed disputeId, uint256 indexed jobId, uint256 milestoneIdx, address initiator, uint256 fee);
    event EvidenceSubmitted(uint256 indexed disputeId, address indexed submitter, bytes32 evidenceHash, string evidenceCID);
    event JudgeAssigned(uint256 indexed disputeId, address indexed judge, bytes ephemeralPubKey);
    event KeyDistributed(uint256 indexed disputeId, address indexed party, bytes encryptedJobKey);
    event KeyDefaultTriggered(uint256 indexed disputeId, address nonCooperatingParty, Ruling defaultRuling);
    event RulingSubmitted(uint256 indexed disputeId, Ruling ruling, bytes32 reasoningHash);
    event RulingExecuted(uint256 indexed disputeId, Ruling ruling);
    event EvidencePhaseClosed(uint256 indexed disputeId);
    event RulingDefaultTriggered(uint256 indexed disputeId, address indexed judge);
    event JudgeAssignmentDefaultTriggered(uint256 indexed disputeId, Ruling defaultRuling);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initializer replaces constructor for proxy pattern
    /// @param _dataAvailability The DataAvailability contract address
    /// @param initialAdmin The initial admin address
    /// @param adminTransferDelay Delay (seconds) for admin transfer via AccessControlDefaultAdminRules
    function initialize(
        address _dataAvailability,
        address initialAdmin,
        uint48 adminTransferDelay
    ) external initializer {
        __AccessControlDefaultAdminRules_init(adminTransferDelay, initialAdmin);
        dataAvailability = IDataAvailability(_dataAvailability);
    }

    /// @notice Authorize contract upgrades — restricted to DEFAULT_ADMIN_ROLE
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    /// @notice Set or update the JobEscrow address (post-deploy wiring)
    /// @dev M-2: Removed one-time lock to allow re-wiring if JobEscrow is redeployed.
    ///      Security is maintained via onlyRole(DEFAULT_ADMIN_ROLE) with time-delayed transfer.
    function setJobEscrow(address _jobEscrow) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_jobEscrow != address(0), "Invalid address");
        jobEscrow = IJobEscrow(_jobEscrow);
    }

    // ═══════════════════════════════════════════════════════════════
    //                    DISPUTE LIFECYCLE
    // ═══════════════════════════════════════════════════════════════

    /// @inheritdoc IDispute
    function createDispute(
        uint256 jobId,
        uint256 milestoneIdx,
        address initiator,
        address client,
        address freelancer,
        uint256 milestoneValue
    ) external override onlyRole(PlatformRoles.ESCROW_ROLE) returns (uint256 disputeId) {
        disputeId = nextDisputeId++;

        disputes[disputeId] = DisputeData({
            jobId: jobId,
            milestoneIdx: milestoneIdx,
            initiator: initiator,
            client: client,
            freelancer: freelancer,
            milestoneValue: milestoneValue,
            judge: address(0),
            ephemeralPubKey: "",
            evidenceDeadline: block.timestamp + T_EVIDENCE,
            judgeAssignmentDeadline: 0,
            keyDistributionDeadline: 0,
            rulingDeadline: 0,
            clientKeySubmitted: false,
            freelancerKeySubmitted: false,
            ruling: Ruling.Inconclusive,
            reasoningHash: bytes32(0),
            freelancerShareBps: 0,
            depositSlashBps: 0,
            phase: DisputePhase.Evidence
        });

        emit DisputeCreated(disputeId, jobId, milestoneIdx, initiator, 0);
    }

    /// @notice Submit evidence during the evidence window
    /// @param disputeId The dispute ID
    /// @param evidenceHash keccak256 of the encrypted evidence
    /// @param evidenceCID IPFS CID of the encrypted evidence
    function submitEvidence(
        uint256 disputeId,
        bytes32 evidenceHash,
        string calldata evidenceCID
    ) external {
        DisputeData storage d = disputes[disputeId];
        require(d.phase == DisputePhase.Evidence, "Not in evidence phase");
        require(block.timestamp <= d.evidenceDeadline, "Evidence window closed");
        require(
            msg.sender == d.client || msg.sender == d.freelancer,
            "Not a party to this dispute"
        );
        // L-7: Cap evidence submissions per party
        require(evidenceCount[disputeId][msg.sender] < MAX_EVIDENCE_PER_PARTY, "Max evidence reached");
        evidenceCount[disputeId][msg.sender] += 1;

        evidenceSubmissions[disputeId].push(Evidence({
            submitter: msg.sender,
            evidenceHash: evidenceHash,
            evidenceCID: evidenceCID,
            submittedAt: block.timestamp
        }));

        // Register CID for data availability
        dataAvailability.registerCID(
            evidenceCID,
            IDataAvailability.ContentType.Evidence,
            d.jobId
        );

        emit EvidenceSubmitted(disputeId, msg.sender, evidenceHash, evidenceCID);
    }

    /// @notice Close the evidence phase after deadline. Transitions to AwaitingJudge.
    /// @param disputeId The dispute ID
    function closeEvidencePhase(uint256 disputeId) external {
        DisputeData storage d = disputes[disputeId];
        require(d.phase == DisputePhase.Evidence, "Not in evidence phase");
        require(block.timestamp > d.evidenceDeadline, "Evidence window not closed");
        require(
            msg.sender == d.client ||
            msg.sender == d.freelancer ||
            hasRole(PlatformRoles.PLATFORM_ADMIN, msg.sender),
            "Not authorized"
        );

        d.phase = DisputePhase.AwaitingJudge;
        d.judgeAssignmentDeadline = block.timestamp + T_JUDGE_ASSIGNMENT;

        emit EvidencePhaseClosed(disputeId);
    }

    /// @notice Platform admin assigns a judge with an ephemeral public key
    /// @param disputeId The dispute ID
    /// @param judge The judge's address
    /// @param ephemeralPubKey The judge's ephemeral public key for this dispute
    function assignJudge(
        uint256 disputeId,
        address judge,
        bytes calldata ephemeralPubKey
    ) external onlyRole(PlatformRoles.PLATFORM_ADMIN) {
        DisputeData storage d = disputes[disputeId];
        require(d.phase == DisputePhase.AwaitingJudge, "Wrong phase");
        require(judge != address(0), "Invalid judge");
        require(judge != d.client && judge != d.freelancer, "Judge conflict of interest");
        require(ephemeralPubKey.length == 33, "Invalid ephemeral key length");

        d.judge = judge;
        d.ephemeralPubKey = ephemeralPubKey;
        d.keyDistributionDeadline = block.timestamp + T_KEY_DISTRIBUTION;
        d.phase = DisputePhase.KeyDistribution;

        // Grant judge role for ruling submission
        _grantRole(PlatformRoles.PLATFORM_JUDGE, judge);

        emit JudgeAssigned(disputeId, judge, ephemeralPubKey);
    }

    /// @notice Client or freelancer distributes their encrypted K_job to the judge
    /// @param disputeId The dispute ID
    /// @param encryptedJobKey Enc(pk_judge_eph, K_job)
    function distributeKeyToJudge(
        uint256 disputeId,
        bytes calldata encryptedJobKey
    ) external {
        DisputeData storage d = disputes[disputeId];
        require(d.phase == DisputePhase.KeyDistribution, "Wrong phase");
        require(block.timestamp <= d.keyDistributionDeadline, "Key distribution deadline passed");
        require(
            msg.sender == d.client || msg.sender == d.freelancer,
            "Not a party to this dispute"
        );

        if (msg.sender == d.client) {
            require(!d.clientKeySubmitted, "Client key already submitted");
            d.clientKeySubmitted = true;
        } else {
            require(!d.freelancerKeySubmitted, "Freelancer key already submitted");
            d.freelancerKeySubmitted = true;
        }

        encryptedKeys[disputeId][msg.sender] = encryptedJobKey;

        emit KeyDistributed(disputeId, msg.sender, encryptedJobKey);

        // If both parties have submitted, transition to UnderReview
        if (d.clientKeySubmitted && d.freelancerKeySubmitted) {
            d.phase = DisputePhase.UnderReview;
            d.rulingDeadline = block.timestamp + T_RULING;
        }
    }

    /// @notice Claim a default ruling due to key distribution non-cooperation
    /// @param disputeId The dispute ID
    function claimKeyDefault(uint256 disputeId) external {
        DisputeData storage d = disputes[disputeId];
        require(d.phase == DisputePhase.KeyDistribution, "Wrong phase");
        require(block.timestamp > d.keyDistributionDeadline, "Deadline not passed");
        require(
            msg.sender == d.client || msg.sender == d.freelancer ||
            msg.sender == d.judge || hasRole(PlatformRoles.PLATFORM_ADMIN, msg.sender),
            "Not authorized"
        );

        Ruling defaultRuling;
        address nonCooperator;
        uint256 fShareBps;
        uint256 dSlashBps;

        if (!d.clientKeySubmitted && !d.freelancerKeySubmitted) {
            // Both failed → Inconclusive
            defaultRuling = Ruling.Inconclusive;
            nonCooperator = address(0);
            fShareBps = 5000; // 50/50 split
            dSlashBps = 0;
        } else if (!d.clientKeySubmitted) {
            // Client failed → Freelancer wins
            defaultRuling = Ruling.FreelancerWins;
            nonCooperator = d.client;
            fShareBps = 10000; // 100% to freelancer
            dSlashBps = 0;
        } else {
            // Freelancer failed → Client wins
            defaultRuling = Ruling.ClientWins;
            nonCooperator = d.freelancer;
            fShareBps = 0; // 100% to client
            dSlashBps = KEY_DEFAULT_SLASH_BPS; // 50% deposit slash
        }

        d.ruling = defaultRuling;
        d.freelancerShareBps = fShareBps;
        d.depositSlashBps = dSlashBps;
        d.phase = DisputePhase.Ruled;

        emit KeyDefaultTriggered(disputeId, nonCooperator, defaultRuling);
    }

    /// @notice Claim a default Inconclusive ruling when admin fails to assign a judge within T_JUDGE_ASSIGNMENT.
    ///         Anyone (client, freelancer, or admin) may call once the deadline has passed.
    /// @param disputeId The dispute ID
    function claimJudgeAssignmentDefault(uint256 disputeId) external {
        DisputeData storage d = disputes[disputeId];
        require(d.phase == DisputePhase.AwaitingJudge, "Wrong phase");
        require(d.judgeAssignmentDeadline > 0, "Deadline not set");
        require(block.timestamp > d.judgeAssignmentDeadline, "Judge assignment deadline not passed");
        require(
            msg.sender == d.client || msg.sender == d.freelancer ||
            hasRole(PlatformRoles.PLATFORM_ADMIN, msg.sender),
            "Not authorized"
        );

        // Default to Inconclusive with 50/50 split, no deposit slash
        d.ruling = Ruling.Inconclusive;
        d.freelancerShareBps = 5000;
        d.depositSlashBps = 0;
        d.phase = DisputePhase.Ruled;

        emit JudgeAssignmentDefaultTriggered(disputeId, Ruling.Inconclusive);
    }

    /// @notice Judge submits their ruling
    /// @param disputeId The dispute ID
    /// @param ruling The ruling (Inconclusive, FreelancerWins, ClientWins)
    /// @param reasoningHash keccak256 of the written reasoning
    /// @param freelancerShareBps BPS of milestone value going to freelancer
    /// @param depositSlashBps BPS of freelancer deposit to slash
    function submitRuling(
        uint256 disputeId,
        Ruling ruling,
        bytes32 reasoningHash,
        uint256 freelancerShareBps,
        uint256 depositSlashBps
    ) external {
        DisputeData storage d = disputes[disputeId];
        require(d.phase == DisputePhase.UnderReview, "Wrong phase");
        require(msg.sender == d.judge, "Not the assigned judge");
        require(block.timestamp <= d.rulingDeadline, "Ruling deadline passed");
        require(freelancerShareBps <= 10000, "Invalid freelancer share");
        require(depositSlashBps <= 5000, "Deposit slash exceeds 50%");

        // Validate ruling consistency
        if (ruling == Ruling.FreelancerWins) {
            require(freelancerShareBps > 5000, "Freelancer wins must get majority");
        } else if (ruling == Ruling.ClientWins) {
            require(freelancerShareBps < 5000, "Client wins must get majority");
        } else {
            // Inconclusive: depositSlashBps must be 0 (no party is at fault)
            require(depositSlashBps == 0, "Inconclusive must not slash deposit");
            // SC-6: Enforce balanced range for Inconclusive ruling
            require(
                freelancerShareBps >= 3000 && freelancerShareBps <= 7000,
                "Inconclusive must be balanced"
            );
        }

        d.ruling = ruling;
        d.reasoningHash = reasoningHash;
        d.freelancerShareBps = freelancerShareBps;
        d.depositSlashBps = depositSlashBps;
        d.phase = DisputePhase.Ruled;

        emit RulingSubmitted(disputeId, ruling, reasoningHash);
    }

    /// @notice Claim a default ruling when the judge misses the T_RULING deadline.
    ///         Anyone may call once the deadline has passed.
    ///         Resets dispute to AwaitingJudge for judge reassignment.
    /// @param disputeId The dispute ID
    function claimRulingDefault(uint256 disputeId) external {
        DisputeData storage d = disputes[disputeId];
        require(d.phase == DisputePhase.UnderReview, "Wrong phase");
        require(block.timestamp > d.rulingDeadline, "Ruling deadline not passed");
        require(
            msg.sender == d.client || msg.sender == d.freelancer ||
            msg.sender == d.judge || hasRole(PlatformRoles.PLATFORM_ADMIN, msg.sender),
            "Not authorized"
        );

        // Save judge address before clearing
        address failedJudge = d.judge;

        // Revoke the judge's role — they failed their duty
        _revokeRole(PlatformRoles.PLATFORM_JUDGE, failedJudge);

        // Reset key submission state
        d.clientKeySubmitted = false;
        d.freelancerKeySubmitted = false;
        d.judge = address(0);
        d.ephemeralPubKey = "";
        d.keyDistributionDeadline = 0;
        d.rulingDeadline = 0;

        // Return to AwaitingJudge for reassignment
        d.phase = DisputePhase.AwaitingJudge;
        d.judgeAssignmentDeadline = block.timestamp + T_JUDGE_ASSIGNMENT;

        emit RulingDefaultTriggered(disputeId, failedJudge);
    }

    /// @notice Execute a ruling — calls JobEscrow.executeDisputeRuling()
    /// @param disputeId The dispute ID
    function executeRuling(uint256 disputeId) external nonReentrant {
        DisputeData storage d = disputes[disputeId];
        require(d.phase == DisputePhase.Ruled, "Not ruled yet");
        require(
            msg.sender == d.client ||
            msg.sender == d.freelancer ||
            msg.sender == d.judge ||
            hasRole(PlatformRoles.PLATFORM_ADMIN, msg.sender),
            "Not authorized"
        );

        d.phase = DisputePhase.Executed;

        // L-2: Revoke judge role after ruling execution (least privilege)
        if (d.judge != address(0)) {
            _revokeRole(PlatformRoles.PLATFORM_JUDGE, d.judge);
        }

        // Call JobEscrow to apply the ruling
        jobEscrow.executeDisputeRuling(
            d.jobId,
            d.milestoneIdx,
            uint8(d.ruling),
            d.freelancerShareBps,
            d.depositSlashBps
        );

        emit RulingExecuted(disputeId, d.ruling);
    }

    // ═══════════════════════════════════════════════════════════════
    //                      VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════

    /// @inheritdoc IDispute
    function getDisputeStatus(uint256 disputeId) external view override returns (DisputePhase phase, uint8 ruling) {
        DisputeData storage d = disputes[disputeId];
        return (d.phase, uint8(d.ruling));
    }

    /// @notice Get full dispute details
    function getDisputeDetails(uint256 disputeId) external view returns (
        uint256 jobId,
        uint256 milestoneIdx,
        address initiator,
        address client,
        address freelancer,
        uint256 milestoneValue,
        address judge,
        DisputePhase phase,
        Ruling ruling
    ) {
        DisputeData storage d = disputes[disputeId];
        return (
            d.jobId, d.milestoneIdx, d.initiator,
            d.client, d.freelancer, d.milestoneValue,
            d.judge, d.phase, d.ruling
        );
    }

    /// @notice Get evidence submissions for a dispute
    function getEvidenceCount(uint256 disputeId) external view returns (uint256) {
        return evidenceSubmissions[disputeId].length;
    }

    /// @notice Get a specific evidence submission
    function getEvidence(uint256 disputeId, uint256 index) external view returns (
        address submitter,
        bytes32 evidenceHash,
        string memory evidenceCID,
        uint256 submittedAt
    ) {
        Evidence storage e = evidenceSubmissions[disputeId][index];
        return (e.submitter, e.evidenceHash, e.evidenceCID, e.submittedAt);
    }

    /// @notice Get the encrypted key submitted by a party
    function getEncryptedKey(uint256 disputeId, address party) external view returns (bytes memory) {
        return encryptedKeys[disputeId][party];
    }

    /// @notice Get dispute deadlines
    function getDisputeDeadlines(uint256 disputeId) external view returns (
        uint256 evidenceDeadline,
        uint256 judgeAssignmentDeadline,
        uint256 keyDistributionDeadline,
        uint256 rulingDeadline
    ) {
        DisputeData storage d = disputes[disputeId];
        return (d.evidenceDeadline, d.judgeAssignmentDeadline, d.keyDistributionDeadline, d.rulingDeadline);
    }
}
