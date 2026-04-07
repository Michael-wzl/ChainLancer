# Decentralized Freelance Escrow Platform

> **Course**: IS4302 — Blockchain & Distributed Ledger Technologies  
> **Date**: April 2026  
> **Scope**: High-level workflow only. Contract-level specifications are deferred.

---

## Table of Contents

1. [System Architecture (Simplified)](#1-system-architecture-simplified)
2. [Path A — Happy Path (No Dispute)](#2-path-a--happy-path-no-dispute)
3. [Path B — Dispute Path (Centralized Resolution)](#3-path-b--dispute-path-centralized-resolution)
4. [State Machine](#4-state-machine)
5. [Economic Incentive Design](#5-economic-incentive-design)
6. [Attack Analysis & Defenses](#6-attack-analysis--defenses)

---

## 1. System Architecture (Simplified)

With the decentralized arbitration removed, the contract structure simplifies:

```text
┌───────────────────────────────────────────────────────────────────────┐
│                          Frontend (dApp)                              │
│                    React + ethers.js + IPFS                           │
└──────────┬──────────────────────┬──────────────────────┬──────────────┘
           │                      │                      │
           ▼                      ▼                      ▼
  ┌─────────────────┐   ┌──────────────────┐   ┌─────────────────────┐
  │  JobEscrow.sol  │   │  Dispute.sol     │   │  Reputation.sol     │
  │  ─────────────  │   │  ──────────────  │   │  ───────────────    │
  │  Job lifecycle  │──>│  Dispute creation│   │  Soulbound scores   │
  │  Escrow logic   │   │  Evidence submit │   │  Value-weighted     │
  │  Milestone mgmt │   │  Platform ruling │   │  Non-transferable   │
  │  Timeout logic  │<──│  Fund redistrib. │   └─────────────────────┘
  └────────┬────────┘   └────────┬────────┘
           │                     │
           ▼                     ▼
      ┌───────────┐    ┌─────────────────────────┐
      │   USDC    │    │  DataAvailability.sol    │
      │  (ERC-20) │    │  ───────────────────     │
      │  external │    │  CID registry on-chain   │
      └───────────┘    │  Pinning confirmations   │
                       │  Retention enforcement   │
                       └────────────┬─────────────┘
                                    │
                                    ▼
                       ┌─────────────────────────┐
                       │  Platform IPFS Pinning   │
                       │  Node (off-chain)        │
                       │  ─────────────────────   │
                       │  Auto-pin on CID emit    │
                       │  Heartbeat liveness proof │
                       │  Multi-provider fallback  │
                       └─────────────────────────┘
```

| Contract | Responsibility |
| -------- | ------------- |
| **JobEscrow.sol** | Job creation, milestone management, escrow locking/release, configurable timeouts, cancellation. **Serves as the single authoritative source of fund and milestone state.** Deployed behind a **UUPS proxy** (`UUPSUpgradeable`) for upgradeability, with upgrade authorization restricted to `DEFAULT_ADMIN_ROLE`. All state-mutating functions enforce a **state mutex** (per-milestone status check-before-update) to prevent race conditions between competing calls (e.g., `approveMilestone()` vs. `triggerAutoApprove()` vs. `raiseDispute()` in the same block). All terminal operations are **idempotent** — repeated calls after the first successful execution are no-ops (guarded by a `fundsProcessed` flag per milestone). Inherits OpenZeppelin `PausableUpgradeable` for emergency circuit-breaker functionality — the admin can pause all state-mutating user-facing functions. Uses `AccessControlDefaultAdminRulesUpgradeable` for time-delayed admin transfers (configurable delay set at initialization) and OpenZeppelin `ReentrancyGuard` on all fund-transferring functions. Funds are released via a **pull-over-push** (withdrawable balance) pattern: milestone payouts, deposit refunds, and bond refunds are credited to `withdrawableBalances[address]`, and recipients call `withdraw()` to claim. Applications are capped at **100 per job** (`MAX_APPLICATIONS_PER_JOB`) to prevent DoS from unbounded array growth, with O(1) duplicate application tracking via a mapping. |
| **Dispute.sol** | Dispute creation, evidence submission, recording the platform judge's ruling. **Does not hold or directly transfer funds.** Deployed behind a **UUPS proxy** (`UUPSUpgradeable`) for upgradeability. Uses `AccessControlDefaultAdminRulesUpgradeable` for role management and `ReentrancyGuard` on ruling execution. When a ruling is executed, `Dispute.sol` calls a restricted interface on `JobEscrow.sol` (`executeDisputeRuling(jobId, milestoneIdx, ruling, freelancerShareBps, depositSlashBps)`) to redistribute funds. This ensures `JobEscrow.sol` remains the single point of fund custody and state authority, preventing cross-contract inconsistencies. The `JobEscrow` address is wired post-deploy via `setJobEscrow()` (admin-only, re-callable to allow re-wiring if JobEscrow is redeployed — security is maintained via the time-delayed admin transfer rules). Evidence submissions are capped at **20 per party per dispute** (`MAX_EVIDENCE_PER_PARTY`) to bound gas costs. Upon ruling execution, the judge's `PLATFORM_JUDGE` role is **automatically revoked** (least-privilege principle). |
| **Reputation.sol** | Soulbound (non-transferable) on-chain reputation scores for both clients and freelancers. Deployed behind a **UUPS proxy** (`UUPSUpgradeable`) for upgradeability. Uses `AccessControlDefaultAdminRulesUpgradeable` for role management. Reputation updates are triggered by `JobEscrow.sol` upon milestone completion or dispute conclusion via direct restricted function calls (gated by `ESCROW_ROLE`), ensuring reputation cannot be updated without a corresponding fund state change. Tracks separate counters for disputes lost and voluntary cancellations. Scoring formulas are implemented in `ReputationLib.sol`. |
| **DataAvailability.sol** | On-chain CID registry, pinning confirmation records, retention period enforcement. Deployed behind a **UUPS proxy** (`UUPSUpgradeable`) for upgradeability. Uses `AccessControlDefaultAdminRulesUpgradeable` for role management. Emits `CIDRegistered` events consumed by the platform's IPFS pinning node to guarantee data availability. Supports four content types: `Agreement`, `Deliverable`, `Evidence`, and `Proposal`. Enforces a cap of **50 CIDs per job** (`MAX_CIDS_PER_JOB`) to bound storage costs. CID registration is restricted to system contracts (`ESCROW_ROLE`, `DISPUTE_ROLE`) and admin — end users cannot register CIDs directly. Duplicate CIDs are allowed (idempotent — returns existing hash). Pinning confirmation and retention expiry are similarly restricted to authorized callers. |
| **PlatformRoles.sol** | Library defining role constants used across all contracts for access control: `ESCROW_ROLE` (granted to JobEscrow), `DISPUTE_ROLE` (granted to Dispute), `PLATFORM_ADMIN` (multisig), `PLATFORM_JUDGE` (dynamically granted/revoked per dispute), and `PROTOCOL_TREASURY` (reserved for future governance features — currently unused in access control checks). All contracts use OpenZeppelin `AccessControlDefaultAdminRulesUpgradeable` (with time-delayed admin transfers) rather than plain `AccessControl`, providing an additional safety layer for admin operations. |
| **USDC** | External stablecoin (ERC-20, 6 decimals) used for all payments. All token interactions use OpenZeppelin `SafeERC20`. |

> **Removed**: `Arbitration.sol` (decentralized jury logic), `PlatToken.sol` (juror staking token). These are no longer needed under the centralized dispute model.

---

## 2. Path A — Happy Path (No Dispute)

### 2.1 Workflow Diagram

```text
  Client                        JobEscrow                      Freelancer
    │                               │                               │
    │── 1. postJob() ──────────────>│                               │
    │   [Lock USDC for all          │                               │
    │    milestones in escrow]      │                               │
    │   [Choose T_review from       │                               │
    │    {1d, 3d, 7d, 14d,         │                               │
    │     21d, 30d}]               │                               │
    │   [Generate K_job, encrypt    │                               │
    │    agreement → IPFS]          │                               │
    │   [agreementHash on-chain]    │                               │
    │   [Behavior bond based on     │                               │
    │    client tier: 7.5%/5%/      │                               │
    │    2.5%/1%]                   │                               │
    │                               │                               │
    │                               │<──── 2. applyForJob() ────────│
    │                               │      [IPFS proposal hash]     │
    │                               │      [On-chain reputation     │
    │                               │       visible to client]      │
    │                               │      [T_review visible to     │
    │                               │       freelancer before       │
    │                               │       applying]               │
    │                               │                               │
    │── 3. selectFreelancer() ─────>│                               │
    │   [Choose from applicants]    │                               │
    │   [Send Enc(pk_free, K_job)]  │                               │
    │   [T_stake timer starts       │                               │
    │    (3 days)]                  │                               │
    │                               │                               │
    │                               │<──── 4a. confirmAndStake() ───│
    │                               │      [Decrypt K_job with      │
    │                               │       private key]            │
    │                               │      [Stake graduated deposit │
    │                               │       (7.5%/5%/2.5%/1%       │
    │                               │        based on tier)]        │
    │                               │      [Job → Active]           │
    │                               │                               │
    │                               │  OR                           │
    │                               │                               │
    │                               │<──── 4b. rejectOffer() ───────│
    │                               │      [Freelancer explicitly   │
    │                               │       declines the offer]     │
    │                               │      [Client can immediately  │
    │                               │       select another]         │
    │                               │                               │
    │                               │  OR                           │
    │                               │                               │
    │   (T_stake timeout) ─────────>│  [Auto-reject: offer expires] │
    │                               │  [Client can select another]  │
    │                               │                               │
    │                               │<──── 5. submitMilestone() ────│
    │                               │      [Enc(K_job, work) → IPFS]│
    │                               │      [Review timer starts     │
    │                               │       (T_review)]             │
    │                               │                               │
    │── 6a. approveMilestone() ────>│                               │
    │   OR                          │                               │
    │   6b. (T_review timeout) ───>│  [Auto-approve]               │
    │                               │                               │
    │                               │──── 7. Funds released ───────>│
    │                               │      [Milestone USDC − 2%     │
    │                               │       protocol fee]           │
    │                               │                               │
    │       ... repeat for each milestone ...                       │
    │                               │                               │
    │                               │──── 8. Final release ────────>│
    │                               │      [Deposit refunded]       │
    │                               │      [Reputation updated      │
    │                               │       for both parties]       │
```

### 2.2 Step-by-Step Description

| Step | Actor | Action | Details |
| ---- | ----- | ------ | ------- |
| **1** | Client | `postJob()` | Locks 100% of job value (USDC) in escrow. **Chooses the review timeout** $T_{\text{review}}$ from the allowed set: **{1 day, 3 days, 7 days, 14 days, 21 days, 30 days}** (validated by `TimeoutLib.isValidReviewTimeout()`). This timeout is stored on-chain and **cannot be changed** after posting. Each milestone must represent at least **10% of the total job value** (`MIN_MILESTONE_BPS = 1000`) — this prevents milestone manipulation (see §6.1) and effectively limits jobs to at most 10 milestones. The contract enforces a hard array limit of **20 milestones** as a gas safety bound, though the 10% minimum is the binding constraint. Each milestone has an **absolute deadline timestamp** (`milestoneDeadlines[i]`) that must be in the future at posting time. Generates per-job symmetric key $K_{job}$ and a **cryptographically random 256-bit salt**. Encrypts the agreement (including the salt) with $K_{job}$, uploads ciphertext to IPFS, registers the IPFS CID on-chain via `DataAvailability.sol` (emitting a `CIDRegistered` event that triggers the platform pinning node to auto-pin the content), and stores `agreementHash = keccak256(salt ‖ plaintext)` on-chain. The salt is embedded inside the encrypted IPFS payload — it is never published in the clear. This prevents **confirmation attacks** where an adversary who suspects the agreement content (e.g., from a standard template) could brute-force the hash to verify their guess. Clients also lock a **graduated behavior bond** based on their reputation tier: 7.5% (New), 5% (Bronze), 2.5% (Silver), or 1% (Gold). The total transfer is `totalValue + behaviorBond`. The client's `recordClientJobPosted()` is called on `Reputation.sol` to track jobs posted. |
| **2** | Freelancer(s) | `applyForJob()` | One or more freelancers browse open jobs. **The chosen $T_{\text{review}}$ is publicly visible on-chain**, so freelancers know exactly how long the client has to review before auto-approval kicks in. They can factor this into their decision to apply. Each application includes an optional IPFS proposal hash (registered on-chain via `DataAvailability.sol` as `ContentType.Proposal`) and their on-chain reputation is readable from `Reputation.sol`. No deposit or commitment is required to apply. The job transitions from `Open` to `Applications` on the first application. Duplicate applications from the same address are rejected via **O(1) mapping lookup** (not an array scan). The client cannot apply to their own job. Applications are capped at **100 per job** (`MAX_APPLICATIONS_PER_JOB`) to prevent DoS from unbounded array growth. |
| **3** | Client | `selectFreelancer()` | Client reviews applications (reputation scores, proposal content) and selects one freelancer. The contract verifies (via O(1) mapping lookup) that the freelancer has applied for this job. The freelancer should have previously registered a secp256k1 encryption public key on-chain via `registerEncryptionKey()` (33-byte compressed key), though this is enforced at the **application layer** (frontend) rather than on-chain — the contract does not require the encryption key to exist at selection time. The client publishes $\text{Enc}(pk_{\text{freelancer}}, K_{job})$ on-chain so the freelancer can decrypt all job content. Starts the $T_{\text{stake}}$ timer (3 days). The freelancer may **accept** (Step 4a), **explicitly reject** (Step 4b), or **let the offer expire** (auto-reject on $T_{\text{stake}}$ expiry). In all rejection cases, the client can immediately select another applicant via `reselectFreelancer()`. If a previous selection has not been cleared (freelancer is still set), the client must use `reselectFreelancer()` instead. |
| **4a** | Freelancer | `confirmAndStake()` | Decrypts $K_{job}$ using their private key. Reviews the full agreement. If they agree, stakes a **graduated deposit** based on their freelancer reputation tier: 7.5% (New), 5% (Bronze), 2.5% (Silver), or 1% (Gold) of the total job value in USDC. Job transitions to **Active**. Must be called within $T_{\text{stake}}$ (3 days). |
| **4b** | Freelancer | `rejectOffer()` | The selected freelancer **explicitly declines** the offer. This immediately clears the selection, allowing the client to call `reselectFreelancer()` without waiting for $T_{\text{stake}}$ to expire. This is important because the client has no time limit on how long they can take to select a freelancer — the freelancer may have moved on to other commitments since applying. No reputation penalty is incurred for rejecting an offer. |
| **4c** | Anyone | `expireOffer()` | If the freelancer neither accepts nor rejects within $T_{\text{stake}}$ (3 days), the offer is **automatically rejected**. Anyone can call `expireOffer()` to clear the stale selection, enabling the client to select another applicant. This is functionally equivalent to the existing `reselectFreelancer()` timeout check, but makes the auto-reject semantics explicit. |
| **5** | Freelancer | `submitMilestone()` | Milestones may be submitted in any order — the freelancer is not required to complete them sequentially. The submission must be made **before the milestone's absolute deadline** (`block.timestamp <= ms.deadline`); attempting to submit after the deadline reverts. Encrypts deliverable with $K_{job}$, uploads to IPFS, registers the deliverable CID on-chain via `DataAvailability.sol` (platform pinning node auto-pins upon `CIDRegistered` event), and records ciphertext hash on-chain. The review timer ($T_{\text{review}}$, as chosen by the client at Step 1) starts counting from `submittedAt`. |
| **6a** | Client | `approveMilestone()` | Client decrypts and reviews the deliverable. If satisfied, approves the milestone. Funds are released. |
| **6b** | Anyone | `triggerAutoApprove()` | If $\text{block.timestamp} > \text{submittedAt} + T_{\text{review}}$ and the client has not acted, anyone can trigger auto-approval. Funds are released automatically. |
| **7** | Contract | Funds released | Milestone USDC (minus 2% protocol fee) is credited to the freelancer's `withdrawableBalances` mapping. The 2% fee is credited to the protocol treasury's withdrawable balance. The freelancer (and treasury) can call `withdraw()` at any time to pull accumulated funds (pull-over-push pattern). |
| **8** | Contract | Final release | After the last milestone is approved (or resolved via dispute): freelancer's deposit (graduated by tier) is refunded to their withdrawable balance; client's behavior bond (remaining after any dispute slashing) is refunded; `recordJobCompleted()` is called on `Reputation.sol` for the client (recording total value and milestone count) and `recordFreelancerJobCompleted()` for the freelancer; data availability retention expiry is set to `block.timestamp + 21 days`. The milestone completion check considers `Approved`, `AutoApproved`, and `Resolved` (post-dispute) statuses as finalized. |

### 2.3 Timeout Design — Client-Chosen Review Period

The client selects the review timeout when posting the job. This provides flexibility while preventing abuse:

| Allowed $T_{\text{review}}$ | Typical Use Case |
| ---------------------------- | --------------- |
| **1 day** | Small, well-defined tasks (e.g., logo design, bug fix) |
| **3 days** | Standard short tasks |
| **7 days** | Default for most projects |
| **14 days** | Complex deliverables requiring thorough review |
| **21 days** | Large-scope milestones |
| **30 days** | Enterprise-grade deliverables, audit-intensive work |

**Key rules:**

1. **Immutable after posting.** The timeout is written on-chain at `postJob()` and cannot be modified. This prevents the client from extending the timeout after receiving work to stall payment.
2. **Visible to freelancers before applying.** The timeout is a public field on the job struct. Freelancers can see it before calling `applyForJob()`. A client who sets an unreasonably long timeout (e.g., 30 days for a simple task) will attract fewer applicants — the market self-regulates.
3. **Applies uniformly to all milestones.** All milestones within a job share the same $T_{\text{review}}$ to keep the design simple. (A future enhancement could allow per-milestone timeouts.)

### 2.4 Other Timeouts

| Timeout | Duration | Effect |
| ------- | -------- | ------ |
| **$T_{\text{acceptance}}$** | 14 days | If no freelancer applies or client doesn't select, client can withdraw escrowed funds |
| **$T_{\text{stake}}$** | 3 days | Selected freelancer must call `confirmAndStake()` or `rejectOffer()` within 3 days. If the freelancer explicitly rejects, the client can immediately select another applicant. If the freelancer does not respond, the offer is auto-rejected on expiry and the client can pick another. |
| **$T_{\text{deadline}}$** | Per-milestone (absolute timestamp, set by client at `postJob()`) | Enforced at two points: (1) `submitMilestone()` reverts if `block.timestamp > ms.deadline` — freelancer cannot submit past deadline. (2) If freelancer misses deadline and no milestones are currently `IN_REVIEW` or `DISPUTED`, client can call `claimAbandonment()` → deposit forfeited to platform treasury, remaining escrow returned to client. The guard prevents using abandonment to bypass active reviews or disputes. |
| **$T_{\text{review}}$** | **Client-chosen: 1d / 3d / 7d / 14d / 21d / 30d** | Auto-approve on expiry |

### 2.5 State Transition Safety Rules

Because multiple actors can call competing functions on the same milestone within a single block (or across consecutive blocks near a timeout boundary), the contract enforces strict **state-mutex** and **idempotency** rules:

**1. Mutual exclusion via state preconditions.** Every state-mutating function begins with a `require(milestone.status == EXPECTED_STATUS)` check and immediately updates the status via a checks-effects-interactions pattern. This ensures that if two competing transactions land in the same block (e.g., `approveMilestone()` and `triggerAutoApprove()`), only the first to execute succeeds; the second reverts.

**2. Dispute freezes funds and pauses the auto-approve timer.** If a milestone is in `IN_REVIEW` and `raiseDispute()` is called before `triggerAutoApprove()` executes, the milestone transitions to `DISPUTED`, the escrowed funds for that milestone are **frozen**, and the **auto-approve timer ($T_{\text{review}}$) is paused**. No automated release can occur while the dispute is active. The timer remains suspended until the platform signals a manual resolution by calling `executeRuling()`. Conversely, once a milestone is `APPROVED` or `AUTO_APPROVED`, it cannot be disputed — the transition is irreversible. The rule is: **`raiseDispute()` is only callable while `milestone.status == IN_REVIEW`**.

**3. Idempotent terminal operations.** All functions that produce a terminal effect (fund release, deposit refund, reputation update) are guarded by a `processed` flag. Repeated calls after the first successful execution are harmless no-ops. This prevents double-release of funds or double-counting of reputation.

**4. Strict timestamp comparisons.** Auto-approve uses strict greater-than: `block.timestamp > submittedAt + T_review` (not `>=`). This eliminates ambiguity at the exact boundary second and gives the client the full duration they chose.

**5. Cross-contract call ordering.** When `Dispute.sol` calls `JobEscrow.executeDisputeRuling()`, the function atomically: (a) updates milestone status, (b) redistributes funds to withdrawable balances, and (c) calls `Reputation.sol` directly via restricted function calls (e.g., `recordMilestoneCompletion()`, `recordClientDisputeLoss()`, `recordFreelancerDisputeLoss()`). Reputation updates are **synchronous cross-contract calls** within the same transaction, not event-based. If any sub-step fails, the entire transaction reverts — ensuring no partial state updates across contracts.

### 2.6 Cancellation Rules

Cancellation behavior depends on the current job state. The rules are designed to be fair to both parties based on how much commitment has been made at each stage:

| Job State | Who Can Cancel | Action | Fund Disposition | Reputation & Deposit Effects |
| --------- | -------------- | ------ | ---------------- | ---------------------------- |
| **OPEN** (no applicants yet) | Client | `cancelJob()` | 100% of escrowed funds returned to client. Behavior bond refunded in full. | No reputation impact. No freelancer is involved. |
| **APPLICATIONS** (freelancers have applied, none selected) | Client | `cancelJob()` | 100% of escrowed funds returned to client. Behavior bond refunded in full. | No reputation impact — freelancers have not committed any deposit or performed any work. |
| **APPLICATIONS** (freelancer selected, awaiting `confirmAndStake()`) | Client | `cancelJob()` | Client **cannot cancel while the freelancer has a live pending offer** (`block.timestamp <= selectedAt + T_STAKE`). The client must wait for the $T_{\text{stake}}$ window to expire before cancelling. Once the offer has expired: 100% of escrowed funds returned to client. Behavior bond refunded in full. | Client incurs a minor cancellation penalty ($C \times 0.1$ in the reputation formula). The selected freelancer's reputation is unaffected. |
| **APPLICATIONS** (freelancer selected, awaiting `confirmAndStake()`) | Freelancer | `rejectOffer()` | No fund changes — escrow remains locked for the job. Selection is cleared; client can call `reselectFreelancer()` immediately. | No reputation impact on either party. Rejecting an offer is a normal, expected action. |
| **ACTIVE** (freelancer staked, work in progress, no milestone submitted yet) | Client | `requestCancellation()` | Requires **freelancer consent** via `acceptCancellation()`. Can only be initiated when no milestones are currently `IN_REVIEW` or `DISPUTED`. If both agree: remaining escrow returned to client; freelancer's deposit refunded in full; funds for any already-approved milestones are unaffected (already released). | Client incurs a cancellation penalty ($C \times 0.1$). Freelancer reputation unaffected. |
| **ACTIVE** | Freelancer | `requestCancellation()` | Requires **client consent** via `acceptCancellation()`. Can only be initiated when no milestones are currently `IN_REVIEW` or `DISPUTED`. If both agree: remaining escrow returned to client; freelancer's deposit refunded in full. | Freelancer incurs a minor reputation penalty (equivalent to an incomplete job). Client reputation unaffected. |
| **ACTIVE** | Either party (unilateral, no consent) | `raiseDispute()` | **Unilateral cancellation is not permitted in ACTIVE state.** The dissatisfied party must wait for a milestone to be submitted (entering `IN_REVIEW` status), then raise a dispute on that milestone. `raiseDispute()` is only callable while `milestone.status == IN_REVIEW` — it cannot be raised on a `Pending` milestone. If the freelancer has missed a deadline without submitting, the client should use `claimAbandonment()` instead. | N/A — routed to dispute. |
| **IN_REVIEW** | Neither | — | **Cancellation is blocked** while a milestone is under review. The client must either approve, reject (via dispute), or wait for auto-approve. | N/A |
| **DISPUTED** | Neither | — | **Cancellation is blocked** while a dispute is active. The dispute must be resolved first. | N/A |

**Key rules:**

1. **Mutual cancellation is always available in ACTIVE state.** If both parties agree, the job can be cleanly wound down at any point. Already-released milestone funds are not clawed back — only remaining escrow is returned.
2. **Unilateral cancellation is only possible before work begins** (OPEN or APPLICATIONS states), and **cannot occur while a freelancer has a live pending offer** — the client must wait for $T_{\text{stake}}$ to expire before calling `cancelJob()`. Once the freelancer has staked their deposit and the job is ACTIVE, unilateral exit requires the dispute path.
3. **Partial completion is handled gracefully.** If 3 out of 5 milestones have been approved and paid, a mutual cancellation returns only the remaining 2 milestones' escrow to the client. The freelancer keeps all previously released funds and receives their full deposit back.
4. **$T_{\text{acceptance}}$ auto-cancellation.** If the job remains in OPEN or APPLICATIONS state for longer than $T_{\text{acceptance}}$ (14 days) without a freelancer being selected and confirmed, the client can call `withdrawExpiredJob()` to withdraw all escrowed funds and behavior bond — effectively an automatic cancellation with no reputation penalty. The job transitions to `Cancelled`.

---

## 3. Path B — Dispute Path (Centralized Resolution)

### 3.1 Overview

When a client rejects a milestone or either party believes the other is acting in bad faith, a dispute can be raised. Under the simplified design, the dispute is resolved by a **platform-appointed judge** (or panel of judges) rather than a decentralized jury.

**Key assumption:** We assume the platform will fairly assign a judge or judges with the relevant domain expertise to evaluate the dispute. The platform acts as a trusted neutral party for dispute resolution only — it still cannot access escrowed funds or override non-dispute outcomes.

### 3.2 Workflow Diagram

```text
  Either Party           JobEscrow            Dispute.sol           Platform Judge
    │                        │                     │                      │
    │── raiseDispute() ─────>│                     │                      │
    │   [Pay dispute fee]    │── createDispute() ─>│                      │
    │                        │   [Milestone funds  │                      │
    │                        │    frozen in escrow; │                      │
    │                        │    auto-approve timer│                      │
    │                        │    paused]           │                      │
    │                        │                     │                      │
    │── submitEvidence() ─────────────────────────>│   (T_evidence:       │
    │   [Enc(K_job, evidence)│                     │    5-day window)     │
    │    → IPFS]             │                     │                      │
    │                        │                     │                      │
    │                        │                     │── Platform assigns   │
    │                        │                     │   judge(s) with      │
    │                        │                     │   domain expertise   │
    │                        │                     │                      │
    │── distributeKey() ──────────────────────────>│                      │
    │   [Enc(pk_judge, K_job)]                     │──── Key forwarded ──>│
    │   [Both parties must   │                     │     to judge         │
    │    send within         │                     │                      │
    │    T_keyDistribution]  │                     │                      │
    │                        │                     │                      │
    │                        │                     │     Judge reviews:   │
    │                        │                     │     - Agreement      │
    │                        │                     │     - Deliverables   │
    │                        │                     │     - Evidence       │
    │                        │                     │     - MetaEvidence   │
    │                        │                     │                      │
    │                        │                     │<── submitRuling() ───│
    │                        │                     │    [ruling + reason  │
    │                        │                     │     hash on-chain]   │
    │                        │                     │                      │
    │                        │<── executeRuling() ─│                      │
    │<── Funds distributed ──│   per ruling        │                      │
    │    Reputation updated  │                     │                      │
    │    Deposits handled    │                     │                      │
```

### 3.3 Step-by-Step Description

| Step | Actor | Action | Details |
| ---- | ----- | ------ | ------- |
| **1** | Client or Freelancer | `raiseDispute()` | The disputing party pays a **dispute fee** calculated as $F_{\text{dispute}} = \max(50\text{ USDC},\; 10\% \times V_{\text{milestone}})$. By denominating the fee in the same stablecoin (USDC) used for all payments, the fee's real value is deterministic and immune to crypto-asset volatility — neither party faces unpredictable costs due to ETH price swings. The 10% rate makes the fee proportional to the value at stake, while the $50 minimum ensures that even small disputes carry a meaningful cost to deter frivolous filings. The disputed milestone's funds are **frozen in escrow** and the **automated release timer ($T_{\text{review}}$) is paused**. No auto-approve can be triggered while the dispute is active. The timer remains paused until the platform signals a manual resolution via `executeRuling()`. The milestone state changes to **Disputed**. Calls `Dispute.createDispute()`. |
| **2** | Both parties | `submitEvidence()` | Both parties have a **5-day evidence window** ($T_{\text{evidence}}$) to submit evidence. Evidence is encrypted with $K_{job}$ and uploaded to IPFS; the CID is registered on-chain via `DataAvailability.sol` as `ContentType.Evidence` (platform pinning node auto-pins upon `CIDRegistered` event), and the ciphertext hash is recorded on-chain with a block timestamp. Submissions after the evidence deadline revert. Each party is capped at **20 evidence submissions** per dispute (`MAX_EVIDENCE_PER_PARTY`) to bound gas costs and prevent evidence-flooding attacks. After the evidence deadline passes, either party or the platform admin (`PLATFORM_ADMIN` role) calls `closeEvidencePhase()` to transition the dispute to the `AwaitingJudge` phase. (On-chain contracts cannot execute timed transitions automatically — an explicit transaction is required.) |
| **3** | Platform Admin | `assignJudge()` | A `PLATFORM_ADMIN` assigns a judge with relevant domain expertise. The `assignJudge()` function accepts the judge address and a **33-byte compressed ephemeral public key** $(pk_{\text{judge}}^{\text{eph}})$ specific to this dispute. The function atomically: (a) records the judge address and ephemeral key on-chain, (b) **grants the `PLATFORM_JUDGE` role** to the judge via `AccessControl`, enabling them to call `submitRuling()`, (c) starts the key distribution timer ($T_{\text{keyDistribution}}$ = 2 days), and (d) transitions the dispute to the `KeyDistribution` phase. The ephemeral public key is emitted in a `JudgeAssigned(disputeId, judgeAddress, ephemeralPubKey)` event. This ensures that even if a judge's long-term identity key is compromised, no historical dispute content is exposed — each dispute's decryption capability is isolated to its ephemeral key. |
| **4** | Both parties | `distributeKeyToJudge()` | Both the client and freelancer encrypt $K_{job}$ with the judge's **ephemeral public key** and submit it on-chain: $\text{Enc}(pk_{\text{judge}}^{\text{eph}}, K_{job})$. Must be done within $T_{\text{keyDistribution}}$ (2 days). Each party can only submit once (enforced by `clientKeySubmitted` / `freelancerKeySubmitted` flags). When **both parties** have submitted their keys, the dispute automatically transitions to the `UnderReview` phase and the ruling timer ($T_{\text{ruling}}$ = 14 days) starts. Non-cooperation triggers a default ruling via `claimKeyDefault()` (see §3.5). |
| **5** | Judge | Review | The judge decrypts $K_{job}$ using their ephemeral private key $sk_{\text{judge}}^{\text{eph}}$, then decrypts and reviews: (a) the original agreement — the decrypted payload includes the embedded salt, and the judge verifies integrity by computing `keccak256(salt ‖ plaintext)` and comparing it against the on-chain `agreementHash`, (b) **only the disputed milestone's deliverable** (the platform's frontend restricts the CID list provided to the judge to the disputed milestone and its dependencies — not all milestones), (c) all submitted evidence, and (d) the MetaEvidence. While $K_{job}$ technically permits decryption of all milestones, the platform enforces a **least-privilege access policy** at the application layer: the judge's review interface only surfaces CIDs relevant to the dispute. |
| **6** | Judge | `submitRuling()` | The judge submits a ruling on-chain during the `UnderReview` phase, before $T_{\text{ruling}}$ expires. The contract verifies `msg.sender == d.judge` (identity-based check rather than role-based, ensuring only the specifically assigned judge can rule on this dispute). The ruling is one of three outcomes (see §3.4). The contract enforces consistency constraints: if `FreelancerWins`, `freelancerShareBps` must be > 5000 (majority to freelancer); if `ClientWins`, `freelancerShareBps` must be < 5000 (majority to client); `depositSlashBps` cannot exceed 5000 (50% cap) and must be 0 for `Inconclusive` rulings. A hash of the written reasoning (`reasoningHash`) is also recorded on-chain for transparency. The dispute transitions to the `Ruled` phase. |
| **7** | Client, Freelancer, Judge, or Platform Admin | `executeRuling()` | Once the dispute reaches the `Ruled` phase, any authorized party (client, freelancer, judge, or platform admin) can call `executeRuling()` on `Dispute.sol`, which in turn calls `JobEscrow.executeDisputeRuling()` to atomically apply the ruling. Funds are distributed per the ruling. Reputation is updated. Deposits and behavior bonds are handled according to the outcome. The dispute transitions to the `Executed` phase. The judge's `PLATFORM_JUDGE` role is **automatically revoked** upon execution (least-privilege principle — the judge retains no on-chain permissions after their duty is fulfilled). Upon ruling execution, the judge is required to **delete the ephemeral private key** $sk_{\text{judge}}^{\text{eph}}$ and any cached plaintext. Only the ruling hash and on-chain records are retained for auditability. |

### 3.4 Ruling Outcomes

All three rulings support a **parameterized fund split** via `freelancerShareBps` (0–10000), allowing the judge to make proportional rather than all-or-nothing decisions. The dispute fee is **refunded to the initiating party if they win**; if the initiator loses, the fee goes to the **platform treasury** (it is never sent to the opposing party). For inconclusive rulings, the fee is sent to the platform treasury.

| Ruling | Effect on Funds | Effect on Deposits & Bonds | Effect on Reputation |
| ------ | --------------- | ------------------------- | -------------------- |
| **1 — Freelancer Wins** | Milestone funds split per the judge's `freelancerShareBps` (must be > 50%), minus 2% protocol fee. The freelancer receives the majority; any remainder goes to the client. | Freelancer deposit untouched. Dispute fee **refunded to the initiator** if the freelancer initiated the dispute; otherwise sent to the **platform treasury** (the losing client's fee is not given to the freelancer). Up to 3% of milestone value is slashed from the client's behavior bond and **sent to the platform treasury** (not to the freelancer). | Client: lost-dispute penalty ($L \times 0.3$). Freelancer: milestone credited at 0.5× multiplier (dispute win). |
| **2 — Client Wins** | Milestone funds split per the judge's `freelancerShareBps` (must be < 50%), minus 2% protocol fee. The client receives the majority; any remainder goes to the freelancer. | Freelancer's deposit may be partially slashed: the contract first calculates the **proportional deposit** for this milestone (`freelancerDeposit × milestoneValue / totalJobValue`), then slashes up to `depositSlashBps` (capped at 50%) of that proportional amount; **slashed amount goes to the platform treasury**. Dispute fee **refunded to the initiator** if the client initiated the dispute; otherwise sent to the **platform treasury** (the losing freelancer's fee is not given to the client). Behavior bond untouched. | Freelancer: lost-dispute penalty ($L \times 0.3$). Client: no penalty. |
| **0 — Inconclusive** | Funds split per the judge's `freelancerShareBps` (any value 0–100%), minus 2% protocol fee. Default is 50/50. | Both deposits untouched (the contract enforces `depositSlashBps == 0` for Inconclusive rulings). Dispute fee sent to the **platform treasury** (not refunded to either party). | No reputation penalty for either party. |

### 3.5 Timeout & Non-Cooperation Rules

| Timeout | Duration | Effect |
| ------- | -------- | ------ |
| **$T_{\text{evidence}}$** | 5 days | Both parties submit evidence. Late evidence is rejected (transaction reverts). After the deadline, either party or a `PLATFORM_ADMIN` can call `closeEvidencePhase()` to transition the dispute to `AwaitingJudge`. |
| **$T_{\text{keyDistribution}}$** | 2 days (after judge assignment) | Both parties must distribute $\text{Enc}(pk_{\text{judge}}, K_{job})$ to the judge. |
| **$T_{\text{ruling}}$** | 14 days (after both keys distributed, i.e., after dispute enters `UnderReview` phase) | Judge must submit ruling. If the judge fails to rule within $T_{\text{ruling}}$, **anyone** can call `claimRulingDefault()` to revoke the failed judge's `PLATFORM_JUDGE` role, reset key submission state (both parties must re-distribute keys to the new judge), clear the judge and ephemeral public key, and transition the dispute back to `AwaitingJudge` for reassignment. |

**Key non-cooperation handling via `claimKeyDefault()`:**

| Scenario | Consequence |
| -------- | ----------- |
| Client fails to submit key within $T_{\text{keyDistribution}}$ | Default ruling: `FreelancerWins` with `freelancerShareBps = 10000` (100% to freelancer). No deposit slash. |
| Freelancer fails to submit key within $T_{\text{keyDistribution}}$ | Default ruling: `ClientWins` with `freelancerShareBps = 0` (100% to client). Deposit slashed at 50% (`KEY_DEFAULT_SLASH_BPS = 5000`). |
| Both parties fail to submit keys | Default ruling: `Inconclusive` with `freelancerShareBps = 5000` (50/50 split). No deposit slash. |
| A party submits an incorrect key (judge decrypts **off-chain** but $\text{keccak256}(\text{salt} \| \text{result}) \neq \text{agreementHash}$, where the salt is extracted from the decrypted payload) | Treated as non-cooperation — same as failing to submit. Note: this verification is performed off-chain by the judge (on-chain verification would require exposing $K_{job}$ in plaintext, destroying privacy). The judge signals non-cooperation via the ruling. |

### 3.6 Privacy Model During Disputes

The privacy model from the full design is **fully preserved and extended**, with the judge replacing the jurors and additional layers for ephemeral key isolation, least-privilege access, ciphertext expiry, and an explicit metadata privacy boundary:

| Layer | Mechanism | Guarantee |
| ----- | --------- | --------- |
| **Layer 1** — Per-job symmetric key | $K_{job}$ generated at `postJob()`, all content AES-256 encrypted before IPFS upload | No plaintext on-chain or public IPFS |
| **Layer 2** — ECDH key exchange | Client sends $\text{Enc}(pk_{\text{freelancer}}, K_{job})$ at selection | Only client and freelancer can read job content |
| **Layer 3** — Ephemeral per-dispute key distribution | For each dispute, the judge generates a fresh ephemeral keypair $(pk_{\text{judge}}^{\text{eph}}, sk_{\text{judge}}^{\text{eph}})$. Both parties send $\text{Enc}(pk_{\text{judge}}^{\text{eph}}, K_{job})$. The ephemeral private key is deleted after the ruling is executed. | Judge gains access only after assignment via a dispute-scoped key. Compromising the judge's long-term identity key does not expose any historical dispute content. Each dispute has cryptographic isolation from all others. |
| **Tamper-proof verification** | $\text{agreementHash} = \text{keccak256}(\text{salt} \| \text{plaintext})$ on-chain; the random 256-bit salt is embedded inside the encrypted IPFS payload | Judge verifies decrypted content integrity. The salt prevents **confirmation attacks** — an adversary who suspects the agreement content cannot verify their guess by hashing candidate plaintexts against the on-chain hash, because the salt is unknown without $K_{job}$. |
| **Per-job isolation** | Each job has independent $K_{job}$ | Compromising one key reveals nothing about other jobs |
| **Layer 4** — Data availability | All CIDs registered on-chain via `DataAvailability.sol`; platform pinning node auto-pins on `CIDRegistered` event; retention enforced until job completion + dispute window expiry | Agreements, deliverables, and evidence are guaranteed to remain retrievable from IPFS throughout the entire job lifecycle and any subsequent dispute resolution period |
| **Layer 5** — Judge least-privilege access | Although $K_{job}$ can decrypt all milestones, the platform enforces **application-layer access scoping**: the judge's review interface only surfaces CIDs for the disputed milestone and its direct dependencies — not all milestones in the job. | Limits the practical exposure surface during disputes. Even if the judge possesses $K_{job}$, they are not presented with unrelated milestone content. |
| **Layer 6** — Ciphertext expiry policy | After a job reaches a terminal state (COMPLETED, CANCELLED, ABANDONED) and the full dispute window expires (21 days), the platform pinning node **unpins the ciphertext** from IPFS. While copies may persist on other IPFS nodes, the platform no longer guarantees availability. | Reduces the long-term exposure surface. Combined with per-job key isolation, even if $K_{job}$ is compromised years later, the ciphertext is no longer reliably retrievable from IPFS. |

> **Privacy scope & limitations:** This privacy model protects **payload confidentiality** (agreement content, deliverables, evidence) and **content integrity** (tamper-proof verification via on-chain hashes). It does **not** protect **metadata privacy**: on-chain observers can still analyze transaction relationships (who transacts with whom), milestone values, timing patterns, dispute frequency, and behavioral metrics. This is a known and accepted limitation of transparent-ledger architectures. Users who require relationship anonymity should consider additional off-chain measures (e.g., fresh addresses per job), though these are outside the scope of this design.

---

## 4. State Machine

```text
    ┌──────────┐
    │   OPEN   │  Client posts job + locks funds
    └────┬─────┘  (T_review chosen & stored on-chain)
         │
         │  Freelancers call applyForJob()
         │  (can see T_review before applying)
         ▼
    ┌──────────────────┐
    │   APPLICATIONS   │  Client reviews applicants
    │                  │  (also covers offer-pending:
    │                  │   freelancer != 0x0 means
    │                  │   an offer is outstanding)
    └─┬──────┬──────┬──┘
     │      │      │  Client calls selectFreelancer()
     │      │      │  → freelancer has T_stake to respond
  confirm  reject  timeout
  & stake  offer   (auto-reject)
     │      │      │
     ▼      └──┬───┘
    ┌──────────┐ │
    │  ACTIVE  │ └──▶ back to APPLICATIONS
    └────┬─────┘     (client can reselect)
         │  Freelancer calls submitMilestone()
         │  (any pending milestone, in any order)
         ▼
    ┌────────────┐
    │ IN_REVIEW  │  Client has T_review to respond
    └──┬────┬──┬─┘  (1d / 3d / 7d / 14d / 21d / 30d)
       │    │  │
  approve  dispute  timeout
       │    │  │
       ▼    │  ▼
  ┌────────┐│ ┌──────────────────────┐
  │APPROVED││ │ AUTO-APPROVED        │
  └───┬────┘│ │ (funds released)     │
      │     │ └──────────┬───────────┘
      │     ▼            │
      │ ┌──────────┐     │
      │ │ DISPUTED │     │  Funds frozen; review timer paused.
      │ └────┬─────┘     │  Automated release suspended until
      │      │ Platform  │  Platform signals manual resolution.
      │      │ judge     │
      │      │ ruling    │
      │      ▼           │
      │ ┌──────────┐     │
      │ │ RESOLVED │     │  Post-dispute terminal milestone state.
      │ └────┬─────┘     │  Funds distributed per ruling.
      │      │           │
      ▼      ▼           ▼
    ┌──────────────────────────┐
    │  Next Milestone          │
    │  or COMPLETED            │
    └──────────────────────────┘
```

**Job terminal states:**

- **COMPLETED** — All milestones have reached a terminal milestone status (`Approved`, `AutoApproved`, or `Resolved`). Freelancer deposit and client behavior bond (remaining after any dispute slashing) are refunded. Reputation is updated for both parties. Data retention expiry is set to 21 days post-completion.
- **CANCELLED** — Reached via mutual agreement (in ACTIVE state) or unilateral withdrawal (in OPEN/APPLICATIONS states). Fund disposition follows the state-dependent cancellation rules defined in §2.6: unilateral cancellation before freelancer commitment returns 100% of escrow; mutual cancellation after work begins returns only the remaining (undelivered) milestones' escrow, preserving already-released funds. Cancellation incurs a reputation penalty for the initiating party ($C \times 0.1$ in the scoring formula) except when cancelling from OPEN state with no applicants.
- **ABANDONED** — Freelancer misses deadline ($T_{\text{deadline}}$); deposit forfeited to the **platform treasury**, escrow returned to client.

**Milestone terminal statuses:**

- **Approved** — Client explicitly approved the deliverable.
- **AutoApproved** — Review timeout expired without client action.
- **Resolved** — Dispute ruling executed; funds distributed per the judge's ruling. This is distinct from Approved/AutoApproved to preserve an audit trail showing the milestone went through dispute resolution.

---

## 5. Economic Incentive Design

### 5.1 Deposits, Stakes & Bonds

| Parameter | Value | Purpose |
| --------- | ----- | ------- |
| **Client Escrow** | 100% of total job value (USDC) | Guarantees funds exist. Client cannot run away with work. |
| **Client Behavior Bond** | **Graduated by tier**: 7.5% (New), 5% (Bronze), 2.5% (Silver), 1% (Gold) of total job value | Deters frivolous disputes and dispute harassment. All tiers are required to post a bond, but the amount decreases with trust. Refunded if no disputes are lost. **Any bond slashing goes to the platform treasury**, eliminating incentives for the counterparty to provoke disputes for profit. |
| **Freelancer Deposit** | **Graduated by tier**: 7.5% (New), 5% (Bronze), 2.5% (Silver), 1% (Gold) of total job value (USDC) | Skin-in-the-game. Deters abandonment and garbage delivery. The deposit amount decreases with trust, mirroring the client behavior bond structure. Forfeited on abandonment. **Any deposit slashing goes to the platform treasury**. |
| **Dispute Fee** | Scaled: $\max(50\text{ USDC},\; 10\% \times V_{\text{milestone}})$ | Cost to initiate a dispute. Denominated in USDC to eliminate volatility risk — the fee's real value is deterministic regardless of crypto market conditions. The 10% rate makes the fee proportional to the value at stake, while the $50 minimum ensures even small disputes carry a meaningful cost. **Refunded to the initiating party if they win**; if the initiator loses, the fee goes to the **platform treasury** (never to the opposing party). For inconclusive rulings, the fee goes to the treasury. |

### 5.2 Fee Structure

| Fee | Rate | Notes |
| --- | ---- | ----- |
| **Protocol Fee** | 2% of released funds | 5–10× cheaper than Upwork/Fiverr. Collected by the protocol treasury. |
| **Dispute Fee** | Scaled: $\max(50\text{ USDC},\; 10\% \times V_{\text{milestone}})$ | Paid by the party raising the dispute in USDC. **Refunded to the initiator if they win**; if the initiator loses, sent to the **platform treasury** (never to the opposing party). For inconclusive rulings, sent to the treasury. The 10% rate scales with milestone value, while the $50 minimum ensures meaningful cost. Using USDC ensures fee predictability — no oracle dependency or ETH price exposure. |
| **Gas Costs** | Near-zero on L2 | Deployed on L2 (e.g., Base, Polygon PoS). |

### 5.3 Incentive Alignment Summary

The system is designed so that **honest behavior is the dominant strategy** for every participant:

**Clients are incentivized to approve valid work promptly because:**

- Stalling is useless: auto-approve timeout ($T_{\text{review}}$, which *they chose*) releases funds automatically.
- Filing a dishonest dispute costs the dispute fee, which they lose if the judge rules against them.
- Behavior bond penalty: clients who lose a dispute forfeit up to 3% of the milestone value from their behavior bond to the **platform treasury**. Since slashed funds go to the platform rather than the counterparty, neither side can profit by provoking disputes.
- Reputation damage from lost disputes is permanent and visible to future freelancers.
- Client-specific behavioral metrics (cancellation rate, auto-approve frequency, dispute initiation rate) are tracked on-chain.

**Freelancers are incentivized to deliver quality work because:**

- Their **graduated deposit** (7.5% New, 5% Bronze, 2.5% Silver, 1% Gold) is at stake — abandoning or delivering garbage means losing it.
- Milestones limit exposure: they receive payment incrementally.
- Good reputation (value-weighted, on-chain, soulbound) leads to more opportunities.
- They can see the client's chosen $T_{\text{review}}$ before accepting — no hidden stalling window.

**The platform judge is incentivized to rule fairly because:**

- Under the centralized model, we assume the platform has a reputational and business incentive to provide fair rulings (similar to how traditional escrow services operate).
- Ruling reasoning is hashed and recorded on-chain for transparency and auditability.
- If the platform consistently rules unfairly, users will leave — the platform's revenue (2% protocol fee) depends on user trust and volume.

### 5.4 When Is It Rational to Raise a Dispute?

A party should raise a dispute when the expected value is positive:

$$E[\text{dispute}] = P(\text{win}) \times V_{\text{milestone}} - (1 - P(\text{win})) \times (F_{\text{dispute}} + B_{\text{bond\_slash}}) > 0$$

where:

- $V_{\text{milestone}}$ = value of the disputed milestone
- $F_{\text{dispute}} = \max(50\text{ USDC},\; 10\% \times V_{\text{milestone}})$ — scales with milestone value, denominated in the same stablecoin as all payments. **Refunded to the initiator if they win**; otherwise sent to the platform treasury.
- $B_{\text{bond\_slash}}$ = behavior bond penalty (graduated by tier: 7.5% New, 5% Bronze, 2.5% Silver, 1% Gold — slashed to treasury)

The dispute fee is designed to **scale with the value at stake**: for a $500 milestone, the fee is $50 USDC (the floor); for a $1,000 milestone, the fee is $100 USDC (10%); for a $10,000 milestone, the fee is $1,000 USDC (10%). By denominating in USDC rather than ETH, the fee is **deterministic and volatility-immune** — participants know the exact dollar cost before filing, with no dependency on price oracles or ETH market conditions. The 10% rate with a $50 minimum ensures that disputes are always meaningful — the higher rate compared to protocol fees makes frivolous filings directly costly. If the initiator wins, they recover their fee; if they lose, the fee goes to the platform treasury rather than the opposing party — this prevents disputes from becoming a profit mechanism for the winner while still penalizing frivolous filings. Frivolous disputes are further deterred by the combination of the scaled fee, the behavior bond, and reputation damage.

### 5.5 Reputation System

**Freelancer scoring:**

$$\text{score}_{\text{freelancer}} = \sum_{i} \left( V_i \times m_i \right) \div \left(1 + L \times 0.3 + C \times 0.1 \right)$$

- $V_i$ = value of milestone $i$; $m_i$ = outcome multiplier (1.0 clean, 0.5 dispute win, 0.0 dispute loss); $L$ = disputes lost; $C$ = voluntary cancellations (via `requestCancellation()`). Note: `disputesLost` and `cancellations` are tracked as **separate counters** in `Reputation.sol`, and both contribute independently to the penalty divisor.

**Client scoring:**

$$\text{score}_{\text{client}} = \text{totalValueCompleted} \times \frac{\text{jobsCompleted}}{\text{jobsPosted}} \div \left(1 + L \times 0.3 + C \times 0.1 + A \times 0.05 \right)$$

- $L$ = disputes lost; $C$ = jobs cancelled after freelancer selected; $A$ = milestones auto-approved via timeout. The auto-approve rate for tier calculations is computed as `autoApproveCount / totalMilestoneCount`, where `totalMilestoneCount` is the cumulative milestone count across **all completed jobs** (not just the current job).

**Graduated trust tiers (on-chain, computed by `Reputation.sol`):**

| Tier | Freelancer Criteria | Client Criteria | Behavior Bond Rate | Freelancer Deposit Rate |
| ---- | ------------------- | --------------- | ------------------ | ----------------------- |
| New | 0 completed value | 0 completed value | 7.5% | 7.5% |
| Bronze | ≥ $1,000 completed value, completion ratio > 50% (based on `jobsCompleted / (jobsCompleted + disputesLost + cancellations)`) | ≥ $1,000 completed value, completion ratio > 50% (based on `jobsCompleted / jobsPosted`) | 5% | 5% |
| Silver | ≥ $10,000 completed value, completion ratio > 75% | ≥ $10,000 completed value, completion ratio > 75%, auto-approve rate < 20% (based on `autoApproveCount / totalMilestoneCount` across all completed jobs) | 2.5% | 2.5% |
| Gold | ≥ $50,000 completed value, completion ratio > 90% | ≥ $50,000 completed value, completion ratio > 90%, auto-approve rate < 10% | 1% | 1% |

**Note on freelancer completion ratio:** The freelancer tier calculation uses `jobsCompleted / (jobsCompleted + disputesLost + cancellations)` rather than a simple value threshold. This prevents low-quality freelancers from advancing tiers by volume alone — a freelancer who completes many jobs but also loses many disputes or frequently cancels will not reach higher tiers. Cancellations and disputes lost are tracked as separate counters (`cancellations` vs. `disputesLost`) in `Reputation.sol`.

---

## 6. Attack Analysis & Defenses

All defenses from the full design are preserved. The shift to centralized dispute resolution changes only how disputes are *adjudicated*, not the escrow or security mechanisms.

### 6.1 Attacks by Clients

| Attack | How It Works | Defense |
| ------ | ------------ | ------- |
| **Free Work Attack** | Client posts a job to extract free consulting, never intending to hire. | **Milestone structure**: no significant work is done before escrow is locked and freelancer stakes. During the application phase, freelancers only submit a proposal — no work is performed. |
| **Disappearing Client** | Client locks funds, freelancer submits work, client never reviews — hoping to stall. | **Auto-approve timeout ($T_{\text{review}}$)**. The client *chose* this timeout — they cannot claim it's unfair. On expiry, funds release automatically. |
| **Stalling via Long Timeout** | Client selects the maximum timeout (30 days) to delay payment as long as possible. | **Timeout is visible before applying.** Freelancers can see $T_{\text{review}}$ on-chain and refuse to apply if the timeout is unreasonably long for the job scope. The market self-regulates: clients who set excessively long timeouts attract fewer (or no) applicants. Additionally, the auto-approve rate contributes to the client's reputation score — frequent auto-approves hurt their tier. |
| **Unjustified Rejection** | Client rejects valid work to force a dispute. | Client pays the dispute fee. If the platform judge sides with the freelancer, the client loses the fee, suffers a reputation penalty, and part of their behavior bond is slashed to the **platform treasury**. |
| **Milestone Manipulation** | Client structures milestones to get the most valuable deliverable last, then cancels. | **Minimum milestone percentage (10%)**: no single milestone can be less than 10% of total contract value. Additionally, cancellation in ACTIVE state requires **mutual consent** (see §2.6) — the client cannot unilaterally cancel after the freelancer has committed. If the freelancer refuses to consent, the client must use the dispute path, which carries dispute fees, potential bond forfeiture, and reputation penalties. |
| **Dispute Harassment** | Low-reputation client repeatedly files frivolous disputes to stall payments. | **Graduated client behavior bond** (7.5% for New, 5% for Bronze, 2.5% for Silver, 1% for Gold): up to 3% of milestone value is slashed from the bond and sent to the **platform treasury** on each lost dispute. Since slashed funds go to the platform rather than the freelancer, the client cannot exploit the dispute process to extract concessions, and the freelancer has no incentive to provoke disputes for profit. Combined with the dispute fee, this makes harassment directly costly. |

### 6.2 Attacks by Freelancers

| Attack | How It Works | Defense |
| ------ | ------------ | ------- |
| **Abandonment** | Freelancer stakes deposit, locks client's funds, then never delivers. | **Freelancer deposit (graduated by tier: 7.5% New, 5% Bronze, 2.5% Silver, 1% Gold)** is forfeited to the **platform treasury** if no submission by $T_{\text{deadline}}$. Client calls `claimAbandonment()` → escrow returned to client. |
| **Low-Quality Delivery** | Freelancer delivers substandard work that technically "meets" requirements. | **Agreement hash on-chain**: `agreementHash = keccak256(scope, milestones, criteria)`. The judge evaluates work against this immutable specification. MetaEvidence frames the dispute as a structured question. |

### 6.3 Attacks on Dispute Resolution

| Attack | How It Works | Defense |
| ------ | ------------ | ------- |
| **Judge Bribery** | A party bribes the platform-assigned judge. | This is a **known trade-off** of the centralized model. We mitigate it by: (1) the platform's business-level incentive to maintain neutrality, (2) ruling reasoning hashed on-chain for auditability, (3) the platform can assign a *panel* of judges for high-value disputes to reduce single-point corruption, (4) **ephemeral per-dispute keypairs** ensure that a compromised judge cannot retroactively access other disputes' content. In a future version, this can be upgraded to decentralized arbitration. |
| **Platform Bias** | The platform systematically favors one side (e.g., always ruling for clients to attract more business). | On-chain ruling records are **publicly auditable**. Anyone can analyze the platform's ruling history for bias. If bias is detected, users will migrate to competing platforms — the 2% fee revenue depends on user trust. |
| **Evidence Tampering** | A party alters evidence after submission. | Evidence hashes and CIDs are recorded on-chain with block timestamps during $T_{\text{evidence}}$ via `DataAvailability.sol`. The salted `agreementHash = keccak256(salt ‖ plaintext)` anchor prevents altering the original agreement — and the embedded salt ensures that even knowledge of the agreement's structure cannot be used to forge a matching hash without possessing $K_{job}$. All evidence is encrypted and stored on IPFS — immutable once pinned, and the platform pinning node guarantees continued availability (see §6.4, IPFS Data Unavailability). |

### 6.4 Platform-Level Attacks

| Attack | Defense |
| ------ | ------- |
| **Smart Contract Exploits** (reentrancy, overflow) | OpenZeppelin's `ReentrancyGuard` on all fund-transferring functions. Solidity 0.8+ built-in overflow checks. `SafeERC20` for all token transfers. Pull-over-push payment pattern (withdrawable balances). OpenZeppelin `PausableUpgradeable` provides an emergency circuit-breaker — the admin can pause all state-mutating user-facing functions on `JobEscrow.sol`. All core contracts are deployed behind **UUPS proxies** for safe upgradeability, with upgrade authorization restricted to `DEFAULT_ADMIN_ROLE`. `AccessControlDefaultAdminRulesUpgradeable` enforces a time-delayed admin transfer process, preventing instantaneous takeover of admin privileges. |
| **State Race Conditions** (competing transactions on the same milestone in the same block) | **Per-milestone state mutex**: every state-mutating function checks and immediately updates `milestone.status` before any external calls (checks-effects-interactions). Competing transactions (e.g., `approveMilestone()` vs. `triggerAutoApprove()`, or `raiseDispute()` vs. `triggerAutoApprove()`) are serialized by the EVM — only the first to execute succeeds; the second reverts on the stale status check. When `raiseDispute()` wins the race, the milestone transitions to `DISPUTED`, **funds are frozen, and the auto-approve timer is paused** — no automated release can occur until the platform signals manual resolution via `executeRuling()`. All terminal operations are **idempotent** (guarded by a `processed` flag). `raiseDispute()` is only callable while `milestone.status == IN_REVIEW`, ensuring disputes cannot override already-approved milestones. See §2.5 for full rules. |
| **Cross-Contract State Inconsistency** (fund state updated but reputation not, or vice versa) | **Single authority model**: `JobEscrow.sol` is the sole custodian of fund and milestone state. `Dispute.sol` calls a restricted interface (`executeDisputeRuling()`) on `JobEscrow.sol` to apply rulings — it never holds or moves funds directly. Reputation updates are direct synchronous cross-contract function calls (e.g., `reputation.recordMilestoneCompletion()`, `reputation.recordClientDisputeLoss()`) triggered atomically within the same transaction — not event-based. If any sub-step fails, the entire transaction reverts — no partial state updates are possible. |
| **IPFS Data Unavailability** (agreements, deliverables, evidence lost due to unpinning / garbage collection) | **On-chain CID registry (`DataAvailability.sol`)**: every IPFS upload (agreement, deliverable, evidence) has its CID registered on-chain, emitting a `CIDRegistered(jobId, cid, contentType, uploader)` event. A **platform-operated IPFS pinning node** listens for these events and **auto-pins every registered CID immediately**. The platform node enforces a **retention policy**: content is kept pinned until the job reaches a terminal state (COMPLETED, CANCELLED, or ABANDONED) **plus** the full dispute window ($T_{\text{evidence}} + T_{\text{keyDistribution}} + T_{\text{ruling}}$ = 21 days after completion). **After the retention period expires, the platform unpins the ciphertext** to reduce long-term exposure — if $K_{job}$ is compromised years later, the ciphertext is no longer reliably retrievable. As a secondary fallback, the submitting party's frontend client also pins locally via its own IPFS node. On-chain CID records enable anyone to independently verify that content is still retrievable during the retention period, and the platform publishes periodic **pinning liveness proofs** (the platform node re-fetches each active CID and records a heartbeat timestamp on-chain or via a signed attestation) so that data availability is auditable rather than blindly trusted. |
| **Evidence Leakage** (unrelated parties reading task contents) | **Per-job symmetric encryption ($K_{job}$)**: all agreements, deliverables, and evidence are AES-256 encrypted before IPFS upload. Only the client, freelancer, and (during disputes) the assigned judge possess $K_{job}$. On-chain stores only ciphertext hashes. |
| **Key Non-Cooperation** (party refuses to share $K_{job}$ with judge) | **Timeout-based default ruling ($T_{\text{keyDistribution}}$ = 2 days)**: failure to distribute the key results in an automatic ruling against the non-cooperating party. Submitting an incorrect key is verifiable **off-chain** by the judge via `keccak256(salt ‖ decrypted) ≠ agreementHash`, where the salt is extracted from the decrypted payload — an incorrect key produces gibberish from which no valid salt can be recovered, failing the check deterministically. On-chain verification is not possible without exposing $K_{job}$ in plaintext; the judge signals non-cooperation through the ruling. |
| **Judge Key Leakage** (judge shares $K_{job}$ or ephemeral key with outsiders) | **Three-layer defense**: (1) **Per-job key isolation** — each job uses an independent $K_{job}$; leaking one key exposes only that job's content. (2) **Ephemeral per-dispute keypair** — the judge's decryption capability for each dispute is tied to a fresh keypair $(pk_{\text{judge}}^{\text{eph}}, sk_{\text{judge}}^{\text{eph}})$ that is generated per-dispute and **deleted after the ruling is executed**. Even if the judge's long-term identity key is compromised, no historical dispute content is exposed. (3) **Ciphertext expiry** — after the retention period, the platform unpins ciphertext from IPFS, so even a leaked $K_{job}$ has diminishing utility over time. The platform also has a business incentive to vet judges and enforce key-handling policies. |

### 6.5 Sybil Attacks & Reputation Gaming

All defenses from the full design are preserved:

| Defense Layer | Mechanism |
| ------------- | --------- |
| **Economic cost** | Self-trading costs ≥ 2% of face value in irrecoverable protocol fees. Farming $10,000 of reputation burns $200. |
| **Reputation formula** | Value-weighted (one $10,000 job = 100 × $100 jobs). Dispute-penalized ($L \times 0.3$ divisor). |
| **On-chain detection** | Address graph analysis, abnormal completion times, cyclic fund flows, same-pair patterns. |
| **Disposable account mitigation** | Zero reputation = untrusted by default. Reputation takes real time and money to build. Graduated trust tiers bound damage. |
| **Structural unprofitability** | Reputation does not grant fund access — escrow enforces custody. A high-reputation freelancer who delivers garbage loses the dispute and their deposit. A high-reputation client who refuses to pay has already locked funds in escrow. |
