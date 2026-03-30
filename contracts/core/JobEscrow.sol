// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/IJobEscrow.sol";
import "../interfaces/IDispute.sol";
import "../interfaces/IReputation.sol";
import "../interfaces/IDataAvailability.sol";
import "../access/PlatformRoles.sol";
import "../libraries/DisputeFeeLib.sol";
import "../libraries/TimeoutLib.sol";

/// @title JobEscrow
/// @notice Central contract — single authority over fund custody and milestone state.
///         Manages job lifecycle, escrow locking/release, milestones, cancellation.
contract JobEscrow is IJobEscrow, ReentrancyGuard, Pausable, AccessControl {
    using SafeERC20 for IERC20;
    using DisputeFeeLib for uint256;
    using TimeoutLib for uint256;

    // ═══════════════════════════════════════════════════════════════
    //                         CONSTANTS
    // ═══════════════════════════════════════════════════════════════

    uint256 public constant PROTOCOL_FEE_BPS = 200;            // 2%
    uint256 public constant FREELANCER_DEPOSIT_BPS = 500;       // 5%
    uint256 public constant BEHAVIOR_BOND_NEW_BPS = 750;       // 7.5%
    uint256 public constant BEHAVIOR_BOND_BRONZE_BPS = 500;     // 5%
    uint256 public constant BEHAVIOR_BOND_SILVER_BPS = 250;     // 2.5%
    uint256 public constant BEHAVIOR_BOND_GOLD_BPS = 100;       // 1%
    uint256 public constant MIN_MILESTONE_BPS = 1000;           // 10% minimum per milestone
    uint256 public constant T_ACCEPTANCE = 14 days;
    uint256 public constant T_STAKE = 3 days;
    uint256 public constant BOND_SLASH_MAX_BPS = 300;           // 3% of milestone value
    uint256 public constant DEPOSIT_SLASH_MAX_BPS = 5000;       // 50% of deposit

    // ═══════════════════════════════════════════════════════════════
    //                          STATE
    // ═══════════════════════════════════════════════════════════════

    IERC20 public immutable usdc;
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
        uint256 appliedAt;
    }

    struct Milestone {
        uint256 value;
        uint256 deadline;
        uint256 submittedAt;
        uint256 resolvedAt;
        uint256 remainingReviewTime;  // Stored when dispute pauses the timer
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
    mapping(uint256 => uint256) public disputeIds; // jobId => disputeId (for active disputes)
    mapping(uint256 => uint256) public disputeFees; // jobId => dispute fee paid by initiator
    mapping(uint256 => address) public disputeInitiators; // jobId => who paid the dispute fee

    // ── Events ──
    event JobPosted(uint256 indexed jobId, address indexed client, uint256 totalValue, uint256 reviewTimeout, bytes32 agreementHash);
    event ApplicationSubmitted(uint256 indexed jobId, address indexed freelancer, bytes32 proposalHash);
    event FreelancerSelected(uint256 indexed jobId, address indexed freelancer, bytes encryptedKey);
    event JobActivated(uint256 indexed jobId, address indexed freelancer, uint256 depositAmount);
    event MilestoneSubmitted(uint256 indexed jobId, uint256 indexed milestoneIdx, bytes32 deliverableHash, string deliverableCID);
    event MilestoneApproved(uint256 indexed jobId, uint256 indexed milestoneIdx, uint256 timestamp);
    event MilestoneAutoApproved(uint256 indexed jobId, uint256 indexed milestoneIdx, address triggeredBy);
    event DisputeRaised(uint256 indexed jobId, uint256 indexed milestoneIdx, uint256 disputeId, address initiator);
    event DisputeRulingExecuted(uint256 indexed jobId, uint256 indexed milestoneIdx, uint8 ruling);
    event JobCompleted(uint256 indexed jobId);
    event JobCancelled(uint256 indexed jobId, address cancelledBy);
    event JobAbandoned(uint256 indexed jobId, uint256 milestoneIdx);
    event CancellationRequested(uint256 indexed jobId, address requestedBy);
    event CancellationAccepted(uint256 indexed jobId, address acceptedBy);
    event OfferRejected(uint256 indexed jobId, address indexed freelancer);
    event OfferExpired(uint256 indexed jobId, address indexed freelancer);
    event FundsWithdrawn(address indexed user, uint256 amount);

    // ═══════════════════════════════════════════════════════════════
    //                       CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════

    constructor(
        address _usdc,
        address _dispute,
        address _reputation,
        address _dataAvailability,
        address _treasury
    ) {
        require(_usdc != address(0), "Invalid USDC");
        require(_reputation != address(0), "Invalid Reputation");
        require(_dataAvailability != address(0), "Invalid DataAvailability");
        require(_treasury != address(0), "Invalid Treasury");

        usdc = IERC20(_usdc);
        dispute = IDispute(_dispute);
        reputation = IReputation(_reputation);
        dataAvailability = IDataAvailability(_dataAvailability);
        treasury = _treasury;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

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
        require(milestoneValues.length > 0, "No milestones");
        require(milestoneValues.length == milestoneDeadlines.length, "Array length mismatch");
        require(milestoneValues.length <= 20, "Too many milestones");
        require(reviewTimeout.isValidReviewTimeout(), "Invalid review timeout");
        require(agreementHash != bytes32(0), "Empty agreement hash");

        // Calculate total value and validate milestone minimums
        uint256 totalValue = 0;
        for (uint256 i = 0; i < milestoneValues.length; i++) {
            totalValue += milestoneValues[i];
        }
        require(totalValue > 0, "Zero total value");

        // Validate each milestone is >= 10% of total
        for (uint256 i = 0; i < milestoneValues.length; i++) {
            require(
                (milestoneValues[i] * 10_000) / totalValue >= MIN_MILESTONE_BPS,
                "Milestone below minimum"
            );
            require(milestoneDeadlines[i] > block.timestamp, "Deadline in the past");
        }

        // Determine behavior bond based on client tier (graduated)
        IReputation.Tier clientTier = reputation.getClientTier(msg.sender);
        uint256 bondBps = _getBehaviorBondBps(clientTier);
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
                remainingReviewTime: 0,
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
    function applyForJob(uint256 jobId, bytes32 proposalHash) external whenNotPaused {
        Job storage job = jobs[jobId];
        require(
            job.state == JobState.Open || job.state == JobState.Applications,
            "Job not accepting applications"
        );
        require(msg.sender != job.client, "Client cannot apply");

        // Check for duplicate applications
        Application[] storage apps = _applications[jobId];
        for (uint256 i = 0; i < apps.length; i++) {
            require(apps[i].freelancer != msg.sender, "Already applied");
        }

        apps.push(Application({
            freelancer: msg.sender,
            proposalHash: proposalHash,
            appliedAt: block.timestamp
        }));

        // Transition to Applications if still Open
        if (job.state == JobState.Open) {
            job.state = JobState.Applications;
        }

        emit ApplicationSubmitted(jobId, msg.sender, proposalHash);
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
        require(msg.sender == job.client, "Only client");
        require(job.state == JobState.Applications, "Not in applications");
        require(freelancerAddr != address(0), "Invalid freelancer");

        // Verify freelancer has applied
        bool found = false;
        Application[] storage apps = _applications[jobId];
        for (uint256 i = 0; i < apps.length; i++) {
            if (apps[i].freelancer == freelancerAddr) {
                found = true;
                break;
            }
        }
        require(found, "Freelancer has not applied");

        job.freelancer = freelancerAddr;
        job.encryptedKeyForFreelancer = encryptedKey;
        job.selectedAt = block.timestamp;

        emit FreelancerSelected(jobId, freelancerAddr, encryptedKey);
    }

    /// @notice Selected freelancer explicitly rejects the offer
    /// @param jobId The job ID
    function rejectOffer(uint256 jobId) external whenNotPaused {
        Job storage job = jobs[jobId];
        require(msg.sender == job.freelancer, "Not selected freelancer");
        require(job.state == JobState.Applications, "Not in applications");

        address rejected = msg.sender;
        _clearSelection(jobId);

        emit OfferRejected(jobId, rejected);
    }

    /// @notice Anyone can clear a stale offer after T_STAKE expires
    /// @param jobId The job ID
    function expireOffer(uint256 jobId) external whenNotPaused {
        Job storage job = jobs[jobId];
        require(job.state == JobState.Applications, "Not in applications");
        require(job.freelancer != address(0), "No pending offer");
        require(block.timestamp > job.selectedAt + T_STAKE, "Offer not expired");

        address expired = job.freelancer;
        _clearSelection(jobId);

        emit OfferExpired(jobId, expired);
    }

    /// @notice Freelancer confirms selection and stakes 5% deposit
    /// @param jobId The job ID
    function confirmAndStake(uint256 jobId) external whenNotPaused nonReentrant {
        Job storage job = jobs[jobId];
        require(msg.sender == job.freelancer, "Not selected freelancer");
        require(job.state == JobState.Applications, "Not in applications");
        require(block.timestamp <= job.selectedAt + T_STAKE, "Stake window expired");

        uint256 depositAmount = (job.totalValue * FREELANCER_DEPOSIT_BPS) / 10_000;
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
        require(msg.sender == job.freelancer, "Only freelancer");
        require(job.state == JobState.Active, "Job not active");
        require(milestoneIdx < job.milestoneCount, "Invalid milestone index");

        Milestone storage ms = _milestones[jobId][milestoneIdx];
        require(ms.status == MilestoneStatus.Pending, "Milestone not pending");
        require(block.timestamp <= ms.deadline, "Milestone deadline passed");

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
        require(msg.sender == job.client, "Only client");
        require(job.state == JobState.Active, "Job not active");
        require(ms.status == MilestoneStatus.InReview, "Not in review");

        // ── EFFECTS ──
        ms.status = MilestoneStatus.Approved;
        ms.resolvedAt = block.timestamp;
        _releaseMilestoneFunds(jobId, milestoneIdx);

        // ── INTERACTIONS ──
        reputation.recordMilestoneCompletion(job.freelancer, ms.value, false, false);
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
        require(job.state == JobState.Active, "Job not active");
        require(ms.status == MilestoneStatus.InReview, "Not in review");
        // Strict greater-than: client gets the full duration they chose
        require(
            block.timestamp > ms.submittedAt + job.reviewTimeout,
            "Review timeout not expired"
        );

        // ── EFFECTS ──
        ms.status = MilestoneStatus.AutoApproved;
        ms.resolvedAt = block.timestamp;
        _releaseMilestoneFunds(jobId, milestoneIdx);

        // ── INTERACTIONS ──
        reputation.recordMilestoneCompletion(job.freelancer, ms.value, false, false);
        reputation.recordClientAutoApprove(job.client);
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
        require(
            msg.sender == job.client || msg.sender == job.freelancer,
            "Not a party"
        );
        require(job.state == JobState.Active, "Job not active");
        require(ms.status == MilestoneStatus.InReview, "Not in review");

        // ── EFFECTS ──
        ms.status = MilestoneStatus.Disputed;

        // Pause review timer — record remaining time
        uint256 reviewDeadline = ms.submittedAt + job.reviewTimeout;
        if (block.timestamp < reviewDeadline) {
            ms.remainingReviewTime = reviewDeadline - block.timestamp;
        } else {
            ms.remainingReviewTime = 0;
        }

        // Calculate dispute fee
        uint256 disputeFee = ms.value.calculateFee();

        // Transfer dispute fee from initiator
        usdc.safeTransferFrom(msg.sender, address(this), disputeFee);

        // Track dispute fee for refund
        disputeFees[jobId] = disputeFee;
        disputeInitiators[jobId] = msg.sender;

        // ── INTERACTIONS ──
        uint256 disputeId = dispute.createDispute(
            jobId,
            milestoneIdx,
            msg.sender,
            job.client,
            job.freelancer,
            ms.value
        );

        disputeIds[jobId] = disputeId;

        emit DisputeRaised(jobId, milestoneIdx, disputeId, msg.sender);
    }

    /// @notice Client claims abandonment when freelancer misses a deadline
    /// @param jobId The job ID
    /// @param milestoneIdx The milestone index with missed deadline
    function claimAbandonment(uint256 jobId, uint256 milestoneIdx) external nonReentrant {
        Job storage job = jobs[jobId];
        Milestone storage ms = _milestones[jobId][milestoneIdx];

        require(msg.sender == job.client, "Only client");
        require(job.state == JobState.Active, "Job not active");
        require(ms.status == MilestoneStatus.Pending, "Not pending");
        require(block.timestamp > ms.deadline, "Deadline not passed");

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
        require(msg.sender == job.client, "Only client");
        require(
            job.state == JobState.Open || job.state == JobState.Applications,
            "Cannot cancel in current state"
        );

        job.state = JobState.Cancelled;

        // Return 100% escrow + bond
        withdrawableBalances[job.client] += job.totalValue;
        _refundBehaviorBond(jobId);

        // Reputation penalty if freelancer was selected
        if (job.freelancer != address(0)) {
            reputation.recordClientCancellation(job.client);
        }

        // Set retention expiry
        dataAvailability.setRetentionExpiry(jobId, block.timestamp + 21 days);

        emit JobCancelled(jobId, msg.sender);
    }

    /// @notice Request mutual cancellation in Active state
    /// @param jobId The job ID
    function requestCancellation(uint256 jobId) external whenNotPaused {
        Job storage job = jobs[jobId];
        require(
            msg.sender == job.client || msg.sender == job.freelancer,
            "Not a party"
        );
        require(job.state == JobState.Active, "Job not active");

        // Check no milestones are currently in review or disputed
        for (uint256 i = 0; i < job.milestoneCount; i++) {
            MilestoneStatus status = _milestones[jobId][i].status;
            require(
                status != MilestoneStatus.InReview && status != MilestoneStatus.Disputed,
                "Milestone in review or disputed"
            );
        }

        require(!cancelRequests[jobId].active, "Cancellation already pending");

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

        require(req.active, "No pending cancellation");
        require(job.state == JobState.Active, "Job not active");

        // Must be the counterparty
        if (req.requestedBy == job.client) {
            require(msg.sender == job.freelancer, "Only counterparty");
        } else {
            require(msg.sender == job.client, "Only counterparty");
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
        }

        // Set retention expiry
        dataAvailability.setRetentionExpiry(jobId, block.timestamp + 21 days);

        emit CancellationAccepted(jobId, msg.sender);
    }

    /// @notice Withdraw expired job (no freelancer confirmed within T_ACCEPTANCE)
    /// @param jobId The job ID
    function withdrawExpiredJob(uint256 jobId) external nonReentrant {
        Job storage job = jobs[jobId];
        require(msg.sender == job.client, "Only client");
        require(
            job.state == JobState.Open || job.state == JobState.Applications,
            "Invalid state"
        );
        require(block.timestamp > job.createdAt + T_ACCEPTANCE, "Not expired yet");
        // Must not have a confirmed freelancer (no Active state)
        require(job.activatedAt == 0, "Freelancer already confirmed");

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
        require(msg.sender == job.client, "Only client");
        require(job.state == JobState.Applications, "Not in applications");
        require(job.freelancer != address(0), "No previous selection");
        require(
            block.timestamp > job.selectedAt + T_STAKE,
            "Previous selection not expired"
        );

        // Clear previous selection
        _clearSelection(jobId);

        // Verify new freelancer has applied
        bool found = false;
        Application[] storage apps = _applications[jobId];
        for (uint256 i = 0; i < apps.length; i++) {
            if (apps[i].freelancer == newFreelancer) {
                found = true;
                break;
            }
        }
        require(found, "Freelancer has not applied");

        job.freelancer = newFreelancer;
        job.encryptedKeyForFreelancer = encryptedKey;
        job.selectedAt = block.timestamp;

        emit FreelancerSelected(jobId, newFreelancer, encryptedKey);
    }

    /// @notice Withdraw all available funds (pull-over-push pattern)
    function withdraw() external nonReentrant {
        uint256 amount = withdrawableBalances[msg.sender];
        require(amount > 0, "Nothing to withdraw");

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

        require(ms.status == MilestoneStatus.Disputed, "Not disputed");
        require(!ms.fundsProcessed, "Already processed");

        // ── EFFECTS ──
        ms.status = MilestoneStatus.Resolved;
        ms.resolvedAt = block.timestamp;
        ms.fundsProcessed = true;

        uint256 msValue = ms.value;
        uint256 fee = (msValue * PROTOCOL_FEE_BPS) / 10_000;
        uint256 distributable = msValue - fee;

        // 0 = Inconclusive, 1 = FreelancerWins, 2 = ClientWins
        if (ruling == 1) {
            // FreelancerWins
            uint256 freelancerAmount = (distributable * freelancerShareBps) / 10_000;
            uint256 clientAmount = distributable - freelancerAmount;

            withdrawableBalances[job.freelancer] += freelancerAmount;
            if (clientAmount > 0) {
                withdrawableBalances[job.client] += clientAmount;
            }
            withdrawableBalances[treasury] += fee;

            // Bond slash: up to 3% of milestone value from behavior bond to treasury
            if (job.behaviorBond > 0 && !job.bondRefunded) {
                uint256 bondSlash = (msValue * BOND_SLASH_MAX_BPS) / 10_000;
                if (bondSlash > job.behaviorBond) {
                    bondSlash = job.behaviorBond;
                }
                job.behaviorBond -= bondSlash;
                withdrawableBalances[treasury] += bondSlash;
            }

            // Refund dispute fee to freelancer (winner)
            if (disputeFees[jobId] > 0) {
                withdrawableBalances[job.freelancer] += disputeFees[jobId];
                disputeFees[jobId] = 0;
            }

            // Reputation updates
            reputation.recordMilestoneCompletion(job.freelancer, msValue, true, true);
            reputation.recordDisputeLoss(job.client);

        } else if (ruling == 2) {
            // ClientWins
            uint256 freelancerAmount = (distributable * freelancerShareBps) / 10_000;
            uint256 clientAmount = distributable - freelancerAmount;

            if (freelancerAmount > 0) {
                withdrawableBalances[job.freelancer] += freelancerAmount;
            }
            withdrawableBalances[job.client] += clientAmount;
            withdrawableBalances[treasury] += fee;

            // Deposit slash — goes to treasury
            if (depositSlashBps > 0 && job.freelancerDeposit > 0) {
                uint256 depositSlash = (job.freelancerDeposit * depositSlashBps) / 10_000;
                job.freelancerDeposit -= depositSlash;
                withdrawableBalances[treasury] += depositSlash;
            }

            // Refund dispute fee to client (winner)
            if (disputeFees[jobId] > 0) {
                withdrawableBalances[job.client] += disputeFees[jobId];
                disputeFees[jobId] = 0;
            }

            // Reputation updates
            reputation.recordMilestoneCompletion(job.freelancer, msValue, true, false);
            reputation.recordDisputeLoss(job.freelancer);

        } else {
            // Inconclusive (ruling == 0)
            uint256 freelancerAmount = (distributable * freelancerShareBps) / 10_000;
            uint256 clientAmount = distributable - freelancerAmount;

            withdrawableBalances[job.freelancer] += freelancerAmount;
            withdrawableBalances[job.client] += clientAmount;
            withdrawableBalances[treasury] += fee;

            // Refund dispute fee to initiator on inconclusive
            if (disputeFees[jobId] > 0) {
                address feeRecipient = disputeInitiators[jobId];
                if (feeRecipient != address(0)) {
                    withdrawableBalances[feeRecipient] += disputeFees[jobId];
                }
                disputeFees[jobId] = 0;
            }
        }

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
        require(!ms.fundsProcessed, "Already processed");
        ms.fundsProcessed = true;

        uint256 fee = (ms.value * PROTOCOL_FEE_BPS) / 10_000;
        uint256 payout = ms.value - fee;

        withdrawableBalances[jobs[jobId].freelancer] += payout;
        withdrawableBalances[treasury] += fee;
    }

    /// @dev Check if all milestones are completed and finalize the job
    function _checkAndFinalizeJob(uint256 jobId) internal {
        Job storage job = jobs[jobId];
        uint256 completed = 0;

        for (uint256 i = 0; i < job.milestoneCount; i++) {
            MilestoneStatus status = _milestones[jobId][i].status;
            if (
                status == MilestoneStatus.Approved ||
                status == MilestoneStatus.AutoApproved ||
                status == MilestoneStatus.Resolved
            ) {
                completed++;
            }
        }

        job.milestonesCompleted = uint8(completed);

        if (completed == job.milestoneCount) {
            job.state = JobState.Completed;

            // Refund freelancer deposit
            if (job.freelancerDeposit > 0 && !job.depositRefunded) {
                job.depositRefunded = true;
                withdrawableBalances[job.freelancer] += job.freelancerDeposit;
            }

            // Refund behavior bond
            _refundBehaviorBond(jobId);

            // Record job completion in reputation
            reputation.recordJobCompleted(job.client, job.totalValue);

            // Record freelancer job completion
            reputation.recordFreelancerJobCompleted(job.freelancer);

            // Set retention expiry
            dataAvailability.setRetentionExpiry(jobId, block.timestamp + 21 days);

            emit JobCompleted(jobId);
        }
    }

    /// @dev Calculate remaining escrow for unprocessed milestones
    function _calculateRemainingEscrow(uint256 jobId) internal view returns (uint256) {
        Job storage job = jobs[jobId];
        uint256 remaining = 0;

        for (uint256 i = 0; i < job.milestoneCount; i++) {
            if (!_milestones[jobId][i].fundsProcessed) {
                remaining += _milestones[jobId][i].value;
            }
        }

        return remaining;
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
        job.freelancer = address(0);
        job.encryptedKeyForFreelancer = "";
        job.selectedAt = 0;
    }

    /// @dev Returns behavior bond rate in BPS based on client tier
    function _getBehaviorBondBps(IReputation.Tier tier) internal pure returns (uint256) {
        if (tier == IReputation.Tier.Gold) return BEHAVIOR_BOND_GOLD_BPS;
        if (tier == IReputation.Tier.Silver) return BEHAVIOR_BOND_SILVER_BPS;
        if (tier == IReputation.Tier.Bronze) return BEHAVIOR_BOND_BRONZE_BPS;
        return BEHAVIOR_BOND_NEW_BPS; // Default for New
    }
}
