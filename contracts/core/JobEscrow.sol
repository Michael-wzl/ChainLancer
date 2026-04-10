// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/access/extensions/AccessControlDefaultAdminRulesUpgradeable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/IJobEscrow.sol";
import "../interfaces/IDispute.sol";
import "../interfaces/IReputation.sol";
import "../interfaces/IDataAvailability.sol";
import "../access/PlatformRoles.sol";
import "../libraries/DisputeFeeLib.sol";
import "../libraries/TimeoutLib.sol";
import "../libraries/JobEscrowLib.sol";

/// @title JobEscrow
/// @notice Central contract — single authority over fund custody and milestone state.
///         Manages job lifecycle, escrow locking/release, milestones, cancellation.
contract JobEscrow is IJobEscrow, ReentrancyGuard, PausableUpgradeable, AccessControlDefaultAdminRulesUpgradeable, UUPSUpgradeable {
    using SafeERC20 for IERC20;
    using DisputeFeeLib for uint256;
    using TimeoutLib for uint256;
    using JobEscrowLib for JobEscrowLib.RulingContext;

    // ═══════════════════════════════════════════════════════════════
    //                       CUSTOM ERRORS
    // ═══════════════════════════════════════════════════════════════

    error ZeroAddress();
    error InvalidState();
    error OnlyClient();
    error OnlyFreelancer();
    error OnlyCounterparty();
    error NotParty();
    error NotApplicant();
    error AlreadyApplied();
    error MaxAppsReached();
    error AlreadySelected();
    error InvalidPubkeyLen();
    error NotSelected();
    error OfferNotExpired();
    error StakeWindowExpired();
    error InvalidMilestone();
    error MilestoneNotPending();
    error DeadlinePassed();
    error DeadlineNotPassed();
    error NotInReview();
    error TimeoutNotExpired();
    error NotDisputed();
    error AlreadyProcessed();
    error DepositSlashExceedsCap();
    error MsInReviewOrDisputed();
    error CancelAlreadyPending();
    error NoPendingCancel();
    error NotExpiredYet();
    error AlreadyConfirmed();
    error PrevNotExpired();
    error NothingToWithdraw();
    error NoMilestones();
    error ArrayMismatch();
    error TooManyMilestones();
    error InvalidTimeout();
    error EmptyAgreement();
    error ZeroTotalValue();
    error MsBelowMinimum();
    error DeadlineInPast();
    error PendingOffer();
    error CancelWhileOffer();
    error NoOffer();

    // ═══════════════════════════════════════════════════════════════
    //                         CONSTANTS
    // ═══════════════════════════════════════════════════════════════

    uint256 public constant PROTOCOL_FEE_BPS = 200;            // 2%
    uint256 public constant MIN_MILESTONE_BPS = 1000;           // 10% minimum per milestone
    uint256 public constant T_ACCEPTANCE = 14 days;
    uint256 public constant T_STAKE = 3 days;
    uint256 public constant DEPOSIT_SLASH_MAX_BPS = 5000;       // 50% of deposit
    uint256 public constant MAX_APPLICATIONS_PER_JOB = 100;     // M-2: Cap applications to prevent DoS

    // ═══════════════════════════════════════════════════════════════
    //                          STATE
    // ═══════════════════════════════════════════════════════════════

    IERC20 public usdc;
    IDispute public dispute;
    IReputation public reputation;
    IDataAvailability public dataAvailability;
    address public treasury;

    uint256 public nextJobId;

    // ── Data structures ──
    struct Job {
        address client;
        address freelancer;
        uint256 totalValue;
        uint256 freelancerDeposit;
        uint256 behaviorBond;
        bytes32 agreementHash;
        bytes encryptedKeyForFreelancer;
        uint256 reviewTimeout;
        uint256 createdAt;
        uint256 selectedAt;
        uint256 activatedAt;
        uint8 milestoneCount;
        uint8 milestonesCompleted;
        JobState state;
        bool depositRefunded;
        bool bondRefunded;
    }

    struct Application {
        address freelancer;
        bytes32 proposalHash;
        string proposalCID;
        uint256 appliedAt;
    }

    struct Milestone {
        uint256 value;
        uint256 deadline;
        uint256 submittedAt;
        uint256 resolvedAt;
        bytes32 deliverableHash;
        string deliverableCID;
        MilestoneStatus status;
        bool fundsProcessed;
    }

    struct CancellationRequest {
        address requestedBy;
        uint256 requestedAt;
        bool active;
    }

    mapping(uint256 => Job) public jobs;
    mapping(uint256 => Application[]) internal _applications;
    mapping(uint256 => Milestone[]) internal _milestones;
    mapping(uint256 => CancellationRequest) public cancelRequests;
    mapping(address => uint256) public withdrawableBalances;
    mapping(uint256 => mapping(uint256 => uint256)) public disputeIds; // jobId => milestoneIdx => disputeId
    mapping(uint256 => mapping(uint256 => uint256)) public disputeFees; // jobId => milestoneIdx => dispute fee
    mapping(uint256 => mapping(uint256 => address)) public disputeInitiators; // jobId => milestoneIdx => who paid

    // ── G-2: O(1) remaining escrow tracking ──
    mapping(uint256 => uint256) internal _totalFundsProcessed; // jobId => total milestone value processed

    // ── M-2: O(1) duplicate application tracking ──
    mapping(uint256 => mapping(address => bool)) internal _hasApplied;

    // ── Encryption public key registry ──
    mapping(address => bytes) public encryptionPubKeys;

    // ── Events ──
    event JobPosted(uint256 indexed jobId, address indexed client, uint256 totalValue, uint256 reviewTimeout, bytes32 agreementHash);
    event PublicKeyRegistered(address indexed user, bytes pubKey);
    event ApplicationSubmitted(uint256 indexed jobId, address indexed freelancer, bytes32 proposalHash, string proposalCID);
    event FreelancerSelected(uint256 indexed jobId, address indexed freelancer, bytes encryptedKey);
    event JobActivated(uint256 indexed jobId, address indexed freelancer, uint256 depositAmount);
    event MilestoneSubmitted(uint256 indexed jobId, uint256 indexed milestoneIdx, bytes32 deliverableHash, string deliverableCID);
    event MilestoneApproved(uint256 indexed jobId, uint256 indexed milestoneIdx, uint256 timestamp);
    event MilestoneAutoApproved(uint256 indexed jobId, uint256 indexed milestoneIdx, address triggeredBy);
    event DisputeRaised(uint256 indexed jobId, uint256 indexed milestoneIdx, uint256 disputeId, address initiator);
    event DisputeRulingExecuted(uint256 indexed jobId, uint256 indexed milestoneIdx, uint8 ruling);
    event DisputeFeeDistributed(uint256 indexed jobId, uint256 indexed milestoneIdx, address recipient, uint256 amount);
    event JobCompleted(uint256 indexed jobId);
    event JobCancelled(uint256 indexed jobId, address cancelledBy);
    event JobAbandoned(uint256 indexed jobId, uint256 milestoneIdx);
    event CancellationRequested(uint256 indexed jobId, address requestedBy);
    event CancellationAccepted(uint256 indexed jobId, address acceptedBy);
    event OfferRejected(uint256 indexed jobId, address indexed freelancer);
    event OfferExpired(uint256 indexed jobId, address indexed freelancer);
    event FundsWithdrawn(address indexed user, uint256 amount);

    // ═══════════════════════════════════════════════════════════════
    //                       CONSTRUCTOR / INITIALIZER
    // ═══════════════════════════════════════════════════════════════

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initializer replaces constructor for proxy pattern
    /// @param _usdc USDC token address
    /// @param _dispute Dispute contract address
    /// @param _reputation Reputation contract address
    /// @param _dataAvailability DataAvailability contract address
    /// @param _treasury Treasury address for protocol fees
    /// @param initialAdmin The initial admin address
    /// @param adminTransferDelay Delay (seconds) for admin transfer via AccessControlDefaultAdminRules
    function initialize(
        address _usdc,
        address _dispute,
        address _reputation,
        address _dataAvailability,
        address _treasury,
        address initialAdmin,
        uint48 adminTransferDelay
    ) external initializer {
        if (_usdc == address(0)) revert ZeroAddress();
        if (_dispute == address(0)) revert ZeroAddress();
        if (_reputation == address(0)) revert ZeroAddress();
        if (_dataAvailability == address(0)) revert ZeroAddress();
        if (_treasury == address(0)) revert ZeroAddress();

        __AccessControlDefaultAdminRules_init(adminTransferDelay, initialAdmin);
        __Pausable_init();

        usdc = IERC20(_usdc);
        dispute = IDispute(_dispute);
        reputation = IReputation(_reputation);
        dataAvailability = IDataAvailability(_dataAvailability);
        treasury = _treasury;
    }

    /// @notice Authorize contract upgrades — restricted to DEFAULT_ADMIN_ROLE
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    // ═══════════════════════════════════════════════════════════════
    //                     USER-FACING FUNCTIONS
    // ═══════════════════════════════════════════════════════════════

    /// @notice Post a new job with milestone structure
    /// @param agreementHash keccak256(salt || plaintext) of the agreement
    /// @param milestoneValues Array of USDC values for each milestone
    /// @param milestoneDeadlines Array of absolute deadline timestamps per milestone
    /// @param reviewTimeout Review timeout in seconds (must be from allowed set)
    /// @param agreementCID IPFS CID of the encrypted agreement
    function postJob(
        bytes32 agreementHash,
        uint256[] calldata milestoneValues,
        uint256[] calldata milestoneDeadlines,
        uint256 reviewTimeout,
        string calldata agreementCID
    ) external whenNotPaused nonReentrant returns (uint256 jobId) {
        if (milestoneValues.length == 0) revert NoMilestones();
        if (milestoneValues.length != milestoneDeadlines.length) revert ArrayMismatch();
        if (milestoneValues.length > 20) revert TooManyMilestones();
        if (!reviewTimeout.isValidReviewTimeout()) revert InvalidTimeout();
        if (agreementHash == bytes32(0)) revert EmptyAgreement();

        // Calculate total value and validate milestone minimums
        uint256 totalValue = 0;
        for (uint256 i = 0; i < milestoneValues.length; i++) {
            totalValue += milestoneValues[i];
        }
        if (totalValue == 0) revert ZeroTotalValue();

        // Validate each milestone is >= 10% of total
        for (uint256 i = 0; i < milestoneValues.length; i++) {
            if ((milestoneValues[i] * 10_000) / totalValue < MIN_MILESTONE_BPS) revert MsBelowMinimum();
            if (milestoneDeadlines[i] <= block.timestamp) revert DeadlineInPast();
        }

        // Determine behavior bond based on client tier (graduated)
        IReputation.Tier clientTier = reputation.getClientTier(msg.sender);
        uint256 bondBps = JobEscrowLib.getBehaviorBondBps(clientTier);
        uint256 behaviorBond = (totalValue * bondBps) / 10_000;

        // Transfer USDC: totalValue + behaviorBond
        uint256 totalTransfer = totalValue + behaviorBond;
        usdc.safeTransferFrom(msg.sender, address(this), totalTransfer);

        // Create job
        jobId = nextJobId++;
        Job storage job = jobs[jobId];
        job.client = msg.sender;
        job.totalValue = totalValue;
        job.behaviorBond = behaviorBond;
        job.agreementHash = agreementHash;
        job.reviewTimeout = reviewTimeout;
        job.createdAt = block.timestamp;
        job.milestoneCount = uint8(milestoneValues.length);
        job.state = JobState.Open;

        // Create milestones
        for (uint256 i = 0; i < milestoneValues.length; i++) {
            _milestones[jobId].push(Milestone({
                value: milestoneValues[i],
                deadline: milestoneDeadlines[i],
                submittedAt: 0,
                resolvedAt: 0,
                deliverableHash: bytes32(0),
                deliverableCID: "",
                status: MilestoneStatus.Pending,
                fundsProcessed: false
            }));
        }

        // Register agreement CID
        if (bytes(agreementCID).length > 0) {
            dataAvailability.registerCID(
                agreementCID,
                IDataAvailability.ContentType.Agreement,
                jobId
            );
        }

        // Record in reputation
        reputation.recordClientJobPosted(msg.sender);

        emit JobPosted(jobId, msg.sender, totalValue, reviewTimeout, agreementHash);
    }

    /// @notice Apply for an open job
    /// @param jobId The job ID
    /// @param proposalHash Optional hash of the proposal (bytes32(0) if none)
    /// @param proposalCID IPFS CID of the encrypted proposal
    function applyForJob(uint256 jobId, bytes32 proposalHash, string calldata proposalCID) external whenNotPaused {
        Job storage job = jobs[jobId];
        if (job.state != JobState.Open && job.state != JobState.Applications) revert InvalidState();
        if (msg.sender == job.client) revert NotParty();

        // M-2: O(1) duplicate check via mapping (replaces O(n) loop)
        if (_hasApplied[jobId][msg.sender]) revert AlreadyApplied();
        // M-2: Cap applications to prevent DoS from unbounded array growth
        if (_applications[jobId].length >= MAX_APPLICATIONS_PER_JOB) revert MaxAppsReached();

        _hasApplied[jobId][msg.sender] = true;
        Application[] storage apps = _applications[jobId];
        apps.push(Application({
            freelancer: msg.sender,
            proposalHash: proposalHash,
            proposalCID: proposalCID,
            appliedAt: block.timestamp
        }));

        // Register proposal CID in DataAvailability
        if (bytes(proposalCID).length > 0) {
            dataAvailability.registerCID(
                proposalCID,
                IDataAvailability.ContentType.Proposal,
                jobId
            );
        }

        // Transition to Applications if still Open
        if (job.state == JobState.Open) {
            job.state = JobState.Applications;
        }

        emit ApplicationSubmitted(jobId, msg.sender, proposalHash, proposalCID);
    }

    /// @notice Select a freelancer from applicants
    /// @param jobId The job ID
    /// @param freelancerAddr The selected freelancer's address
    /// @param encryptedKey Enc(pk_freelancer, K_job)
    function selectFreelancer(
        uint256 jobId,
        address freelancerAddr,
        bytes calldata encryptedKey
    ) external whenNotPaused {
        Job storage job = jobs[jobId];
        if (msg.sender != job.client) revert OnlyClient();
        if (job.state != JobState.Applications) revert InvalidState();
        if (job.freelancer != address(0)) revert AlreadySelected();
        if (freelancerAddr == address(0)) revert ZeroAddress();

        // M-2: O(1) verification via mapping (replaces O(n) loop)
        if (!_hasApplied[jobId][freelancerAddr]) revert NotApplicant();

        job.freelancer = freelancerAddr;
        job.encryptedKeyForFreelancer = encryptedKey;
        job.selectedAt = block.timestamp;

        emit FreelancerSelected(jobId, freelancerAddr, encryptedKey);
    }

    /// @notice Register or update the caller's secp256k1 encryption public key
    /// @param pubKey Compressed secp256k1 public key (33 bytes)
    function registerEncryptionKey(bytes calldata pubKey) external {
        if (pubKey.length != 33) revert InvalidPubkeyLen();
        encryptionPubKeys[msg.sender] = pubKey;
        emit PublicKeyRegistered(msg.sender, pubKey);
    }

    /// @notice Selected freelancer explicitly rejects the offer
    /// @param jobId The job ID
    function rejectOffer(uint256 jobId) external whenNotPaused {
        Job storage job = jobs[jobId];
        if (msg.sender != job.freelancer) revert NotSelected();
        if (job.state != JobState.Applications) revert InvalidState();

        address rejected = msg.sender;
        _clearSelection(jobId);

        emit OfferRejected(jobId, rejected);
    }

    /// @notice Anyone can clear a stale offer after T_STAKE expires
    /// @param jobId The job ID
    function expireOffer(uint256 jobId) external whenNotPaused {
        Job storage job = jobs[jobId];
        if (job.state != JobState.Applications) revert InvalidState();
        if (job.freelancer == address(0)) revert NoOffer();
        if (block.timestamp <= job.selectedAt + T_STAKE) revert OfferNotExpired();

        address expired = job.freelancer;
        _clearSelection(jobId);

        emit OfferExpired(jobId, expired);
    }

    /// @notice Freelancer confirms selection and stakes 5% deposit
    /// @param jobId The job ID
    function confirmAndStake(uint256 jobId) external whenNotPaused nonReentrant {
        Job storage job = jobs[jobId];
        if (msg.sender != job.freelancer) revert NotSelected();
        if (job.state != JobState.Applications) revert InvalidState();
        if (block.timestamp > job.selectedAt + T_STAKE) revert StakeWindowExpired();

        IReputation.Tier freelancerTier = reputation.getFreelancerTier(msg.sender);
        uint256 depositBps = JobEscrowLib.getFreelancerDepositBps(freelancerTier);
        uint256 depositAmount = (job.totalValue * depositBps) / 10_000;
        job.freelancerDeposit = depositAmount;

        // Transfer deposit from freelancer
        usdc.safeTransferFrom(msg.sender, address(this), depositAmount);

        job.state = JobState.Active;
        job.activatedAt = block.timestamp;

        emit JobActivated(jobId, msg.sender, depositAmount);
    }

    /// @notice Freelancer submits a milestone deliverable
    /// @param jobId The job ID
    /// @param milestoneIdx The milestone index
    /// @param deliverableHash keccak256 of the encrypted deliverable
    /// @param deliverableCID IPFS CID of the encrypted deliverable
    function submitMilestone(
        uint256 jobId,
        uint256 milestoneIdx,
        bytes32 deliverableHash,
        string calldata deliverableCID
    ) external whenNotPaused {
        Job storage job = jobs[jobId];
        if (msg.sender != job.freelancer) revert OnlyFreelancer();
        if (job.state != JobState.Active) revert InvalidState();
        if (milestoneIdx >= job.milestoneCount) revert InvalidMilestone();

        Milestone storage ms = _milestones[jobId][milestoneIdx];
        if (ms.status != MilestoneStatus.Pending) revert MilestoneNotPending();
        if (block.timestamp > ms.deadline) revert DeadlinePassed();

        ms.deliverableHash = deliverableHash;
        ms.deliverableCID = deliverableCID;
        ms.submittedAt = block.timestamp;
        ms.status = MilestoneStatus.InReview;

        // Register CID
        if (bytes(deliverableCID).length > 0) {
            dataAvailability.registerCID(
                deliverableCID,
                IDataAvailability.ContentType.Deliverable,
                jobId
            );
        }

        emit MilestoneSubmitted(jobId, milestoneIdx, deliverableHash, deliverableCID);
    }

    /// @notice Client approves a milestone, releasing funds
    /// @param jobId The job ID
    /// @param milestoneIdx The milestone index
    function approveMilestone(uint256 jobId, uint256 milestoneIdx) external nonReentrant {
        Job storage job = jobs[jobId];
        Milestone storage ms = _milestones[jobId][milestoneIdx];

        // ── CHECKS ──
        if (msg.sender != job.client) revert OnlyClient();
        if (job.state != JobState.Active) revert InvalidState();
        if (ms.status != MilestoneStatus.InReview) revert NotInReview();

        // ── EFFECTS ──
        ms.status = MilestoneStatus.Approved;
        ms.resolvedAt = block.timestamp;
        _releaseMilestoneFunds(jobId, milestoneIdx);
        job.milestonesCompleted++; // G-1: direct increment

        // ── INTERACTIONS ──
        reputation.recordMilestoneCompletion(job.freelancer, ms.value, false, false);
        reputation.recordMilestoneResolved(job.client); // SC-4: per-milestone client count
        _checkAndFinalizeJob(jobId);

        emit MilestoneApproved(jobId, milestoneIdx, block.timestamp);
    }

    /// @notice Trigger auto-approval after review timeout expires
    /// @param jobId The job ID
    /// @param milestoneIdx The milestone index
    function triggerAutoApprove(uint256 jobId, uint256 milestoneIdx) external nonReentrant {
        Job storage job = jobs[jobId];
        Milestone storage ms = _milestones[jobId][milestoneIdx];

        // ── CHECKS ──
        if (job.state != JobState.Active) revert InvalidState();
        if (ms.status != MilestoneStatus.InReview) revert NotInReview();
        // Strict greater-than: client gets the full duration they chose
        if (block.timestamp <= ms.submittedAt + job.reviewTimeout) revert TimeoutNotExpired();

        // ── EFFECTS ──
        ms.status = MilestoneStatus.AutoApproved;
        ms.resolvedAt = block.timestamp;
        _releaseMilestoneFunds(jobId, milestoneIdx);
        job.milestonesCompleted++; // G-1: direct increment

        // ── INTERACTIONS ──
        reputation.recordMilestoneCompletion(job.freelancer, ms.value, false, false);
        reputation.recordClientAutoApprove(job.client);
        reputation.recordMilestoneResolved(job.client); // SC-4: per-milestone client count
        _checkAndFinalizeJob(jobId);

        emit MilestoneAutoApproved(jobId, milestoneIdx, msg.sender);
    }

    /// @notice Raise a dispute on a milestone under review
    /// @param jobId The job ID
    /// @param milestoneIdx The milestone index
    function raiseDispute(uint256 jobId, uint256 milestoneIdx) external whenNotPaused nonReentrant {
        Job storage job = jobs[jobId];
        Milestone storage ms = _milestones[jobId][milestoneIdx];

        // ── CHECKS ──
        if (msg.sender != job.client && msg.sender != job.freelancer) revert NotParty();
        if (job.state != JobState.Active) revert InvalidState();
        if (ms.status != MilestoneStatus.InReview) revert NotInReview();

        // ── EFFECTS ──
        ms.status = MilestoneStatus.Disputed;

        // Calculate dispute fee
        uint256 disputeFee = ms.value.calculateFee();

        // Transfer dispute fee from initiator
        usdc.safeTransferFrom(msg.sender, address(this), disputeFee);

        // Track dispute fee for refund
        disputeFees[jobId][milestoneIdx] = disputeFee;
        disputeInitiators[jobId][milestoneIdx] = msg.sender;

        // ── INTERACTIONS ──
        uint256 disputeId = dispute.createDispute(
            jobId,
            milestoneIdx,
            msg.sender,
            job.client,
            job.freelancer,
            ms.value
        );

        disputeIds[jobId][milestoneIdx] = disputeId;

        emit DisputeRaised(jobId, milestoneIdx, disputeId, msg.sender);
    }

    /// @notice Client claims abandonment when freelancer misses a deadline
    /// @param jobId The job ID
    /// @param milestoneIdx The milestone index with missed deadline
    function claimAbandonment(uint256 jobId, uint256 milestoneIdx) external nonReentrant {
        Job storage job = jobs[jobId];
        Milestone storage ms = _milestones[jobId][milestoneIdx];

        if (msg.sender != job.client) revert OnlyClient();
        if (job.state != JobState.Active) revert InvalidState();
        if (milestoneIdx >= job.milestoneCount) revert InvalidMilestone();
        if (ms.status != MilestoneStatus.Pending) revert MilestoneNotPending();
        if (block.timestamp <= ms.deadline) revert DeadlineNotPassed();

        // Ensure no milestones are InReview or Disputed
        for (uint256 i = 0; i < job.milestoneCount; i++) {
            MilestoneStatus _status = _milestones[jobId][i].status;
            if (_status == MilestoneStatus.InReview || _status == MilestoneStatus.Disputed) revert MsInReviewOrDisputed();
        }

        // ── EFFECTS ──
        job.state = JobState.Abandoned;

        // Forfeit freelancer deposit to treasury
        if (job.freelancerDeposit > 0 && !job.depositRefunded) {
            job.depositRefunded = true;
            withdrawableBalances[treasury] += job.freelancerDeposit;
        }

        // Return remaining escrow (unprocessed milestones) to client
        uint256 remainingEscrow = _calculateRemainingEscrow(jobId);
        if (remainingEscrow > 0) {
            withdrawableBalances[job.client] += remainingEscrow;
        }

        // Refund behavior bond
        _refundBehaviorBond(jobId);

        // Set retention expiry
        dataAvailability.setRetentionExpiry(jobId, block.timestamp + 21 days);

        emit JobAbandoned(jobId, milestoneIdx);
    }

    /// @notice Cancel a job in Open or Applications state
    /// @param jobId The job ID
    function cancelJob(uint256 jobId) external nonReentrant {
        Job storage job = jobs[jobId];
        if (msg.sender != job.client) revert OnlyClient();
        if (job.state != JobState.Open && job.state != JobState.Applications) revert InvalidState();

        // Prevent cancellation while a freelancer has a pending (non-expired) offer
        if (job.freelancer != address(0) && job.selectedAt > 0) {
            if (block.timestamp <= job.selectedAt + T_STAKE) revert CancelWhileOffer();
        }

        job.state = JobState.Cancelled;

        // Return 100% escrow + bond
        withdrawableBalances[job.client] += job.totalValue;
        _refundBehaviorBond(jobId);

        // SC-7: No reputation penalty when cancelling after offer expired.
        // If we reach this point with freelancer != address(0), the offer has necessarily expired
        // (otherwise CancelWhileOffer would have reverted above). So no penalty applies.

        // Set retention expiry
        dataAvailability.setRetentionExpiry(jobId, block.timestamp + 21 days);

        emit JobCancelled(jobId, msg.sender);
    }

    /// @notice Request mutual cancellation in Active state
    /// @param jobId The job ID
    function requestCancellation(uint256 jobId) external whenNotPaused {
        Job storage job = jobs[jobId];
        if (msg.sender != job.client && msg.sender != job.freelancer) revert NotParty();
        if (job.state != JobState.Active) revert InvalidState();

        // Check no milestones are currently in review or disputed
        for (uint256 i = 0; i < job.milestoneCount; i++) {
            MilestoneStatus status = _milestones[jobId][i].status;
            if (status == MilestoneStatus.InReview || status == MilestoneStatus.Disputed) revert MsInReviewOrDisputed();
        }

        if (cancelRequests[jobId].active) revert CancelAlreadyPending();

        cancelRequests[jobId] = CancellationRequest({
            requestedBy: msg.sender,
            requestedAt: block.timestamp,
            active: true
        });

        emit CancellationRequested(jobId, msg.sender);
    }

    /// @notice Accept a pending mutual cancellation
    /// @param jobId The job ID
    function acceptCancellation(uint256 jobId) external nonReentrant {
        Job storage job = jobs[jobId];
        CancellationRequest storage req = cancelRequests[jobId];

        if (!req.active) revert NoPendingCancel();
        if (job.state != JobState.Active) revert InvalidState();

        // Must be the counterparty
        if (req.requestedBy == job.client) {
            if (msg.sender != job.freelancer) revert OnlyCounterparty();
        } else {
            if (msg.sender != job.client) revert OnlyCounterparty();
        }

        // ── EFFECTS ──
        job.state = JobState.Cancelled;
        req.active = false;

        // Return remaining escrow to client
        uint256 remainingEscrow = _calculateRemainingEscrow(jobId);
        if (remainingEscrow > 0) {
            withdrawableBalances[job.client] += remainingEscrow;
        }

        // Refund freelancer deposit
        if (job.freelancerDeposit > 0 && !job.depositRefunded) {
            job.depositRefunded = true;
            withdrawableBalances[job.freelancer] += job.freelancerDeposit;
        }

        // Refund behavior bond
        _refundBehaviorBond(jobId);

        // Reputation penalties
        if (req.requestedBy == job.client) {
            reputation.recordClientCancellation(job.client);
        } else {
            reputation.recordFreelancerCancellation(job.freelancer);
        }

        // Set retention expiry
        dataAvailability.setRetentionExpiry(jobId, block.timestamp + 21 days);

        emit CancellationAccepted(jobId, msg.sender);
    }

    /// @notice Withdraw expired job (no freelancer confirmed within T_ACCEPTANCE)
    /// @param jobId The job ID
    function withdrawExpiredJob(uint256 jobId) external nonReentrant {
        Job storage job = jobs[jobId];
        if (msg.sender != job.client) revert OnlyClient();
        if (job.state != JobState.Open && job.state != JobState.Applications) revert InvalidState();
        if (block.timestamp <= job.createdAt + T_ACCEPTANCE) revert NotExpiredYet();
        // Must not have a confirmed freelancer (no Active state)
        if (job.activatedAt != 0) revert AlreadyConfirmed();

        job.state = JobState.Cancelled;

        // Return 100% escrow + bond
        withdrawableBalances[job.client] += job.totalValue;
        _refundBehaviorBond(jobId);

        // Set retention expiry
        dataAvailability.setRetentionExpiry(jobId, block.timestamp + 21 days);

        emit JobCancelled(jobId, msg.sender);
    }

    /// @notice Reselect a freelancer if previous selection expired
    /// @param jobId The job ID
    /// @param newFreelancer The new freelancer's address
    /// @param encryptedKey Enc(pk_newFreelancer, K_job)
    function reselectFreelancer(
        uint256 jobId,
        address newFreelancer,
        bytes calldata encryptedKey
    ) external whenNotPaused {
        Job storage job = jobs[jobId];
        if (msg.sender != job.client) revert OnlyClient();
        if (job.state != JobState.Applications) revert InvalidState();

        // If a previous selection still exists, it must be expired
        if (job.freelancer != address(0)) {
            if (block.timestamp <= job.selectedAt + T_STAKE) revert PrevNotExpired();
            _clearSelection(jobId);
        }
        // If job.freelancer == address(0), that's fine — previous was rejected/cleared

        // M-2: O(1) verification via mapping (replaces O(n) loop)
        if (!_hasApplied[jobId][newFreelancer]) revert NotApplicant();

        job.freelancer = newFreelancer;
        job.encryptedKeyForFreelancer = encryptedKey;
        job.selectedAt = block.timestamp;

        emit FreelancerSelected(jobId, newFreelancer, encryptedKey);
    }

    /// @notice Withdraw all available funds (pull-over-push pattern)
    function withdraw() external nonReentrant {
        uint256 amount = withdrawableBalances[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        withdrawableBalances[msg.sender] = 0;
        usdc.safeTransfer(msg.sender, amount);

        emit FundsWithdrawn(msg.sender, amount);
    }

    // ═══════════════════════════════════════════════════════════════
    //                   DISPUTE CALLBACK (RESTRICTED)
    // ═══════════════════════════════════════════════════════════════

    /// @inheritdoc IJobEscrow
    function executeDisputeRuling(
        uint256 jobId,
        uint256 milestoneIdx,
        uint8 ruling,
        uint256 freelancerShareBps,
        uint256 depositSlashBps
    ) external override onlyRole(PlatformRoles.DISPUTE_ROLE) nonReentrant {
        Job storage job = jobs[jobId];
        Milestone storage ms = _milestones[jobId][milestoneIdx];

        if (ms.status != MilestoneStatus.Disputed) revert NotDisputed();
        if (ms.fundsProcessed) revert AlreadyProcessed();
        if (depositSlashBps > DEPOSIT_SLASH_MAX_BPS) revert DepositSlashExceedsCap();

        // ── EFFECTS ──
        ms.status = MilestoneStatus.Resolved;
        ms.resolvedAt = block.timestamp;
        ms.fundsProcessed = true;
        job.milestonesCompleted++;

        // G-2: Track processed funds
        _totalFundsProcessed[jobId] += ms.value;

        // Compute fund distribution via external library (reduces contract size)
        JobEscrowLib.RulingResult memory r = JobEscrowLib.computeRulingDistribution(
            JobEscrowLib.RulingContext({
                freelancer: job.freelancer,
                client: job.client,
                treasury: treasury,
                freelancerDeposit: job.freelancerDeposit,
                behaviorBond: job.behaviorBond,
                totalValue: job.totalValue,
                msValue: ms.value,
                disputeFee: disputeFees[jobId][milestoneIdx],
                disputeInitiator: disputeInitiators[jobId][milestoneIdx],
                bondRefunded: job.bondRefunded
            }),
            ruling,
            freelancerShareBps,
            depositSlashBps
        );

        // Apply results
        if (r.freelancerCredit > 0) withdrawableBalances[job.freelancer] += r.freelancerCredit;
        if (r.clientCredit > 0) withdrawableBalances[job.client] += r.clientCredit;
        if (r.treasuryCredit > 0) withdrawableBalances[treasury] += r.treasuryCredit;
        if (r.newDeposit != job.freelancerDeposit) job.freelancerDeposit = r.newDeposit;
        if (r.newBond != job.behaviorBond) job.behaviorBond = r.newBond;

        // Clear dispute fee tracking
        if (disputeFees[jobId][milestoneIdx] > 0) {
            disputeFees[jobId][milestoneIdx] = 0;
        }

        // Emit dispute fee distribution event
        if (r.feeAmount > 0) {
            emit DisputeFeeDistributed(jobId, milestoneIdx, r.feeRecipient, r.feeAmount);
        }

        // Reputation updates based on ruling
        if (ruling == 1) {
            reputation.recordMilestoneCompletion(job.freelancer, ms.value, true, true);
            reputation.recordClientDisputeLoss(job.client);
        } else if (ruling == 2) {
            reputation.recordMilestoneCompletion(job.freelancer, ms.value, true, false);
            reputation.recordFreelancerDisputeLoss(job.freelancer);
        }
        reputation.recordMilestoneResolved(job.client); // SC-4: per-milestone client count

        _checkAndFinalizeJob(jobId);

        emit DisputeRulingExecuted(jobId, milestoneIdx, ruling);
    }

    // ═══════════════════════════════════════════════════════════════
    //                      VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════

    /// @inheritdoc IJobEscrow
    function getJobInfo(uint256 jobId) external view override returns (
        address client,
        address freelancer,
        JobState state,
        uint256 totalValue,
        uint256 freelancerDeposit,
        uint256 behaviorBond,
        uint256 reviewTimeout
    ) {
        Job storage job = jobs[jobId];
        return (
            job.client,
            job.freelancer,
            job.state,
            job.totalValue,
            job.freelancerDeposit,
            job.behaviorBond,
            job.reviewTimeout
        );
    }

    /// @inheritdoc IJobEscrow
    function getMilestoneInfo(uint256 jobId, uint256 milestoneIdx) external view override returns (
        uint256 value,
        MilestoneStatus status,
        uint256 submittedAt
    ) {
        Milestone storage ms = _milestones[jobId][milestoneIdx];
        return (ms.value, ms.status, ms.submittedAt);
    }

    /// @notice Get all milestones for a job
    function getMilestones(uint256 jobId) external view returns (Milestone[] memory) {
        return _milestones[jobId];
    }

    /// @notice Get all applications for a job
    function getApplications(uint256 jobId) external view returns (Application[] memory) {
        return _applications[jobId];
    }

    /// @notice Get application count for a job
    function getApplicationCount(uint256 jobId) external view returns (uint256) {
        return _applications[jobId].length;
    }

    // ═══════════════════════════════════════════════════════════════
    //                    ADMIN FUNCTIONS
    // ═══════════════════════════════════════════════════════════════

    /// @notice Pause the contract (emergency)
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    /// @notice Unpause the contract
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // ═══════════════════════════════════════════════════════════════
    //                    INTERNAL HELPERS
    // ═══════════════════════════════════════════════════════════════

    /// @dev Release milestone funds to freelancer (minus protocol fee)
    function _releaseMilestoneFunds(uint256 jobId, uint256 milestoneIdx) internal {
        Milestone storage ms = _milestones[jobId][milestoneIdx];
        if (ms.fundsProcessed) revert AlreadyProcessed();
        ms.fundsProcessed = true;

        // G-2: Track processed funds for O(1) remaining calculation
        _totalFundsProcessed[jobId] += ms.value;

        uint256 fee = (ms.value * PROTOCOL_FEE_BPS) / 10_000;
        uint256 payout = ms.value - fee;

        withdrawableBalances[jobs[jobId].freelancer] += payout;
        withdrawableBalances[treasury] += fee;
    }

    /// @dev Check if all milestones are completed and finalize the job
    /// @dev G-1: Callers now increment milestonesCompleted directly, so no loop is needed.
    function _checkAndFinalizeJob(uint256 jobId) internal {
        Job storage job = jobs[jobId];

        if (job.milestonesCompleted == job.milestoneCount) {
            job.state = JobState.Completed;

            // Refund freelancer deposit
            if (job.freelancerDeposit > 0 && !job.depositRefunded) {
                job.depositRefunded = true;
                withdrawableBalances[job.freelancer] += job.freelancerDeposit;
            }

            // Refund behavior bond
            _refundBehaviorBond(jobId);

            // Record job completion in reputation
            reputation.recordJobCompleted(job.client, job.totalValue, job.milestoneCount);

            // Record freelancer job completion
            reputation.recordFreelancerJobCompleted(job.freelancer);

            // Set retention expiry
            dataAvailability.setRetentionExpiry(jobId, block.timestamp + 21 days);

            emit JobCompleted(jobId);
        }
    }

    /// @dev Calculate remaining escrow for unprocessed milestones
    /// @dev G-2: Uses totalFundsProcessed counter instead of looping over milestones.
    function _calculateRemainingEscrow(uint256 jobId) internal view returns (uint256) {
        return jobs[jobId].totalValue - _totalFundsProcessed[jobId];
    }

    /// @dev Refund behavior bond if not already refunded
    function _refundBehaviorBond(uint256 jobId) internal {
        Job storage job = jobs[jobId];
        if (job.behaviorBond > 0 && !job.bondRefunded) {
            job.bondRefunded = true;
            withdrawableBalances[job.client] += job.behaviorBond;
        }
    }

    /// @dev Clear the current freelancer selection (shared by rejectOffer, expireOffer, reselectFreelancer)
    function _clearSelection(uint256 jobId) internal {
        Job storage job = jobs[jobId];
        address previous = job.freelancer;
        job.freelancer = address(0);
        job.encryptedKeyForFreelancer = "";
        job.selectedAt = 0;
        if (previous != address(0)) {
            emit FreelancerDeselected(jobId, previous);
        }
    }


}
