# Development Plan — Decentralized Freelance Escrow Platform

> **Role**: Tech Lead — Implementation Specification  
> **Date**: March 2026  
> **Base Document**: `WorkflowDesign.md` (PM Workflow Design, Simplified Architecture)  
> **Scope**: Code structure, contract APIs, data models, inter-contract interfaces, frontend architecture, testing strategy. **Does not include** work division or timeline.

---

## Table of Contents

1. [Technology Stack](#1-technology-stack)
2. [Repository Structure](#2-repository-structure)
3. [Smart Contract Architecture](#3-smart-contract-architecture)
   - 3.1 [JobEscrow.sol](#31-jobescrowsol)
   - 3.2 [Dispute.sol](#32-disputesol)
   - 3.3 [Reputation.sol](#33-reputationsol)
   - 3.4 [DataAvailability.sol](#34-dataavailabilitysol)
4. [Inter-Contract Interfaces & Access Control](#4-inter-contract-interfaces--access-control)
5. [On-Chain Data Models](#5-on-chain-data-models)
6. [Public API Reference](#6-public-api-reference)
7. [Event Specifications](#7-event-specifications)
8. [Frontend Architecture](#8-frontend-architecture)
9. [Cryptographic Module (Off-Chain)](#9-cryptographic-module-off-chain)
10. [IPFS & Data Availability (Off-Chain)](#10-ipfs--data-availability-off-chain)
11. [Deployment & Configuration](#11-deployment--configuration)
12. [Testing Strategy](#12-testing-strategy)
13. [Security Checklist](#13-security-checklist)
14. [Gas Optimization Notes](#14-gas-optimization-notes)

---

## 1. Technology Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **Smart Contracts** | Solidity 0.8.24+, OpenZeppelin Contracts 5.x | Built-in overflow checks, latest stable OZ library |
| **Development Framework** | Hardhat + TypeScript | First-class TS support, mature plugin ecosystem, reliable testing |
| **Testing** | Hardhat Chai Matchers + Hardhat Network Helpers | Time manipulation (`time.increase`), snapshot/revert, event assertions |
| **Local Blockchain** | Hardhat Network (in-process) | Deterministic block times, auto-mine, `console.log` in Solidity |
| **Testnet Deployment** | Hardhat scripts / **Remix IDE** | Hardhat for automated deployments, Remix IDE ("Injected Provider") as GUI fallback |
| **Frontend** | React 18 + TypeScript + Vite | Fast builds, modern DX |
| **Blockchain Interaction** | ethers.js v6 | Wallet connection, contract calls, event listening |
| **Wallet** | MetaMask / any EIP-1193 provider | Standard wallet interface |
| **IPFS** | Pinata SDK (pinning) + IPFS HTTP Gateway (retrieval) | Managed pinning service, no self-hosted IPFS node needed for MVP |
| **Stablecoin** | Mock USDC (ERC-20) for testnet; real USDC on mainnet | `MockUSDC.sol` with `mint()` for testing |
| **Target L2** | Base Sepolia (testnet) → Base Mainnet (production) | Low gas, Coinbase ecosystem, EVM-equivalent |
| **CI** | GitHub Actions | Lint → compile → test → coverage → deploy (testnet) |

---

## 2. Repository Structure

```
contracts/
├── core/
│   ├── JobEscrow.sol            # Job lifecycle, escrow, milestones
│   ├── Dispute.sol              # Dispute creation, evidence, judge ruling
│   ├── Reputation.sol           # Soulbound reputation scores
│   └── DataAvailability.sol     # IPFS CID registry, retention enforcement
├── interfaces/
│   ├── IJobEscrow.sol           # External interface for Dispute → JobEscrow calls
│   ├── IDispute.sol             # External interface for JobEscrow → Dispute calls
│   ├── IReputation.sol          # External interface for JobEscrow → Reputation calls
│   └── IDataAvailability.sol    # External interface for CID registration
├── libraries/
│   ├── DisputeFeeLib.sol        # Dispute fee calculation: max(10, min(1% * V, 1000))
│   ├── ReputationLib.sol        # Scoring formulas (freelancer & client)
│   └── TimeoutLib.sol           # Timeout validation helpers, T_review enum
├── mocks/
│   └── MockUSDC.sol             # Mintable ERC-20 for testing
├── access/
│   └── PlatformRoles.sol        # Role definitions: PLATFORM_JUDGE, PROTOCOL_TREASURY
test/
├── helpers/
│   └── fixtures.ts              # Shared deployment fixture + test helpers
├── unit/
│   ├── JobEscrow.test.ts
│   ├── Dispute.test.ts
│   ├── Reputation.test.ts
│   └── DataAvailability.test.ts
├── integration/
│   └── FullFlow.test.ts         # Combined: Happy Path + Dispute + Cancellation + Timeouts
├── security/
│   ├── Reentrancy.test.ts
│   ├── RaceCondition.test.ts    # Competing txns on same milestone
│   └── AccessControl.test.ts
scripts/
├── deploy.ts                    # Deterministic deploy sequence
├── seed.ts                      # Seed testnet with sample data
└── verify.ts                    # Etherscan verification
frontend/
├── src/
│   ├── contracts/               # ABIs + typed contract bindings (auto-generated)
│   ├── hooks/                   # React hooks for contract interaction
│   ├── contexts/                # WalletContext, JobContext
│   ├── pages/                   # PostJob, BrowseJobs, JobDetail, DisputePanel, Profile
│   ├── components/              # Shared UI components
│   ├── crypto/                  # AES-256 encrypt/decrypt, ECDH key exchange
│   ├── ipfs/                    # Pinata upload, IPFS gateway fetch
│   └── utils/                   # Formatters, constants, type guards
hardhat.config.ts
.env.example
```

---

## 3. Smart Contract Architecture

### 3.1 JobEscrow.sol

**Inherits**: `ReentrancyGuard`, `Pausable`, `AccessControl`

This is the **central contract** — the single authority over fund custody and milestone state. All other contracts interact with it through restricted interfaces.

#### Storage Layout

```solidity
// ── Constants ──
uint256 public constant PROTOCOL_FEE_BPS = 200;            // 2%
uint256 public constant FREELANCER_DEPOSIT_BPS = 500;       // 5%
uint256 public constant BEHAVIOR_BOND_BPS = 500;            // 5%
uint256 public constant MIN_MILESTONE_BPS = 1000;           // 10% minimum per milestone
uint256 public constant T_ACCEPTANCE = 14 days;
uint256 public constant T_STAKE = 3 days;
// NOTE: Review timeout validation is handled by TimeoutLib.isValidReviewTimeout()
// which checks against the set {1d, 3d, 7d, 14d, 21d, 30d} as a pure function.
// This avoids storage costs and is immutable by design.

// ── State ──
IERC20 public immutable usdc;
IDispute public dispute;
IReputation public reputation;
IDataAvailability public dataAvailability;
address public treasury;

uint256 public nextJobId;
mapping(uint256 => Job) public jobs;                          // jobId => Job
mapping(uint256 => Application[]) internal _applications;      // jobId => applications (accessed via getApplications())
mapping(uint256 => Milestone[]) internal _milestones;          // jobId => milestones (accessed via getMilestones())
mapping(uint256 => CancellationRequest) public cancelRequests; // jobId => pending request
mapping(address => uint256) public withdrawableBalances;       // pull-over-push pattern
```

#### Core State Machine Enforcement

Every state-mutating function follows the **checks-effects-interactions** pattern:

```solidity
function approveMilestone(uint256 jobId, uint256 milestoneIdx) external nonReentrant {
    Job storage job = jobs[jobId];
    Milestone storage ms = milestones[jobId][milestoneIdx];

    // ── CHECKS ──
    require(msg.sender == job.client, "Only client");
    require(job.state == JobState.Active, "Job not active");
    require(ms.status == MilestoneStatus.InReview, "Not in review");

    // ── EFFECTS (state updated BEFORE any external call) ──
    ms.status = MilestoneStatus.Approved;
    ms.resolvedAt = block.timestamp;
    _releaseMilestoneFunds(jobId, milestoneIdx);

    // ── INTERACTIONS ──
    reputation.recordMilestoneCompletion(job.freelancer, ms.value, false, false);
    _checkAndFinalizeJob(jobId);

    emit MilestoneApproved(jobId, milestoneIdx, block.timestamp);
}
```

#### Idempotent Terminal Operations

All fund releases and deposit refunds are guarded by a `processed` flag:

```solidity
function _releaseMilestoneFunds(uint256 jobId, uint256 milestoneIdx) internal {
    Milestone storage ms = milestones[jobId][milestoneIdx];
    require(!ms.fundsProcessed, "Already processed");
    ms.fundsProcessed = true;

    uint256 fee = (ms.value * PROTOCOL_FEE_BPS) / 10_000;
    uint256 payout = ms.value - fee;

    withdrawableBalances[jobs[jobId].freelancer] += payout;
    withdrawableBalances[treasury] += fee;
}
```

### 3.2 Dispute.sol

**Inherits**: `AccessControl`

Handles dispute lifecycle. **Never holds or transfers USDC directly** — all fund redistribution is delegated back to `JobEscrow.sol` via the `executeDisputeRuling()` callback.

#### Storage Layout

```solidity
IJobEscrow public jobEscrow;            // Set once via setJobEscrow() to resolve circular dependency
IDataAvailability public dataAvailability;

uint256 public constant T_EVIDENCE = 5 days;
uint256 public constant T_KEY_DISTRIBUTION = 2 days;
uint256 public constant T_RULING = 14 days;

uint256 public nextDisputeId;
mapping(uint256 => DisputeData) public disputes;                // disputeId => DisputeData
mapping(uint256 => Evidence[]) public evidenceSubmissions;       // disputeId => evidence list
mapping(uint256 => mapping(address => bytes)) public encryptedKeys; // disputeId => party => enc(K_job)
```

#### Judge Interaction Model

The judge is a platform-managed role (`PLATFORM_JUDGE` in `AccessControl`). The contract enforces timing constraints; the platform's off-chain system handles judge assignment logistics.

```solidity
function assignJudge(uint256 disputeId, address judge, bytes calldata ephemeralPubKey)
    external onlyRole(PLATFORM_ADMIN)
{
    Dispute storage d = disputes[disputeId];
    require(d.phase == DisputePhase.AwaitingJudge, "Wrong phase");

    d.judge = judge;
    d.ephemeralPubKey = ephemeralPubKey;
    d.keyDistributionDeadline = block.timestamp + T_KEY_DISTRIBUTION;
    d.phase = DisputePhase.KeyDistribution;

    emit JudgeAssigned(disputeId, judge, ephemeralPubKey);
}
```

### 3.3 Reputation.sol

**Inherits**: `AccessControl`

Implements **soulbound** (non-transferable) reputation. Has **no `transfer()` function**. State can only be mutated by authorized callers (JobEscrow and Dispute, via role checks).

#### Storage Layout

```solidity
struct FreelancerProfile {
    uint256 totalValueCompleted;         // Sum of V_i * m_i
    uint256 jobsCompleted;
    uint256 disputesLost;
    uint256 reputationScore;             // Cached, recalculated on update
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

mapping(address => FreelancerProfile) public freelancerProfiles;
mapping(address => ClientProfile) public clientProfiles;
```

#### Scoring Implementation

Solidity has no floating-point. Scores are stored as **fixed-point with 18 decimals** (same precision as ETH):

```solidity
uint256 constant PRECISION = 1e18;

function _calculateFreelancerScore(address user) internal view returns (uint256) {
    FreelancerProfile storage p = freelancerProfiles[user];
    // score = totalValueCompleted / (1 + L * 0.3)
    // In fixed-point: totalValueCompleted * PRECISION / (PRECISION + L * 3 * PRECISION / 10)
    uint256 denominator = PRECISION + (p.disputesLost * 3 * PRECISION / 10);
    return (p.totalValueCompleted * PRECISION) / denominator;
}

function _calculateClientScore(address user) internal view returns (uint256) {
    ClientProfile storage p = clientProfiles[user];
    if (p.jobsPosted == 0) return 0;
    // completionRatio = jobsCompleted / jobsPosted (scaled by PRECISION)
    uint256 completionRatio = (p.jobsCompleted * PRECISION) / p.jobsPosted;
    // penalty = 1 + L*0.3 + C*0.1 + A*0.05
    uint256 penalty = PRECISION
        + (p.disputesLost * 3 * PRECISION / 10)
        + (p.jobsCancelledAfterSelection * PRECISION / 10)
        + (p.autoApproveCount * PRECISION / 20);
    return (p.totalValueCompleted * completionRatio) / penalty;
}
```

#### Tier Determination (View Function)

The contract exposes a view function for tier lookups (used by `JobEscrow` to determine if a behavior bond is required):

```solidity
enum Tier { New, Bronze, Silver, Gold }

function getClientTier(address user) external view returns (Tier) {
    ClientProfile storage p = clientProfiles[user];
    if (p.totalValueCompleted >= 50_000e6 &&                    // $50,000 (USDC has 6 decimals)
        p.jobsPosted > 0 &&
        (p.jobsCompleted * 100 / p.jobsPosted) > 90 &&
        _autoApproveRate(p) < 10)
        return Tier.Gold;
    if (p.totalValueCompleted >= 10_000e6 &&
        p.jobsPosted > 0 &&
        (p.jobsCompleted * 100 / p.jobsPosted) > 75 &&
        _autoApproveRate(p) < 20)
        return Tier.Silver;
    if (p.totalValueCompleted >= 1_000e6 &&
        p.jobsPosted > 0 &&
        (p.jobsCompleted * 100 / p.jobsPosted) > 50)
        return Tier.Bronze;
    return Tier.New;
}
```

### 3.4 DataAvailability.sol

**Inherits**: `AccessControl`

On-chain CID registry. Emits events consumed by the platform's off-chain IPFS pinning service.

```solidity
enum ContentType { Agreement, Deliverable, Evidence, Proposal }

struct CIDRecord {
    string cid;
    ContentType contentType;
    address uploader;
    uint256 jobId;
    uint256 registeredAt;
    uint256 retentionExpiry;     // Computed: job terminal timestamp + 21 days
}

mapping(bytes32 => CIDRecord) public cidRecords;   // keccak256(cid) => CIDRecord
mapping(uint256 => bytes32[]) public jobCIDs;       // jobId => list of CID hashes

function registerCID(
    string calldata cid,
    ContentType contentType,
    uint256 jobId
) external returns (bytes32 cidHash) {
    cidHash = keccak256(bytes(cid));
    require(cidRecords[cidHash].registeredAt == 0, "CID already registered");

    cidRecords[cidHash] = CIDRecord({
        cid: cid,
        contentType: contentType,
        uploader: msg.sender,
        jobId: jobId,
        registeredAt: block.timestamp,
        retentionExpiry: 0                  // Set when job reaches terminal state
    });
    jobCIDs[jobId].push(cidHash);

    emit CIDRegistered(jobId, cid, contentType, msg.sender);
}
```

---

## 4. Inter-Contract Interfaces & Access Control

The contracts form a directed call graph. Access is enforced via OpenZeppelin `AccessControl` roles:

```
┌─────────────────────────────────────────────────────────────────┐
│                       Call Graph                                 │
│                                                                  │
│  JobEscrow ──── calls ────> Dispute.createDispute()              │
│  JobEscrow ──── calls ────> Reputation.recordMilestone*()        │
│  JobEscrow ──── calls ────> Reputation.recordCancellation()      │
│  JobEscrow ──── calls ────> Reputation.getClientTier()  [view]   │
│  JobEscrow ──── calls ────> DataAvailability.registerCID()       │
│                                                                  │
│  Dispute ────── calls ────> JobEscrow.executeDisputeRuling()     │
│  Dispute ────── calls ────> DataAvailability.registerCID()       │
│                                                                  │
│  External ───── calls ────> JobEscrow.withdraw()                 │
└─────────────────────────────────────────────────────────────────┘
```

### Role Definitions

```solidity
// In PlatformRoles.sol
bytes32 constant ESCROW_ROLE = keccak256("ESCROW_ROLE");           // JobEscrow contract address
bytes32 constant DISPUTE_ROLE = keccak256("DISPUTE_ROLE");         // Dispute contract address
bytes32 constant PLATFORM_ADMIN = keccak256("PLATFORM_ADMIN");     // Platform multisig
bytes32 constant PLATFORM_JUDGE = keccak256("PLATFORM_JUDGE");     // Judge address(es)
bytes32 constant PROTOCOL_TREASURY = keccak256("PROTOCOL_TREASURY");
```

### Interface: IJobEscrow.sol

```solidity
interface IJobEscrow {
    /// @notice Called by Dispute.sol to apply a ruling's fund redistribution.
    /// @dev Only callable by the address with DISPUTE_ROLE.
    ///      Atomically: updates milestone status, redistributes funds,
    ///      triggers reputation update.
    function executeDisputeRuling(
        uint256 jobId,
        uint256 milestoneIdx,
        uint8 ruling,               // 0 = Inconclusive, 1 = FreelancerWins, 2 = ClientWins
        uint256 freelancerShare,     // BPS (0-10000) of milestone value to freelancer
        uint256 depositSlashBps      // BPS of freelancer deposit to slash (ClientWins only)
    ) external;

    /// @notice View: get job and milestone state for dispute validation
    function getJobInfo(uint256 jobId) external view returns (
        address client,
        address freelancer,
        JobState state,
        uint256 totalValue,
        uint256 freelancerDeposit,
        uint256 behaviorBond,
        uint256 reviewTimeout
    );

    function getMilestoneInfo(uint256 jobId, uint256 milestoneIdx) external view returns (
        uint256 value,
        MilestoneStatus status,
        uint256 submittedAt
    );
}
```

### Interface: IDispute.sol

```solidity
interface IDispute {
    /// @notice Called by JobEscrow when a party raises a dispute
    function createDispute(
        uint256 jobId,
        uint256 milestoneIdx,
        address initiator,
        address client,
        address freelancer,
        uint256 milestoneValue
    ) external returns (uint256 disputeId);

    function getDisputeStatus(uint256 disputeId) external view returns (DisputePhase phase, uint8 ruling);
}
```

### Interface: IReputation.sol

```solidity
interface IReputation {
    /// @notice Record a milestone completion (clean or via dispute)
    function recordMilestoneCompletion(
        address freelancer,
        uint256 milestoneValue,
        bool wasDisputed,
        bool freelancerWon           // Only relevant if wasDisputed=true
    ) external;

    /// @notice Record a dispute loss for either party
    function recordDisputeLoss(address user) external;

    /// @notice Record client-specific behavioral events
    function recordClientJobPosted(address client) external;
    function recordClientCancellation(address client) external;
    function recordClientAutoApprove(address client) external;

    /// @notice Record a job completion for a freelancer
    function recordFreelancerJobCompleted(address freelancer) external;

    /// @notice Determine if the client needs a behavior bond
    function getClientTier(address client) external view returns (Tier);
}
```

---

## 5. On-Chain Data Models

### 5.1 Enums

```solidity
enum JobState     { Open, Applications, Active, Completed, Cancelled, Abandoned }
enum MilestoneStatus { Pending, InReview, Approved, AutoApproved, Disputed, Resolved }
enum DisputePhase { Evidence, AwaitingJudge, KeyDistribution, UnderReview, Ruled, Executed }
enum Ruling       { Inconclusive, FreelancerWins, ClientWins }
enum ContentType  { Agreement, Deliverable, Evidence, Proposal }
enum Tier         { New, Bronze, Silver, Gold }
```

### 5.2 Structs

```solidity
struct Job {
    address client;
    address freelancer;                    // address(0) until selectFreelancer()
    uint256 totalValue;                    // Total USDC locked at postJob()
    uint256 freelancerDeposit;             // 5% of totalValue, deposited at confirmAndStake()
    uint256 behaviorBond;                  // 5% of totalValue for New/Bronze; 0 otherwise
    bytes32 agreementHash;                 // keccak256(salt || plaintext)
    bytes   encryptedKeyForFreelancer;     // Enc(pk_freelancer, K_job)
    uint256 reviewTimeout;                 // T_review in seconds (from allowed set)
    uint256 createdAt;
    uint256 selectedAt;                    // Timestamp of selectFreelancer()
    uint256 activatedAt;                   // Timestamp of confirmAndStake()
    uint8   milestoneCount;
    uint8   milestonesCompleted;
    JobState state;
    bool    depositRefunded;               // Idempotency guard
    bool    bondRefunded;                  // Idempotency guard
}

struct Application {
    address freelancer;
    bytes32 proposalHash;                  // IPFS CID hash (optional, can be bytes32(0))
    uint256 appliedAt;
}

struct Milestone {
    uint256 value;                         // USDC amount for this milestone
    uint256 deadline;                      // Absolute timestamp
    uint256 submittedAt;                   // 0 if not submitted
    uint256 resolvedAt;                    // Timestamp of approval/ruling
    bytes32 deliverableHash;               // keccak256(encrypted deliverable)
    string  deliverableCID;                // IPFS CID
    MilestoneStatus status;
    bool    fundsProcessed;                // Idempotency guard for fund release
}

struct DisputeData {                        // Named DisputeData to avoid conflict with contract name
    uint256 jobId;
    uint256 milestoneIdx;
    address initiator;                     // Who raised the dispute
    address client;
    address freelancer;
    uint256 milestoneValue;
    uint256 disputeFee;                    // USDC fee paid by initiator (tracked by JobEscrow)
    address judge;                         // Assigned by platform
    bytes   ephemeralPubKey;               // Judge's ephemeral public key
    uint256 evidenceDeadline;              // block.timestamp + T_EVIDENCE
    uint256 keyDistributionDeadline;       // Set after judge assignment
    uint256 rulingDeadline;                // Set after key distribution completes
    bool    clientKeySubmitted;
    bool    freelancerKeySubmitted;
    Ruling  ruling;
    bytes32 reasoningHash;                 // Hash of judge's written reasoning
    uint256 freelancerShareBps;            // BPS of milestone value to freelancer
    uint256 depositSlashBps;               // BPS of freelancer deposit to slash
    DisputePhase phase;
}

struct Evidence {
    address submitter;
    bytes32 evidenceHash;                  // keccak256(encrypted evidence)
    string  evidenceCID;                   // IPFS CID
    uint256 submittedAt;
}

struct CancellationRequest {
    address requestedBy;
    uint256 requestedAt;
    bool    active;
}
```

---

## 6. Public API Reference

### 6.1 JobEscrow.sol — User-Facing Functions

| # | Function Signature | Caller | State Pre | State Post | Key Logic |
|---|-------------------|--------|-----------|------------|-----------|
| 1 | `postJob(bytes32 agreementHash, uint256[] milestoneValues, uint256[] milestoneDeadlines, uint256 reviewTimeout, string agreementCID)` | Client | — | `Open` | Validates milestone values sum, each ≥ 10% of total. Transfers `totalValue + behaviorBond` in USDC. Stores `reviewTimeout` (must be in allowed set). Registers CID via DataAvailability. |
| 2 | `applyForJob(uint256 jobId, bytes32 proposalHash)` | Freelancer | `Open` / `Applications` | `Applications` | Appends to application list. No deposit. |
| 3 | `selectFreelancer(uint256 jobId, address freelancerAddr, bytes calldata encryptedKey)` | Client | `Applications` | `Applications` | Sets `job.freelancer`, stores encrypted key, records `selectedAt`. |
| 4 | `confirmAndStake(uint256 jobId)` | Freelancer | `Applications` | `Active` | Requires `msg.sender == job.freelancer`. Requires `block.timestamp <= selectedAt + T_STAKE`. Transfers 5% deposit in USDC. |
| 5 | `submitMilestone(uint256 jobId, uint256 milestoneIdx, bytes32 deliverableHash, string deliverableCID)` | Freelancer | `Active` | `Active` (milestone → `InReview`) | Validates milestone is `Pending`. Sets `submittedAt = block.timestamp`. Registers CID. |
| 6 | `approveMilestone(uint256 jobId, uint256 milestoneIdx)` | Client | `Active` (milestone `InReview`) | milestone → `Approved` | Releases funds (minus 2% fee) to freelancer withdrawable balance. Checks if all milestones done → `Completed`. |
| 7 | `triggerAutoApprove(uint256 jobId, uint256 milestoneIdx)` | Anyone | `Active` (milestone `InReview`) | milestone → `AutoApproved` | Requires `block.timestamp > submittedAt + reviewTimeout`. Same fund release logic. Records auto-approve in Reputation. |
| 8 | `raiseDispute(uint256 jobId, uint256 milestoneIdx)` | Client / Freelancer | `Active` (milestone `InReview`) | milestone → `Disputed` | Calculates and transfers dispute fee. Calls `Dispute.createDispute()`. |
| 9 | `claimAbandonment(uint256 jobId, uint256 milestoneIdx)` | Client | `Active` (milestone `Pending`) | `Abandoned` | Requires `block.timestamp > milestone.deadline`. Forfeits freelancer deposit to client. Returns remaining escrow. |
| 10 | `cancelJob(uint256 jobId)` | Client | `Open` / `Applications` | `Cancelled` | Returns 100% escrow + bond. Reputation penalty if freelancer was selected. |
| 11 | `requestCancellation(uint256 jobId)` | Client / Freelancer | `Active` | `Active` (pending request) | Creates `CancellationRequest`. Requires counterparty `acceptCancellation()`. |
| 12 | `acceptCancellation(uint256 jobId)` | Counterparty | `Active` (request pending) | `Cancelled` | Returns remaining escrow to client. Refunds freelancer deposit. Reputation penalties per rules. |
| 13 | `withdrawExpiredJob(uint256 jobId)` | Client | `Open` / `Applications` | `Cancelled` | Requires `block.timestamp > createdAt + T_ACCEPTANCE` and no confirmed freelancer. |
| 14 | `reselectFreelancer(uint256 jobId, address newFreelancer, bytes calldata encryptedKey)` | Client | `Applications` | `Applications` | Requires previous selection expired (`block.timestamp > selectedAt + T_STAKE`). |
| 15 | `withdraw()` | Anyone | — | — | Transfers caller's entire `withdrawableBalances[msg.sender]` in USDC. Follows pull-over-push. |
| 16 | `executeDisputeRuling(...)` | Dispute contract only | milestone `Disputed` | milestone → `Resolved` | Restricted to `DISPUTE_ROLE`. See §4 interface. |

### 6.2 Dispute.sol — Functions

| # | Function Signature | Caller | Phase Pre | Phase Post | Key Logic |
|---|-------------------|--------|-----------|------------|-----------|
| 1 | `createDispute(uint256 jobId, uint256 milestoneIdx, address initiator, address client, address freelancer, uint256 milestoneValue)` | JobEscrow | — | `Evidence` | Creates dispute. Sets `evidenceDeadline`. |
| 2 | `submitEvidence(uint256 disputeId, bytes32 evidenceHash, string evidenceCID)` | Client / Freelancer | `Evidence` | `Evidence` | Requires `block.timestamp <= evidenceDeadline`. Registers CID. |
| 3 | `assignJudge(uint256 disputeId, address judge, bytes ephemeralPubKey)` | Platform Admin | `AwaitingJudge` | `KeyDistribution` | Sets judge, ephemeral key, `keyDistributionDeadline`. |
| 4 | `distributeKeyToJudge(uint256 disputeId, bytes encryptedJobKey)` | Client / Freelancer | `KeyDistribution` | `KeyDistribution` / `UnderReview` | Records encrypted key. If both submitted → `UnderReview`, sets `rulingDeadline`. |
| 5 | `claimKeyDefault(uint256 disputeId)` | Either party | `KeyDistribution` | `Ruled` | If `block.timestamp > keyDistributionDeadline` and one/both parties didn't submit. Issues default ruling. Sets phase to `Ruled` (requires separate `executeRuling()` call). |
| 6 | `submitRuling(uint256 disputeId, Ruling ruling, bytes32 reasoningHash, uint256 freelancerShareBps, uint256 depositSlashBps)` | Judge | `UnderReview` | `Ruled` | Requires `block.timestamp <= rulingDeadline`. Validates consistency: `FreelancerWins` requires `freelancerShareBps > 5000`, `ClientWins` requires `freelancerShareBps < 5000`. Records ruling. |
| 7 | `executeRuling(uint256 disputeId)` | Anyone | `Ruled` | `Executed` | Calls `JobEscrow.executeDisputeRuling()` with the stored ruling parameters. Handles dispute fee refund. |
| 8 | `closeEvidencePhase(uint256 disputeId)` | Anyone | `Evidence` | `AwaitingJudge` | Callable after `evidenceDeadline`. Transitions to awaiting judge assignment. |

### 6.3 Reputation.sol — Restricted Functions

All state-mutating functions are restricted to `ESCROW_ROLE` (i.e., only `JobEscrow` can call them):

| Function | Description |
|----------|-------------|
| `recordMilestoneCompletion(address freelancer, uint256 value, bool disputed, bool won)` | Adds `V * multiplier` to freelancer's `totalValueCompleted`. Multiplier: 1.0 if clean, 0.5 if disputed+won. |
| `recordDisputeLoss(address user)` | Increments `disputesLost` for the user. Recalculates score. |
| `recordClientJobPosted(address client)` | Increments `jobsPosted`. |
| `recordClientCancellation(address client)` | Increments `jobsCancelledAfterSelection`. Recalculates score. |
| `recordClientAutoApprove(address client)` | Increments `autoApproveCount`. Recalculates score. |
| `recordJobCompleted(address client, uint256 totalValue)` | Increments `jobsCompleted`, adds value. Recalculates score. |
| `recordFreelancerJobCompleted(address freelancer)` | Increments freelancer `jobsCompleted` when all milestones are done. |

### 6.4 View / Pure Functions (Cross-Contract)

| Contract | Function | Returns | Used By |
|----------|----------|---------|---------|
| `Reputation` | `getClientTier(address)` | `Tier` | `JobEscrow.postJob()` — to determine behavior bond |
| `Reputation` | `getFreelancerScore(address)` | `uint256` | Frontend — display on application list |
| `Reputation` | `getClientScore(address)` | `uint256` | Frontend — display on job listing |
| `Reputation` | `getFreelancerProfile(address)` | `FreelancerProfile` | Frontend — profile page |
| `Reputation` | `getClientProfile(address)` | `ClientProfile` | Frontend — profile page |
| `JobEscrow` | `getJobInfo(uint256)` | `Job` tuple | `Dispute.sol` — validate dispute creation |
| `JobEscrow` | `getMilestoneInfo(uint256, uint256)` | `Milestone` tuple | `Dispute.sol` — validate milestone state |
| `DataAvailability` | `getCIDRecord(bytes32)` | `CIDRecord` | Frontend — fetch IPFS content |
| `DataAvailability` | `getJobCIDs(uint256)` | `bytes32[]` | Frontend — list all CIDs for a job |

---

## 7. Event Specifications

Events are the primary data source for the frontend and off-chain indexing. Each event is designed to carry enough data that the frontend **never needs to call a view function to reconstruct state from events alone** (event-sourcing pattern).

### 7.1 JobEscrow Events

```solidity
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
event FundsWithdrawn(address indexed user, uint256 amount);
```

### 7.2 Dispute Events

```solidity
event DisputeCreated(uint256 indexed disputeId, uint256 indexed jobId, uint256 milestoneIdx, address initiator, uint256 fee);
event EvidenceSubmitted(uint256 indexed disputeId, address indexed submitter, bytes32 evidenceHash, string evidenceCID);
event JudgeAssigned(uint256 indexed disputeId, address indexed judge, bytes ephemeralPubKey);
event KeyDistributed(uint256 indexed disputeId, address indexed party, bytes encryptedJobKey);
event KeyDefaultTriggered(uint256 indexed disputeId, address nonCooperatingParty, Ruling defaultRuling);
event RulingSubmitted(uint256 indexed disputeId, Ruling ruling, bytes32 reasoningHash);
event RulingExecuted(uint256 indexed disputeId, Ruling ruling);
event EvidencePhaseClosed(uint256 indexed disputeId);
```

### 7.3 DataAvailability Events

```solidity
event CIDRegistered(uint256 indexed jobId, string cid, ContentType contentType, address uploader);
event RetentionExpirySet(uint256 indexed jobId, uint256 expiryTimestamp);
```

### 7.4 Reputation Events

```solidity
event FreelancerScoreUpdated(address indexed user, uint256 newScore, uint256 totalValueCompleted);
event ClientScoreUpdated(address indexed user, uint256 newScore, uint256 totalValueCompleted);
event TierChanged(address indexed user, Tier oldTier, Tier newTier);
```

---

## 8. Frontend Architecture

### 8.1 Page Structure

```
/                           → Landing / dashboard
/jobs                       → Browse open jobs (filterable)
/jobs/new                   → PostJob form (client)
/jobs/:jobId                → Job detail (milestones, status, actions)
/jobs/:jobId/apply          → Apply form (freelancer)
/jobs/:jobId/dispute/:id    → Dispute detail (evidence, ruling)
/profile/:address           → User profile (reputation, history)
/wallet                     → Withdrawable balance, transaction history
```

### 8.2 React Hooks (Contract Interaction Layer)

All contract interactions are wrapped in typed hooks that handle transaction lifecycle (submit → pending → confirmed → error):

```typescript
// hooks/useJobEscrow.ts
function usePostJob(): {
  postJob: (params: PostJobParams) => Promise<TransactionReceipt>;
  isPending: boolean;
  error: Error | null;
};

function useApplyForJob(): { ... };
function useSelectFreelancer(): { ... };
function useConfirmAndStake(): { ... };
function useSubmitMilestone(): { ... };
function useApproveMilestone(): { ... };
function useTriggerAutoApprove(): { ... };
function useRaiseDispute(): { ... };
function useWithdraw(): { ... };

// hooks/useReputation.ts
function useFreelancerProfile(address: string): FreelancerProfile | null;
function useClientProfile(address: string): ClientProfile | null;
function useClientTier(address: string): Tier;

// hooks/useJobEvents.ts
function useJobEvents(jobId: number): JobEvent[];      // Real-time via ethers event filters
function useUserJobs(address: string): Job[];           // Jobs where user is client or freelancer
```

### 8.3 State Management

- **On-chain state** is read directly from contracts via `ethers.js` calls (no redundant off-chain DB).
- **Event-driven updates**: the frontend subscribes to contract events and updates the UI in real time.
- **React Context**: `WalletContext` (connection state, signer), `JobContext` (current job detail page state).
- **No backend server required** for MVP. All data comes from the blockchain + IPFS.

### 8.4 Countdown Timers (Frontend UX)

The frontend displays countdown timers for all active timeouts:

| Timer | Source Data | Display |
|-------|------------|---------|
| T_acceptance | `job.createdAt + 14 days` | "Job expires in X days" |
| T_stake | `job.selectedAt + 3 days` | "Freelancer must confirm in X hours" |
| T_deadline | `milestone.deadline` | "Deadline: March 30, 2026 (3 days left)" |
| T_review | `milestone.submittedAt + job.reviewTimeout` | "Auto-approve in X days Y hours" |
| T_evidence | `dispute.evidenceDeadline` | "Evidence window closes in X days" |
| T_keyDistribution | `dispute.keyDistributionDeadline` | "Key submission deadline: X hours" |
| T_ruling | `dispute.rulingDeadline` | "Judge ruling deadline: X days" |

---

## 9. Cryptographic Module (Off-Chain)

All cryptography runs **client-side in the browser**. No private keys or plaintext ever touch a server.

### 9.1 Key Generation & Encryption

```typescript
// crypto/jobKey.ts

/** Generate a random 256-bit symmetric key for a job */
function generateJobKey(): Uint8Array;       // crypto.getRandomValues(new Uint8Array(32))

/** Generate a random 256-bit salt for agreement hash */
function generateSalt(): Uint8Array;

/** AES-256-GCM encrypt plaintext with K_job */
async function encrypt(plaintext: Uint8Array, key: Uint8Array): Promise<{
  ciphertext: Uint8Array;
  iv: Uint8Array;             // 12-byte random IV
  tag: Uint8Array;            // 16-byte auth tag
}>;

/** AES-256-GCM decrypt */
async function decrypt(ciphertext: Uint8Array, key: Uint8Array, iv: Uint8Array): Promise<Uint8Array>;

/** Compute agreementHash = keccak256(salt || plaintext) */
function computeAgreementHash(salt: Uint8Array, plaintext: Uint8Array): string;
```

### 9.2 ECDH Key Exchange

```typescript
// crypto/keyExchange.ts

/**
 * Encrypt K_job with the recipient's Ethereum public key.
 * Uses ECIES (Elliptic Curve Integrated Encryption Scheme):
 *   1. Generate ephemeral keypair
 *   2. ECDH shared secret with recipient's public key
 *   3. KDF (HKDF-SHA256) to derive AES key
 *   4. AES-256-GCM encrypt K_job
 *   5. Output: ephemeral public key || iv || ciphertext || tag
 */
async function encryptForRecipient(
  jobKey: Uint8Array,
  recipientPublicKey: Uint8Array
): Promise<Uint8Array>;

/**
 * Decrypt K_job using the recipient's Ethereum private key.
 * Reverses the ECIES process.
 */
async function decryptWithPrivateKey(
  encryptedPackage: Uint8Array,
  privateKey: Uint8Array
): Promise<Uint8Array>;
```

### 9.3 Dispute Key Distribution Flow

```typescript
// crypto/disputeKey.ts

/**
 * Encrypt K_job for the judge using their ephemeral public key.
 * Called by both client and freelancer during T_keyDistribution.
 */
async function encryptKeyForJudge(
  jobKey: Uint8Array,
  judgeEphemeralPubKey: Uint8Array
): Promise<Uint8Array>;
```

---

## 10. IPFS & Data Availability (Off-Chain)

### 10.1 Upload Flow

```typescript
// ipfs/upload.ts

interface IPFSUploadResult {
  cid: string;              // e.g., "QmXoY..."
  encryptedHash: string;    // keccak256(ciphertext) — stored on-chain
}

/**
 * 1. Encrypt plaintext with K_job (AES-256-GCM)
 * 2. Upload ciphertext to Pinata
 * 3. Register CID on-chain via DataAvailability.registerCID()
 * 4. Return CID + hash for on-chain recording
 */
async function uploadEncrypted(
  plaintext: Uint8Array,
  jobKey: Uint8Array,
  jobId: number,
  contentType: ContentType,
  dataAvailabilityContract: DataAvailability
): Promise<IPFSUploadResult>;
```

### 10.2 Retrieval Flow

```typescript
// ipfs/retrieve.ts

/**
 * 1. Look up CID from on-chain CIDRecord (or from event logs)
 * 2. Fetch ciphertext from IPFS gateway
 * 3. Decrypt with K_job
 * 4. Verify integrity: keccak256(salt || plaintext) === agreementHash (for agreements)
 */
async function retrieveAndDecrypt(
  cid: string,
  jobKey: Uint8Array
): Promise<Uint8Array>;
```

### 10.3 Platform Pinning Service (Out of Scope for MVP)

In production, a backend service listens for `CIDRegistered` events and auto-pins content via Pinata API. For the course project, the frontend client directly pins via Pinata, which is sufficient.

---

## 11. Deployment & Configuration

### 11.1 Deploy Sequence

The contracts must be deployed in a specific order due to cross-references:

```typescript
// scripts/deploy.ts

async function main() {
  // 1. Deploy MockUSDC (testnet only)
  const usdc = await deployMockUSDC();

  // 2. Deploy DataAvailability (no dependencies)
  const dataAvailability = await deployDataAvailability();

  // 3. Deploy Reputation (no dependencies)
  const reputation = await deployReputation();

  // 4. Deploy Dispute (needs IJobEscrow address — set later)
  const dispute = await deployDispute(dataAvailability.address);

  // 5. Deploy JobEscrow (needs all addresses)
  const jobEscrow = await deployJobEscrow(
    usdc.address,
    dispute.address,
    reputation.address,
    dataAvailability.address,
    treasuryAddress
  );

  // 6. Post-deploy configuration: wire cross-references
  await dispute.setJobEscrow(jobEscrow.address);       // Dispute needs JobEscrow address
  await reputation.grantRole(ESCROW_ROLE, jobEscrow.address);
  await dispute.grantRole(ESCROW_ROLE, jobEscrow.address);
  await jobEscrow.grantRole(DISPUTE_ROLE, dispute.address);
  await dataAvailability.grantRole(ESCROW_ROLE, jobEscrow.address);
  await dataAvailability.grantRole(DISPUTE_ROLE, dispute.address);

  // 7. Grant PLATFORM_ADMIN to deployer / multisig
  await dispute.grantRole(PLATFORM_ADMIN, platformAdminAddress);
}
```

### 11.2 Configuration Parameters

All configurable parameters are set as `public constant` or `immutable` in the contracts. No upgradability is planned for the course project (KISS principle). If parameters need changing, redeploy.

| Parameter | Location | Value |
|-----------|----------|-------|
| `PROTOCOL_FEE_BPS` | `JobEscrow` | 200 (2%) |
| `FREELANCER_DEPOSIT_BPS` | `JobEscrow` | 500 (5%) |
| `BEHAVIOR_BOND_BPS` | `JobEscrow` | 500 (5%) |
| `MIN_MILESTONE_BPS` | `JobEscrow` | 1000 (10%) |
| `T_ACCEPTANCE` | `JobEscrow` | 14 days |
| `T_STAKE` | `JobEscrow` | 3 days |
| `ALLOWED_REVIEW_TIMEOUTS` | `JobEscrow` | [1d, 3d, 7d, 14d, 21d, 30d] |
| `T_EVIDENCE` | `Dispute` | 5 days |
| `T_KEY_DISTRIBUTION` | `Dispute` | 2 days |
| `T_RULING` | `Dispute` | 14 days |
| `DISPUTE_FEE_BASE` | `DisputeFeeLib` | 10e6 (10 USDC) |
| `DISPUTE_FEE_CAP` | `DisputeFeeLib` | 1_000e6 (1,000 USDC) |
| `DISPUTE_FEE_BPS` | `DisputeFeeLib` | 100 (1%) |
| `BOND_SLASH_MAX_BPS` | `JobEscrow` | 300 (3% of milestone value) |
| `DEPOSIT_SLASH_MAX_BPS` | `JobEscrow` | 5000 (50% of deposit) |

---

## 12. Testing Strategy

### 12.1 Unit Tests (per contract)

Each contract has isolated unit tests covering:

**JobEscrow.test.ts:**

| Test Group | Cases |
|-----------|-------|
| `postJob()` | Valid creation, milestone sum validation, minimum milestone %, invalid review timeout, behavior bond for New/Bronze, no bond for Silver/Gold, USDC transfer verification |
| `applyForJob()` | Valid application, duplicate application rejected, application to non-Open job |
| `selectFreelancer()` | Valid selection, non-applicant rejected, only client can select |
| `confirmAndStake()` | Valid stake, T_stake expiry, wrong freelancer rejected, USDC deposit transfer |
| `submitMilestone()` | Valid submission, deadline not passed, correct milestone order, CID registration |
| `approveMilestone()` | Valid approval, fund release calculation (2% fee), only client, only InReview status |
| `triggerAutoApprove()` | Exact boundary (strict `>`), just before timeout (revert), just after timeout (success), anyone can call |
| `raiseDispute()` | Only InReview, fee calculation, Dispute contract called, milestone → Disputed |
| `claimAbandonment()` | Past deadline, deposit forfeited, escrow returned |
| `cancelJob()` | Each state-dependent cancellation rule (6 scenarios from WorkflowDesign §2.6) |
| `requestCancellation/acceptCancellation()` | Mutual cancellation, partial completion, deposit refund |
| `withdraw()` | Correct balance, zero balance, reentrancy guard |
| `executeDisputeRuling()` | Access control (only Dispute), each ruling outcome, deposit slash, bond slash, idempotency |

**Dispute.test.ts:**

| Test Group | Cases |
|-----------|-------|
| `createDispute()` | Only from JobEscrow, correct phase transition |
| `submitEvidence()` | Within window, after window (revert), both parties can submit, CID registered |
| `assignJudge()` | Only PLATFORM_ADMIN, correct phase, ephemeral key stored |
| `distributeKeyToJudge()` | Client submits, freelancer submits, both submitted → UnderReview |
| `claimKeyDefault()` | Client missing → FreelancerWins, Freelancer missing → ClientWins, Both missing → Inconclusive |
| `submitRuling()` | Only judge, within T_ruling, each ruling value |
| `executeRuling()` | Correct cross-contract call to JobEscrow, fee refund logic, idempotency |

**Reputation.test.ts:**

| Test Group | Cases |
|-----------|-------|
| Scoring | Freelancer score calculation, client score calculation, fixed-point precision |
| Tier logic | Each tier boundary (New→Bronze→Silver→Gold), edge cases at exact thresholds |
| Access control | Only ESCROW_ROLE can mutate state |
| Soulbound | No transfer function exists (compile-time check) |

**DataAvailability.test.ts:**

| Test Group | Cases |
|-----------|-------|
| `registerCID()` | Valid registration, duplicate CID rejected, event emitted |
| `setRetentionExpiry()` | Only authorized caller, correct expiry calculation |

### 12.2 Integration Tests

End-to-end scenarios testing the full cross-contract flow:

**FullFlow.test.ts** (combined integration tests):

*Happy Path:*
1. Client posts job → freelancer applies → client selects → freelancer stakes → submit all milestones → client approves all → job completed → withdraw funds → verify reputation updated
2. Auto-approve milestone after review timeout

*Dispute Path:*
1. Full dispute: raise → evidence → judge assigned → keys distributed → ruling (FreelancerWins) → execute → verify fund redistribution + reputation
2. Full dispute: ruling (ClientWins) → verify refund + deposit slash
3. Full dispute: ruling (Inconclusive) → verify 50/50 split

*Cancellation:*
1. Cancel before freelancer selected → full refund
2. Mutual cancellation in ACTIVE → refund + deposit returned

*Timeouts:*
1. T_deadline expiry → claimAbandonment
2. T_acceptance expiry → withdrawExpiredJob

### 12.3 Security Tests

**Reentrancy.test.ts:**
- Malicious USDC contract attempts reentrancy on `withdraw()`, `approveMilestone()`, `executeDisputeRuling()` → all revert

**RaceCondition.test.ts:**
- Same block: `approveMilestone()` + `triggerAutoApprove()` → only first succeeds
- Same block: `raiseDispute()` + `triggerAutoApprove()` → dispute takes priority (first to execute wins; both require `InReview`)
- Same block: `approveMilestone()` + `raiseDispute()` → only first succeeds
- Double `executeDisputeRuling()` → second is no-op (idempotent)
- Double `withdraw()` → second transfers 0

**AccessControl.test.ts:**
- Every restricted function called from unauthorized address → revert
- `executeDisputeRuling()` called directly (not from Dispute) → revert
- Reputation functions called from non-JobEscrow → revert

### 12.4 Coverage Target

| Metric | Target |
|--------|--------|
| Line coverage | ≥ 95% |
| Branch coverage | ≥ 90% |
| Function coverage | 100% |

---

## 13. Security Checklist

Before deployment, verify every item:

- [ ] **ReentrancyGuard** on all functions that transfer USDC or update withdrawable balances
- [ ] **SafeERC20** for all `transfer` / `transferFrom` calls (handles non-standard ERC-20 return values)
- [ ] **Checks-effects-interactions** pattern in every state-mutating function
- [ ] **State mutex**: every function checks `require(milestone.status == EXPECTED)` and immediately updates status before external calls
- [ ] **Idempotent terminal ops**: `fundsProcessed`, `depositRefunded`, `bondRefunded` flags prevent double execution
- [ ] **Strict timestamp comparison**: `block.timestamp > deadline` (not `>=`) for auto-approve
- [ ] **Integer arithmetic**: no division-before-multiplication; BPS calculations use `(value * bps) / 10_000` order
- [ ] **USDC 6-decimal awareness**: all constants denominated in `1e6` units (not `1e18`)
- [ ] **Access control**: every restricted function has `onlyRole()` modifier; roles granted only during deploy
- [ ] **No `selfdestruct`**: contracts are permanent
- [ ] **No `delegatecall`**: no proxy/upgradability (keeps attack surface minimal)
- [ ] **Event emission**: every state change emits an event for off-chain indexing
- [ ] **Pull-over-push**: funds credited to `withdrawableBalances` mapping; users call `withdraw()` themselves
- [ ] **Input validation**: all array lengths checked, `address(0)` rejected, milestone values sum validated

---

## 14. Gas Optimization Notes

Since deployment targets an L2 (Base), gas costs are already near-zero. However, the following optimizations are applied for good practice:

| Optimization | Technique |
|-------------|-----------|
| Storage packing | `Job` struct fields ordered to minimize slots: `address` (20 bytes) + `uint8` (1 byte) + `bool` (1 byte) packed into single slot where possible |
| Immutable references | `usdc` is `immutable` — no SLOAD needed. Other references (`dispute`, `reputation`, `dataAvailability`) are mutable to support post-deploy wiring and flexibility on L2 where gas is minimal |
| `calldata` over `memory` | All external function parameters use `calldata` for arrays and bytes |
| Short-circuit `require` | Cheapest checks first (state check before balance check before external call) |
| Batch milestone creation | `postJob()` creates all milestones in a single transaction |
| No string storage | All human-readable strings (job descriptions, evidence text) are stored on IPFS; on-chain stores only `bytes32` hashes and CID strings |
| Minimal events | Events carry only indexed fields needed for filtering + essential data; full details fetched from IPFS |

---

## Appendix A: Dispute Fee Calculation Library

```solidity
// libraries/DisputeFeeLib.sol

library DisputeFeeLib {
    uint256 constant FEE_BASE = 10e6;        // 10 USDC (6 decimals)
    uint256 constant FEE_CAP = 1_000e6;      // 1,000 USDC
    uint256 constant FEE_BPS = 100;           // 1%

    /// @notice Calculate dispute fee: max(10 USDC, min(1% * milestoneValue, 1000 USDC))
    function calculateFee(uint256 milestoneValue) internal pure returns (uint256) {
        uint256 proportional = (milestoneValue * FEE_BPS) / 10_000;
        uint256 capped = proportional < FEE_CAP ? proportional : FEE_CAP;
        return capped > FEE_BASE ? capped : FEE_BASE;
    }
}
```

## Appendix B: Review Timeout Validation

```solidity
// libraries/TimeoutLib.sol

library TimeoutLib {
    /// @notice Validate that a review timeout is in the allowed set
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
```

## Appendix C: Mock USDC for Testing

```solidity
// mocks/MockUSDC.sol

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}

    function decimals() public pure override returns (uint8) { return 6; }

    /// @notice Anyone can mint — test only
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
```
