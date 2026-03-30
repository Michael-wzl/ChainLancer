// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "../interfaces/IDispute.sol";
import "../interfaces/IJobEscrow.sol";
import "../interfaces/IDataAvailability.sol";
import "../access/PlatformRoles.sol";

/// @title Dispute
/// @notice Handles dispute lifecycle: creation, evidence submission, judge assignment,
///         key distribution, ruling, and execution. Never holds or transfers USDC directly —
///         all fund redistribution is delegated to JobEscrow via executeDisputeRuling().
contract Dispute is IDispute, AccessControl {
    // ── Constants ──
    uint256 public constant T_EVIDENCE = 5 days;
    uint256 public constant T_KEY_DISTRIBUTION = 2 days;
    uint256 public constant T_RULING = 14 days;

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
        uint256 disputeFee;
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
    }

    struct Evidence {
        address submitter;
        bytes32 evidenceHash;
        string evidenceCID;
        uint256 submittedAt;
    }

    mapping(uint256 => DisputeData) public disputes;
    mapping(uint256 => Evidence[]) public evidenceSubmissions;
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

    constructor(address _dataAvailability) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        dataAvailability = IDataAvailability(_dataAvailability);
    }

    /// @notice Set the JobEscrow address (post-deploy wiring)
    function setJobEscrow(address _jobEscrow) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(address(jobEscrow) == address(0), "Already set");
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
            disputeFee: 0,          // Fee is tracked by JobEscrow
            judge: address(0),
            ephemeralPubKey: "",
            evidenceDeadline: block.timestamp + T_EVIDENCE,
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

        d.phase = DisputePhase.AwaitingJudge;

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
            dSlashBps = 5000; // 50% deposit slash
        }

        d.ruling = defaultRuling;
        d.freelancerShareBps = fShareBps;
        d.depositSlashBps = dSlashBps;
        d.phase = DisputePhase.Ruled;

        emit KeyDefaultTriggered(disputeId, nonCooperator, defaultRuling);
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
        }

        d.ruling = ruling;
        d.reasoningHash = reasoningHash;
        d.freelancerShareBps = freelancerShareBps;
        d.depositSlashBps = depositSlashBps;
        d.phase = DisputePhase.Ruled;

        emit RulingSubmitted(disputeId, ruling, reasoningHash);
    }

    /// @notice Execute a ruling — calls JobEscrow.executeDisputeRuling()
    /// @param disputeId The dispute ID
    function executeRuling(uint256 disputeId) external {
        DisputeData storage d = disputes[disputeId];
        require(d.phase == DisputePhase.Ruled, "Not ruled yet");

        d.phase = DisputePhase.Executed;

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
        uint256 keyDistributionDeadline,
        uint256 rulingDeadline
    ) {
        DisputeData storage d = disputes[disputeId];
        return (d.evidenceDeadline, d.keyDistributionDeadline, d.rulingDeadline);
    }
}
