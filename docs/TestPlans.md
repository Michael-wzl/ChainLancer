# ChainLancer — Manual Testing Plan

> **Course**: IS4302 — Blockchain & Distributed Ledger Technologies  
> **Date**: April 2026  
> **Scope**: End-to-end manual testing procedures for the ChainLancer dApp (frontend + smart contracts).

---

## Table of Contents

1. [Test Environment Setup](#1-test-environment-setup)
2. [Test Roles & Accounts](#2-test-roles--accounts)
3. [Test Scenario A — Happy Path (Full Job Lifecycle)](#3-test-scenario-a--happy-path-full-job-lifecycle)
4. [Test Scenario B — Multi-Applicant Competition](#4-test-scenario-b--multi-applicant-competition)
5. [Test Scenario C — Freelancer Rejection & Reselection](#5-test-scenario-c--freelancer-rejection--reselection)
6. [Test Scenario D — Offer Expiry (T_stake Timeout)](#6-test-scenario-d--offer-expiry-t_stake-timeout)
7. [Test Scenario E — Auto-Approve (T_review Timeout)](#7-test-scenario-e--auto-approve-t_review-timeout)
8. [Test Scenario F — Client Cancellation (Pre-Active)](#8-test-scenario-f--client-cancellation-pre-active)
9. [Test Scenario G — Mutual Cancellation (Active State)](#9-test-scenario-g--mutual-cancellation-active-state)
10. [Test Scenario H — Client Withdraws Expired Job](#10-test-scenario-h--client-withdraws-expired-job)
11. [Test Scenario I — Freelancer Abandonment](#11-test-scenario-i--freelancer-abandonment)
12. [Test Scenario J — Dispute Path (Client Raises, Freelancer Wins)](#12-test-scenario-j--dispute-path-client-raises-freelancer-wins)
13. [Test Scenario K — Dispute Path (Freelancer Raises, Client Wins)](#13-test-scenario-k--dispute-path-freelancer-raises-client-wins)
14. [Test Scenario L — Dispute Path (Inconclusive Ruling)](#14-test-scenario-l--dispute-path-inconclusive-ruling)
15. [Test Scenario M — Dispute Key Non-Cooperation Default](#15-test-scenario-m--dispute-key-non-cooperation-default)
16. [Test Scenario N — Dispute Ruling Timeout (Judge Default)](#16-test-scenario-n--dispute-ruling-timeout-judge-default)
17. [Test Scenario O — Admin & Role Management](#17-test-scenario-o--admin--role-management)
18. [Test Scenario P — Judge Workflow](#18-test-scenario-p--judge-workflow)
19. [Test Scenario Q — Reputation & Tier Progression](#19-test-scenario-q--reputation--tier-progression)
20. [Test Scenario R — Wallet & Withdrawal](#20-test-scenario-r--wallet--withdrawal)
21. [Test Scenario S — Access Control & Negative Tests](#21-test-scenario-s--access-control--negative-tests)
22. [Test Scenario T — Edge Cases & Boundary Conditions](#22-test-scenario-t--edge-cases--boundary-conditions)
23. [Test Scenario U — Frontend Navigation & UI](#23-test-scenario-u--frontend-navigation--ui)

---

## 1. Test Environment Setup

### 1.1 Prerequisites

| Item | Details |
|------|---------|
| **Node.js** | v18+ |
| **Package Manager** | npm or yarn |
| **Browser** | Chrome / Firefox with MetaMask extension |
| **Local Blockchain** | Hardhat local node (`npx hardhat node`) |
| **MetaMask Network** | Custom RPC — `http://127.0.0.1:8545`, Chain ID `31337` |
| **Test Accounts** | Import Hardhat accounts #0–#5 into MetaMask using private keys from `accounts.txt` |

### 1.2 Startup Procedure

| Step | Command / Action | Expected Result |
|------|-----------------|-----------------|
| 1 | `cd /path/to/ChainLancer && npx hardhat node` | Local blockchain running on port 8545 |
| 2 | `npx hardhat run scripts/deploy.ts --network localhost` | All contracts deployed; addresses printed to console |
| 3 | `npx hardhat run scripts/seed.ts --network localhost` | Job 0 (Active) and Job 1 (Open) created with test data |
| 4 | `cd frontend && npm run dev` | Frontend running at `http://localhost:5173` |
| 5 | Open browser → MetaMask → Add Hardhat network | Network added |
| 6 | Import test accounts (see §2) into MetaMask | Accounts available for switching |

### 1.3 Test Data Baseline (after seeding)

| Data | State |
|------|-------|
| **Job 0** — "Web App Development" | Active state; $10,000 total; 3 milestones ($2k / $3k / $5k); 7-day review timeout; Client = Account #1, Freelancer = Account #2 |
| **Job 1** — "Smart Contract Audit" | Open state; $10,000 total; 2 milestones ($5k / $5k); 14-day review timeout; Client = Account #1 |
| **USDC Balances** | Client and Freelancer1 each have 100,000 USDC (minus amounts locked in escrow/deposit) |

---

## 2. Test Roles & Accounts

| Role Label | Hardhat Account | Purpose |
|------------|----------------|---------|
| **Admin** | Account #0 (Deployer) | Platform admin; can assign judges, manage roles, pause contracts |
| **Client** | Account #1 | Posts jobs, approves milestones, raises disputes |
| **Freelancer 1** | Account #2 | Applies for jobs, submits milestones, stakes deposits |
| **Freelancer 2** | Account #3 | Secondary freelancer for multi-applicant tests |
| **Judge 1** | Account #4 | Platform-appointed judge for dispute resolution |
| **Random Person** | Account #5 | Unauthorized user; used for negative/access-control tests |

> **Note**: Switch MetaMask to the appropriate account before each step. The "Actor" column in each test procedure specifies which account to use.

---

## 3. Test Scenario A — Happy Path (Full Job Lifecycle)

**Objective**: Verify the complete job lifecycle from posting to completion with manual approvals and fund withdrawal.

**Precondition**: Use seeded Job 0 (Active state) or post a new job.

### Procedure A1 — Post a New Job (Fresh Start)

| Step | Actor | Page / Action | Input / Details | Expected Result |
|------|-------|---------------|-----------------|-----------------|
| A1.1 | Client | Navigate to `/post-job` | — | Post Job form is displayed |
| A1.2 | Client | Fill in job details | Title: "Logo Design"; Description: "Design a modern logo"; Review timeout: **3 days** | Form populated |
| A1.3 | Client | Add milestones | Milestone 1: "Draft concepts" — $500; Milestone 2: "Final deliverable" — $500 | Two milestones shown; total = $1,000 |
| A1.4 | Client | Submit the job | Click "Post Job" → MetaMask confirms USDC approval + `postJob()` | TX succeeds. Job appears on `/browse` in **Open** state. Client USDC balance decreases by $1,000 + behavior bond (7.5% for New = $75) |
| A1.5 | Client | Verify on Job Detail page | Navigate to `/job/<new_id>` | Job status = **Open**. Milestones, amounts, review timeout (3 days) all correct. Agreement CID displayed. |

### Procedure A2 — Freelancer Applies

| Step | Actor | Page / Action | Input / Details | Expected Result |
|------|-------|---------------|-----------------|-----------------|
| A2.1 | Freelancer 1 | Navigate to `/browse` | — | Job list is visible; the new job appears with status "Open" |
| A2.2 | Freelancer 1 | Click on the job | — | Job Detail page; review timeout = 3 days is visible |
| A2.3 | Freelancer 1 | Click "Apply" → redirected to `/apply/<id>` | Enter proposal text / upload proposal file | Application form displayed |
| A2.4 | Freelancer 1 | Submit application | Click "Submit Application" → MetaMask confirms `applyForJob()` | TX succeeds. Job status changes to **Applications**. Application count shows 1. |

### Procedure A3 — Client Selects Freelancer

| Step | Actor | Page / Action | Input / Details | Expected Result |
|------|-------|---------------|-----------------|-----------------|
| A3.1 | Client | Navigate to `/job/<id>` | — | Applications section shows Freelancer 1's application |
| A3.2 | Client | Click "Select" on Freelancer 1 | MetaMask confirms `selectFreelancer()` | TX succeeds. Job detail shows "Offer Pending" for Freelancer 1. T_stake (3-day) countdown begins. |

### Procedure A4 — Freelancer Confirms & Stakes

| Step | Actor | Page / Action | Input / Details | Expected Result |
|------|-------|---------------|-----------------|-----------------|
| A4.1 | Freelancer 1 | Navigate to `/job/<id>` | — | Job shows "You have been selected. Confirm & Stake to begin." |
| A4.2 | Freelancer 1 | Click "Confirm & Stake" | MetaMask confirms USDC approval + `confirmAndStake()` | TX succeeds. Job status = **Active**. Freelancer USDC balance decreases by 5% deposit ($50 for $1,000 job). |

### Procedure A5 — Submit & Approve Milestones

| Step | Actor | Page / Action | Input / Details | Expected Result |
|------|-------|---------------|-----------------|-----------------|
| A5.1 | Freelancer 1 | On `/job/<id>`, Milestone 1 section | Click "Submit Milestone"; upload deliverable file | Deliverable uploaded to IPFS; `submitMilestone()` TX confirms. Milestone 1 status = **In Review**. Review countdown (3 days) starts. |
| A5.2 | Client | On `/job/<id>`, Milestone 1 section | Review the deliverable (decrypt & view); Click "Approve" | `approveMilestone()` TX confirms. Milestone 1 status = **Approved**. |
| A5.3 | — | Check Wallet page (`/wallet`) as Freelancer 1 | — | Withdrawable balance increased by $500 − 2% fee = $490. |
| A5.4 | Freelancer 1 | Submit Milestone 2 | Same as A5.1 for Milestone 2 | Milestone 2 status = **In Review**. |
| A5.5 | Client | Approve Milestone 2 | Same as A5.2 | Milestone 2 status = **Approved**. Job status = **Completed**. |
| A5.6 | — | Verify final release | Check `/job/<id>` | Freelancer deposit refunded; Client behavior bond refunded. Reputation updated for both parties. |

### Procedure A6 — Withdraw Funds

| Step | Actor | Page / Action | Input / Details | Expected Result |
|------|-------|---------------|-----------------|-----------------|
| A6.1 | Freelancer 1 | Navigate to `/wallet` | — | Withdrawable balance = $980 (total milestone value minus 2% fees) |
| A6.2 | Freelancer 1 | Click "Withdraw" | MetaMask confirms `withdraw()` | TX succeeds. USDC balance increases. Withdrawable balance = 0. |

---

## 4. Test Scenario B — Multi-Applicant Competition

**Objective**: Verify that multiple freelancers can apply and the client can review and choose between them.

| Step | Actor | Page / Action | Input / Details | Expected Result |
|------|-------|---------------|-----------------|-----------------|
| B.1 | Client | Post a new job | Any valid job details | Job in **Open** state |
| B.2 | Freelancer 1 | Apply for the job | Submit proposal | Application count = 1 |
| B.3 | Freelancer 2 | Apply for the same job | Submit a different proposal | Application count = 2 |
| B.4 | Client | View applications on `/job/<id>` | — | Both applications visible with addresses, proposal hashes, reputation scores |
| B.5 | Client | Select Freelancer 2 | Click "Select" on Freelancer 2 | Freelancer 2 is the selected freelancer; offer pending |
| B.6 | Freelancer 1 | View job as Freelancer 1 | — | Freelancer 1 sees they were not selected; no action buttons available |
| B.7 | Freelancer 2 | Confirm & Stake | `confirmAndStake()` | Job becomes **Active** with Freelancer 2 |

---

## 5. Test Scenario C — Freelancer Rejection & Reselection

**Objective**: Verify `rejectOffer()` by the selected freelancer and the client's ability to reselect another applicant.

| Step | Actor | Page / Action | Input / Details | Expected Result |
|------|-------|---------------|-----------------|-----------------|
| C.1 | Client | Post a job | — | Job in **Open** state |
| C.2 | Freelancer 1 | Apply | — | Application count = 1 |
| C.3 | Freelancer 2 | Apply | — | Application count = 2 |
| C.4 | Client | Select Freelancer 1 | `selectFreelancer()` | Offer pending for Freelancer 1 |
| C.5 | Freelancer 1 | Reject the offer | Click "Reject Offer" → `rejectOffer()` | TX succeeds. Selection cleared immediately. No reputation penalty. |
| C.6 | Client | View job | — | Status returns to **Applications**; client can select again |
| C.7 | Client | Select Freelancer 2 | `selectFreelancer()` with Freelancer 2 | Offer pending for Freelancer 2 |
| C.8 | Freelancer 2 | Confirm & Stake | `confirmAndStake()` | Job becomes **Active** with Freelancer 2 |

---

## 6. Test Scenario D — Offer Expiry (T_stake Timeout)

**Objective**: Verify that an unresponsive freelancer's offer auto-expires after 3 days.

| Step | Actor | Page / Action | Input / Details | Expected Result |
|------|-------|---------------|-----------------|-----------------|
| D.1 | Client | Post a job and select Freelancer 1 | — | Offer pending; T_stake = 3 days |
| D.2 | — | Advance blockchain time by 3 days + 1 second | Use Hardhat: `evm_increaseTime` + `evm_mine` | Time passes T_stake |
| D.3 | Random Person | Call `expireOffer()` on job | Via console or UI (if available) | TX succeeds. Selection cleared. Job returns to **Applications** state. |
| D.4 | Freelancer 1 | Attempt `confirmAndStake()` | — | TX **reverts** — offer has expired |
| D.5 | Client | Select another freelancer (or same one again) | — | New offer can be issued |

---

## 7. Test Scenario E — Auto-Approve (T_review Timeout)

**Objective**: Verify that milestones are auto-approved when the client does not act within the review period.

| Step | Actor | Page / Action | Input / Details | Expected Result |
|------|-------|---------------|-----------------|-----------------|
| E.1 | — | Use a job in **Active** state (e.g., seeded Job 0) | — | Job is Active with Freelancer 1 |
| E.2 | Freelancer 1 | Submit Milestone 0 | `submitMilestone()` | Milestone 0 = **In Review**; review timer starts (7 days for Job 0) |
| E.3 | — | Advance time by 7 days + 1 second | `evm_increaseTime` + `evm_mine` | Time exceeds T_review |
| E.4 | Random Person | Call `triggerAutoApprove(jobId, 0)` | — | TX succeeds. Milestone 0 status = **Auto-Approved**. Funds released to freelancer's withdrawable balance. |
| E.5 | Client | Attempt `approveMilestone(jobId, 0)` | — | TX **reverts** — milestone already auto-approved |
| E.6 | — | Verify reputation | Check Client's profile | `autoApproveCount` incremented by 1 |

---

## 8. Test Scenario F — Client Cancellation (Pre-Active)

**Objective**: Verify `cancelJob()` in OPEN and APPLICATIONS states.

### Procedure F1 — Cancel in OPEN State (No Applicants)

| Step | Actor | Page / Action | Input / Details | Expected Result |
|------|-------|---------------|-----------------|-----------------|
| F1.1 | Client | Post a new job ($2,000) | — | Job in **Open** state; USDC locked |
| F1.2 | Client | Click "Cancel Job" on `/job/<id>` | MetaMask confirms `cancelJob()` | TX succeeds. Job status = **Cancelled**. 100% escrow + full behavior bond returned. No reputation impact. |
| F1.3 | Client | Check USDC balance on `/wallet` | — | Full amount returned |

### Procedure F2 — Cancel in APPLICATIONS State (Freelancers Applied, None Selected)

| Step | Actor | Page / Action | Input / Details | Expected Result |
|------|-------|---------------|-----------------|-----------------|
| F2.1 | Client | Post a new job | — | Job = **Open** |
| F2.2 | Freelancer 1 | Apply | — | Job = **Applications** |
| F2.3 | Client | Cancel the job | `cancelJob()` | TX succeeds. 100% escrow + bond returned. No reputation impact. |

### Procedure F3 — Cancel After Selecting Freelancer (Awaiting Stake)

| Step | Actor | Page / Action | Input / Details | Expected Result |
|------|-------|---------------|-----------------|-----------------|
| F3.1 | Client | Post job → Freelancer applies → Client selects | — | Offer pending |
| F3.2 | Client | Cancel the job | `cancelJob()` | TX succeeds. 100% escrow + bond returned. **Client incurs minor cancellation penalty** (C × 0.1 in reputation). Freelancer reputation unaffected. |

---

## 9. Test Scenario G — Mutual Cancellation (Active State)

**Objective**: Verify mutual cancellation via `requestCancellation()` + `acceptCancellation()` in Active state.

### Procedure G1 — Client Initiates, Freelancer Accepts

| Step | Actor | Page / Action | Input / Details | Expected Result |
|------|-------|---------------|-----------------|-----------------|
| G1.1 | — | Ensure a job is in **Active** state | Use seeded Job 0 or create new | Job Active; no milestones submitted |
| G1.2 | Client | Click "Request Cancellation" | `requestCancellation()` | TX succeeds. Cancellation request active. UI shows pending cancellation. |
| G1.3 | Freelancer 1 | View job detail | — | UI shows "Client has requested cancellation. Accept or continue working." |
| G1.4 | Freelancer 1 | Click "Accept Cancellation" | `acceptCancellation()` | TX succeeds. Job status = **Cancelled**. Remaining escrow returned to Client. Freelancer deposit refunded in full. Client incurs reputation penalty (C × 0.1). |

### Procedure G2 — Freelancer Initiates, Client Accepts

| Step | Actor | Page / Action | Input / Details | Expected Result |
|------|-------|---------------|-----------------|-----------------|
| G2.1 | — | Job in Active state | — | — |
| G2.2 | Freelancer 1 | Request cancellation | `requestCancellation()` | TX succeeds |
| G2.3 | Client | Accept cancellation | `acceptCancellation()` | TX succeeds. Job cancelled. Freelancer incurs minor reputation penalty. |

### Procedure G3 — Partial Completion Cancellation

| Step | Actor | Page / Action | Input / Details | Expected Result |
|------|-------|---------------|-----------------|-----------------|
| G3.1 | — | Job Active with 3 milestones; Milestone 0 already approved & paid | — | Freelancer already received $2,000 − fee |
| G3.2 | Client | Request cancellation | `requestCancellation()` | — |
| G3.3 | Freelancer 1 | Accept cancellation | `acceptCancellation()` | Job cancelled. Only remaining milestones' escrow ($8,000) returned to Client. Previously released $2,000 stays with Freelancer. Deposit refunded. |

### Procedure G4 — Unilateral Cancellation Blocked

| Step | Actor | Page / Action | Input / Details | Expected Result |
|------|-------|---------------|-----------------|-----------------|
| G4.1 | — | Job in Active state | — | — |
| G4.2 | Client | Attempt `cancelJob()` on Active job | — | TX **reverts** — unilateral cancellation not allowed in Active state |
| G4.3 | Client | Request cancellation; Freelancer does NOT accept | — | Cancellation remains pending. Job stays Active. Client cannot force cancellation. |

---

## 10. Test Scenario H — Client Withdraws Expired Job

**Objective**: Verify `withdrawExpiredJob()` after T_acceptance (14 days) with no freelancer confirmed.

| Step | Actor | Page / Action | Input / Details | Expected Result |
|------|-------|---------------|-----------------|-----------------|
| H.1 | Client | Post a new job | — | Job = **Open** |
| H.2 | — | Advance time by 14 days + 1 second | `evm_increaseTime` | Past T_acceptance |
| H.3 | Client | Call `withdrawExpiredJob()` | — | TX succeeds. Job status → Cancelled. Full escrow + bond returned. No reputation impact. |
| H.4 | Freelancer 1 | Attempt to apply | `applyForJob()` | TX **reverts** — job is cancelled |

---

## 11. Test Scenario I — Freelancer Abandonment

**Objective**: Verify `claimAbandonment()` when freelancer misses a milestone deadline.

| Step | Actor | Page / Action | Input / Details | Expected Result |
|------|-------|---------------|-----------------|-----------------|
| I.1 | — | Job in Active state with milestone deadline set | — | Milestone 0 has a deadline |
| I.2 | — | Advance time past the milestone deadline | `evm_increaseTime` | Deadline exceeded; freelancer has not submitted |
| I.3 | Client | Call `claimAbandonment(jobId, milestoneIdx)` | — | TX succeeds. Job status = **Abandoned**. Freelancer's 5% deposit forfeited to platform treasury. All remaining escrow returned to Client. |
| I.4 | Freelancer 1 | Attempt `submitMilestone()` | — | TX **reverts** — job is abandoned |
| I.5 | — | Check reputation | — | Freelancer reputation impacted; Client reputation unaffected |

---

## 12. Test Scenario J — Dispute Path (Client Raises, Freelancer Wins)

**Objective**: Full dispute resolution flow where the client disputes a milestone but the judge rules in favor of the freelancer.

| Step | Actor | Page / Action | Input / Details | Expected Result |
|------|-------|---------------|-----------------|-----------------|
| **Setup** | | | | |
| J.1 | — | Job Active; Freelancer submits Milestone 0 | `submitMilestone()` | Milestone = **In Review** |
| **Dispute Initiation** | | | | |
| J.2 | Client | Click "Raise Dispute" on Milestone 0 | MetaMask confirms `raiseDispute()` | TX succeeds. Dispute fee deducted from Client (max(10, min(1% × $2,000, 1000)) = $20). Milestone → **Disputed**. Funds frozen. Auto-approve timer paused. |
| J.3 | — | Navigate to `/dispute/<jobId>/0` | — | Dispute detail page shows: Phase = **Evidence**; 5-day evidence window; parties & amounts |
| **Evidence Phase** | | | | |
| J.4 | Client | Submit evidence | Upload evidence file; `submitEvidence()` | Evidence CID registered on-chain. Evidence appears in list. |
| J.5 | Freelancer 1 | Submit evidence | Upload counter-evidence; `submitEvidence()` | Second evidence entry visible. |
| J.6 | — | Advance time by 5 days | `evm_increaseTime` | Evidence window closes |
| J.7 | Client or Admin | Close evidence phase | `closeEvidencePhase()` | Phase → **AwaitingJudge** |
| **Judge Assignment** | | | | |
| J.8 | Admin | Navigate to `/admin` | — | Admin panel visible |
| J.9 | Admin | Assign Judge 1 to dispute | Provide judge address + ephemeral public key; `assignJudge()` | Phase → **KeyDistribution**. T_keyDistribution = 2 days starts. |
| **Key Distribution** | | | | |
| J.10 | Client | Distribute key to judge | `distributeKeyToJudge()` with encrypted K_job | Client key submitted ✓ |
| J.11 | Freelancer 1 | Distribute key to judge | `distributeKeyToJudge()` with encrypted K_job | Freelancer key submitted ✓. Phase → **UnderReview**. |
| **Judge Review & Ruling** | | | | |
| J.12 | Judge 1 | Navigate to `/judge` | — | Dispute queue shows this dispute |
| J.13 | Judge 1 | Review evidence, agreement, deliverable | Decrypt content using ephemeral key | All content accessible |
| J.14 | Judge 1 | Submit ruling | Ruling = **FreelancerWins (1)**; reasoning hash; freelancerShareBps = 10000 (100%); depositSlashBps = 0 | `submitRuling()` TX succeeds. Phase → **Ruled**. |
| **Ruling Execution** | | | | |
| J.15 | Client or Freelancer 1 or Admin | Execute ruling | `executeRuling()` | Phase → **Executed**. Milestone funds released to Freelancer (minus 2% fee). Client loses dispute fee. Up to 3% of milestone value slashed from Client's behavior bond → treasury. |
| **Verification** | | | | |
| J.16 | — | Check Freelancer's wallet | `/wallet` as Freelancer 1 | Withdrawable balance includes milestone value − fee |
| J.17 | — | Check Client's reputation | `/profile` as Client | Dispute lost count +1; reputation score decreased |
| J.18 | — | Check Freelancer's reputation | `/profile` as Freelancer 1 | Milestone credited at 0.5× multiplier (dispute win) |

---

## 13. Test Scenario K — Dispute Path (Freelancer Raises, Client Wins)

**Objective**: Freelancer raises dispute; judge rules in favor of client.

| Step | Actor | Page / Action | Input / Details | Expected Result |
|------|-------|---------------|-----------------|-----------------|
| K.1 | — | Job Active; Freelancer submits milestone; milestone = In Review | — | — |
| K.2 | Freelancer 1 | Raise dispute | `raiseDispute()` | Dispute fee deducted from Freelancer. Milestone → Disputed. |
| K.3–K.11 | Various | Evidence phase → Judge assignment → Key distribution | Same as J.4–J.11 | Dispute progresses through phases |
| K.12 | Judge 1 | Submit ruling | Ruling = **ClientWins (2)**; freelancerShareBps = 0; depositSlashBps = 5000 (50% of proportional deposit) | Phase → Ruled |
| K.13 | — | Execute ruling | `executeRuling()` | Milestone funds returned to Client. Freelancer's dispute fee NOT refunded. Client's dispute fee refunded. Up to 50% of freelancer's proportional deposit slashed → treasury. |
| K.14 | — | Check Freelancer's reputation | — | Dispute lost penalty (L × 0.3). Score decreased. |
| K.15 | — | Check Client's reputation | — | No penalty. |

---

## 14. Test Scenario L — Dispute Path (Inconclusive Ruling)

**Objective**: Judge rules inconclusive; funds split proportionally.

| Step | Actor | Page / Action | Input / Details | Expected Result |
|------|-------|---------------|-----------------|-----------------|
| L.1–L.11 | — | Same setup through key distribution | — | — |
| L.12 | Judge 1 | Submit ruling | Ruling = **Inconclusive (0)**; freelancerShareBps = 5000 (50%); depositSlashBps = 0 | Phase → Ruled |
| L.13 | — | Execute ruling | `executeRuling()` | Funds split 50/50 between Client and Freelancer. Neither dispute fee refunded. Both deposits untouched. No reputation penalty for either. |

---

## 15. Test Scenario M — Dispute Key Non-Cooperation Default

**Objective**: Verify default rulings when parties fail to distribute keys to the judge.

### Procedure M1 — Client Fails to Submit Key

| Step | Actor | Page / Action | Input / Details | Expected Result |
|------|-------|---------------|-----------------|-----------------|
| M1.1 | — | Dispute created; judge assigned; phase = KeyDistribution | — | T_keyDistribution = 2 days |
| M1.2 | Freelancer 1 | Distribute key | `distributeKeyToJudge()` | Freelancer key submitted ✓ |
| M1.3 | Client | Does NOT submit key | — | — |
| M1.4 | — | Advance time past 2-day deadline | `evm_increaseTime` | Key deadline expired |
| M1.5 | Anyone | Call `claimKeyDefault(disputeId)` | — | TX succeeds. Default ruling = **FreelancerWins**. Milestone funds → Freelancer. Client penalized. |

### Procedure M2 — Freelancer Fails to Submit Key

| Step | Actor | Page / Action | Input / Details | Expected Result |
|------|-------|---------------|-----------------|-----------------|
| M2.1–M2.4 | — | Same as above but Freelancer does not submit | — | — |
| M2.5 | Anyone | `claimKeyDefault(disputeId)` | — | Default ruling = **ClientWins**. Funds → Client. Freelancer penalized (50% deposit slash). |

### Procedure M3 — Both Parties Fail to Submit Keys

| Step | Actor | Page / Action | Input / Details | Expected Result |
|------|-------|---------------|-----------------|-----------------|
| M3.1 | — | Neither party submits key within 2 days | — | — |
| M3.2 | Anyone | `claimKeyDefault(disputeId)` | — | Ruling = **Inconclusive (0)**. Funds split proportionally. |

---

## 16. Test Scenario N — Dispute Ruling Timeout (Judge Default)

**Objective**: Verify `claimRulingDefault()` when the judge fails to rule within T_ruling (14 days).

| Step | Actor | Page / Action | Input / Details | Expected Result |
|------|-------|---------------|-----------------|-----------------|
| N.1 | — | Dispute phase = UnderReview (both keys submitted) | — | T_ruling = 14 days |
| N.2 | Judge 1 | Does NOT submit ruling | — | — |
| N.3 | — | Advance time past 14-day ruling deadline | `evm_increaseTime` | Deadline exceeded |
| N.4 | Anyone | Call `claimRulingDefault(disputeId)` | — | TX succeeds. Default ruling applied (Inconclusive or platform-defined default). Platform must reassign judge if needed. |

---

## 17. Test Scenario O — Admin & Role Management

**Objective**: Verify admin functions: role assignment, judge management, pause/unpause.

### Procedure O1 — Assign Judge Role

| Step | Actor | Page / Action | Input / Details | Expected Result |
|------|-------|---------------|-----------------|-----------------|
| O1.1 | Admin | Navigate to `/admin` | — | Admin panel visible with role management section |
| O1.2 | Admin | Grant PLATFORM_JUDGE role to Account #4 | Via RoleManager component | TX succeeds. Account #4 can now be assigned as judge. |

### Procedure O2 — Assign Judge to a Dispute

| Step | Actor | Page / Action | Input / Details | Expected Result |
|------|-------|---------------|-----------------|-----------------|
| O2.1 | Admin | Open dispute in admin panel | Select active dispute | Dispute details shown |
| O2.2 | Admin | Assign judge | Provide Judge 1 address + ephemeral public key | `assignJudge()` TX succeeds. |

### Procedure O3 — Pause & Unpause Contracts

| Step | Actor | Page / Action | Input / Details | Expected Result |
|------|-------|---------------|-----------------|-----------------|
| O3.1 | Admin | Pause JobEscrow | `pause()` | TX succeeds. Contract paused. |
| O3.2 | Client | Attempt `postJob()` | — | TX **reverts** — contract is paused |
| O3.3 | Freelancer 1 | Attempt `submitMilestone()` | — | TX **reverts** — contract is paused |
| O3.4 | Admin | Unpause JobEscrow | `unpause()` | TX succeeds. Operations resume. |
| O3.5 | Client | `postJob()` works again | — | TX succeeds |

### Procedure O4 — Non-Admin Cannot Manage Roles

| Step | Actor | Page / Action | Input / Details | Expected Result |
|------|-------|---------------|-----------------|-----------------|
| O4.1 | Random Person | Navigate to `/admin` | — | Admin panel may be visible but actions should fail |
| O4.2 | Random Person | Attempt to grant a role | — | TX **reverts** — access denied |
| O4.3 | Random Person | Attempt `pause()` | — | TX **reverts** — not admin |

---

## 18. Test Scenario P — Judge Workflow

**Objective**: Verify the complete judge experience from dispute queue to ruling submission.

| Step | Actor | Page / Action | Input / Details | Expected Result |
|------|-------|---------------|-----------------|-----------------|
| P.1 | Admin | Assign Judge 1 to a dispute | `assignJudge()` | Judge assigned |
| P.2 | Judge 1 | Navigate to `/judge` | — | Dispute Queue shows assigned dispute(s) |
| P.3 | Judge 1 | Click on dispute | — | Dispute Review Panel opens with: dispute details, evidence list, key distribution status |
| P.4 | Judge 1 | Wait for key distribution | Both parties submit keys | Status shows both keys received |
| P.5 | Judge 1 | Decrypt evidence | Use Evidence Decryptor component | Agreement, deliverable, and evidence files decrypted and viewable |
| P.6 | Judge 1 | Fill Ruling Form | Select ruling outcome; enter reasoning; set freelancerShareBps and depositSlashBps | Form populated |
| P.7 | Judge 1 | Submit ruling | `submitRuling()` | TX succeeds. Phase → **Ruled** |
| P.8 | Judge 1 | Execute ruling | `executeRuling()` | Phase → **Executed**. Funds redistributed. |

### Procedure P2 — Judge Cannot Rule on Unassigned Dispute

| Step | Actor | Page / Action | Input / Details | Expected Result |
|------|-------|---------------|-----------------|-----------------|
| P2.1 | Random Person | Attempt `submitRuling()` on dispute | — | TX **reverts** — not the assigned judge |
| P2.2 | Judge 1 | Attempt `submitRuling()` on a different dispute they're not assigned to | — | TX **reverts** |

---

## 19. Test Scenario Q — Reputation & Tier Progression

**Objective**: Verify reputation scoring, tier upgrades, and behavior bond adjustments.

### Procedure Q1 — Check Reputation After Job Completion

| Step | Actor | Page / Action | Input / Details | Expected Result |
|------|-------|---------------|-----------------|-----------------|
| Q1.1 | — | Complete a full job (Happy Path A) | — | Job completed |
| Q1.2 | Freelancer 1 | Navigate to `/profile` | — | `totalValueCompleted` increased. `jobsCompleted` +1. Reputation score updated per formula. |
| Q1.3 | Client | Navigate to `/profile` | — | `totalValueCompleted` increased. `jobsCompleted` +1. `jobsPosted` +1. Score updated. |

### Procedure Q2 — Tier Upgrade Check

| Step | Actor | Page / Action | Input / Details | Expected Result |
|------|-------|---------------|-----------------|-----------------|
| Q2.1 | — | Freelancer 1 completes enough jobs to exceed $1,000 totalValueCompleted | Multiple job completions | — |
| Q2.2 | — | Check `getFreelancerTier(freelancer1)` | — | Returns **Bronze** (if >$1,000 and >50% completion rate) |
| Q2.3 | — | Client completes enough jobs to exceed $1,000 with >50% completion ratio | — | Client tier = **Bronze**; behavior bond drops from 7.5% to 5% |

### Procedure Q3 — Reputation Impact from Dispute Loss

| Step | Actor | Page / Action | Input / Details | Expected Result |
|------|-------|---------------|-----------------|-----------------|
| Q3.1 | — | Client loses a dispute | Scenario J | — |
| Q3.2 | Client | Check reputation | `/profile` | `disputesLost` +1. Score decreased by L × 0.3 factor. |

### Procedure Q4 — Reputation Impact from Cancellation

| Step | Actor | Page / Action | Input / Details | Expected Result |
|------|-------|---------------|-----------------|-----------------|
| Q4.1 | — | Client cancels job after selecting freelancer | Scenario F3 | — |
| Q4.2 | Client | Check reputation | `/profile` | `jobsCancelledAfterSelection` +1. Score decreased by C × 0.1 factor. |

### Procedure Q5 — Auto-Approve Impact on Client Reputation

| Step | Actor | Page / Action | Input / Details | Expected Result |
|------|-------|---------------|-----------------|-----------------|
| Q5.1 | — | Milestone auto-approved | Scenario E | — |
| Q5.2 | Client | Check reputation | `/profile` | `autoApproveCount` +1. Impacts tier eligibility (Silver requires <20%, Gold requires <10%). |

---

## 20. Test Scenario R — Wallet & Withdrawal

**Objective**: Verify the wallet page, USDC balances, and the pull-payment withdrawal mechanism.

| Step | Actor | Page / Action | Input / Details | Expected Result |
|------|-------|---------------|-----------------|-----------------|
| R.1 | Freelancer 1 | Navigate to `/wallet` | — | Page shows: wallet address, USDC balance, withdrawable balance (from completed milestones) |
| R.2 | Freelancer 1 | Verify withdrawable amount | After milestone approval | Amount = milestone value − 2% protocol fee |
| R.3 | Freelancer 1 | Withdraw | Click "Withdraw" → `withdraw()` | Withdrawable balance → 0. USDC wallet balance increases. |
| R.4 | Freelancer 1 | Withdraw again | Click "Withdraw" | TX may succeed but no-op (0 to withdraw). Idempotent. |
| R.5 | Client | Check wallet after refunds | After job completion or cancellation | Behavior bond and/or deposit refunds appear as withdrawable |
| R.6 | Client | Withdraw refunds | `withdraw()` | Funds received |

### Procedure R2 — Faucet (Testnet Only)

| Step | Actor | Page / Action | Input / Details | Expected Result |
|------|-------|---------------|-----------------|-----------------|
| R2.1 | Any account | Find Faucet Panel on wallet page | — | FaucetPanel component visible (testnet only) |
| R2.2 | Any account | Request test USDC | Click faucet button; `mint()` on MockUSDC | USDC balance increases |

---

## 21. Test Scenario S — Access Control & Negative Tests

**Objective**: Verify that unauthorized actors cannot perform restricted actions.

### S1 — Job Function Access Control

| Step | Actor | Attempted Action | Expected Result |
|------|-------|-----------------|-----------------|
| S1.1 | Freelancer 1 | `postJob()` | ✅ Should succeed — anyone can post a job |
| S1.2 | Random Person | `selectFreelancer()` on someone else's job | ❌ TX reverts — not the client |
| S1.3 | Client | `confirmAndStake()` on own job | ❌ TX reverts — client is not the selected freelancer |
| S1.4 | Random Person | `approveMilestone()` on any job | ❌ TX reverts — not the client |
| S1.5 | Client | `submitMilestone()` on own job | ❌ TX reverts — not the freelancer |
| S1.6 | Freelancer 2 | `submitMilestone()` on a job where Freelancer 1 is assigned | ❌ TX reverts — not the assigned freelancer |
| S1.7 | Random Person | `cancelJob()` on someone's job | ❌ TX reverts — not the client |
| S1.8 | Random Person | `requestCancellation()` on an active job | ❌ TX reverts — not client or freelancer of this job |

### S2 — Dispute Function Access Control

| Step | Actor | Attempted Action | Expected Result |
|------|-------|-----------------|-----------------|
| S2.1 | Random Person | `raiseDispute()` on a milestone they're not involved in | ❌ TX reverts — not client or freelancer |
| S2.2 | Random Person | `submitEvidence()` on a dispute they're not party to | ❌ TX reverts |
| S2.3 | Random Person | `assignJudge()` | ❌ TX reverts — not PLATFORM_ADMIN |
| S2.4 | Random Person | `submitRuling()` | ❌ TX reverts — not the assigned judge |
| S2.5 | Random Person | `distributeKeyToJudge()` on dispute they're not party to | ❌ TX reverts |

### S3 — State Precondition Checks

| Step | Actor | Attempted Action | Expected Result |
|------|-------|-----------------|-----------------|
| S3.1 | Client | `approveMilestone()` on milestone that is not In Review | ❌ TX reverts — wrong state |
| S3.2 | Anyone | `triggerAutoApprove()` before review timeout expires | ❌ TX reverts — too early |
| S3.3 | Client | `raiseDispute()` on an Approved milestone | ❌ TX reverts — milestone is terminal |
| S3.4 | Freelancer 1 | `submitMilestone()` on milestone already In Review | ❌ TX reverts — already submitted |
| S3.5 | Client | `cancelJob()` on an Active job | ❌ TX reverts — must use mutual cancellation |
| S3.6 | Anyone | `withdrawExpiredJob()` before T_acceptance expires | ❌ TX reverts — too early |
| S3.7 | Client | `claimAbandonment()` before milestone deadline | ❌ TX reverts — deadline not passed |
| S3.8 | Freelancer 1 | Apply to own posted job (if freelancer is also client) | Depends on implementation; may or may not revert |

### S4 — Double-Action / Idempotency

| Step | Actor | Attempted Action | Expected Result |
|------|-------|-----------------|-----------------|
| S4.1 | Client | `approveMilestone()` twice on same milestone | Second call reverts (status already changed) |
| S4.2 | Client | `raiseDispute()` twice on same milestone | Second call reverts |
| S4.3 | Freelancer 1 | Apply twice to same job | Should revert (duplicate application) |
| S4.4 | Anyone | `executeRuling()` twice on same dispute | Second call is no-op or reverts |
| S4.5 | Freelancer 1 | `withdraw()` when balance is 0 | Should succeed as no-op or revert gracefully |

---

## 22. Test Scenario T — Edge Cases & Boundary Conditions

**Objective**: Test boundary conditions, concurrent operations, and edge-case behaviors.

### T1 — Review Timeout Boundary

| Step | Actor | Action | Expected Result |
|------|-------|--------|-----------------|
| T1.1 | — | Submit milestone; advance time to **exactly** T_review (not past) | `triggerAutoApprove()` should **revert** (uses strict `>`, not `>=`) |
| T1.2 | — | Advance time by 1 more second | `triggerAutoApprove()` should **succeed** |

### T2 — Minimum Milestone Validation

| Step | Actor | Action | Expected Result |
|------|-------|--------|-----------------|
| T2.1 | Client | Post job with a milestone < 10% of total value | `postJob()` **reverts** — minimum milestone percentage violated |
| T2.2 | Client | Post job with all milestones ≥ 10% | `postJob()` succeeds |

### T3 — Invalid Review Timeout

| Step | Actor | Action | Expected Result |
|------|-------|--------|-----------------|
| T3.1 | Client | Post job with review timeout = 2 days (not in allowed set) | `postJob()` **reverts** — invalid timeout |
| T3.2 | Client | Post job with review timeout = 7 days | `postJob()` succeeds |

### T4 — Dispute Fee Calculation

| Step | Actor | Action | Expected Result |
|------|-------|--------|-----------------|
| T4.1 | — | Milestone value = $500 → fee = max(10, min(5, 1000)) | Dispute fee = **$10** (floor applies) |
| T4.2 | — | Milestone value = $5,000 → fee = max(10, min(50, 1000)) | Dispute fee = **$50** |
| T4.3 | — | Milestone value = $200,000 → fee = max(10, min(2000, 1000)) | Dispute fee = **$1,000** (cap applies) |

### T5 — Behavior Bond Graduation

| Step | Actor | Action | Expected Result |
|------|-------|--------|-----------------|
| T5.1 | New Client (no history) | Post $10,000 job | Bond = 7.5% = $750 locked |
| T5.2 | Bronze Client | Post $10,000 job | Bond = 5% = $500 locked |
| T5.3 | Silver Client | Post $10,000 job | Bond = 2.5% = $250 locked |
| T5.4 | Gold Client | Post $10,000 job | Bond = 1% = $100 locked |

### T6 — Registration of Encryption Key

| Step | Actor | Action | Expected Result |
|------|-------|--------|-----------------|
| T6.1 | Freelancer 1 | `registerEncryptionKey(pubKey)` with valid 33-byte compressed public key | TX succeeds; key stored on-chain |
| T6.2 | Freelancer 1 | `registerEncryptionKey()` with invalid key length | TX reverts |

### T7 — Evidence Submission After Deadline

| Step | Actor | Action | Expected Result |
|------|-------|--------|-----------------|
| T7.1 | — | Dispute in Evidence phase; advance time past 5-day window | Evidence deadline passed |
| T7.2 | Client | `submitEvidence()` | TX **reverts** — evidence window closed |

### T8 — Dispute During Auto-Approve Race

| Step | Actor | Action | Expected Result |
|------|-------|--------|-----------------|
| T8.1 | — | Milestone In Review; time is close to T_review expiry | — |
| T8.2 | Client | `raiseDispute()` **before** T_review expires | Milestone → Disputed. Auto-approve timer paused. |
| T8.3 | Random Person | `triggerAutoApprove()` after dispute raised | TX **reverts** — milestone is no longer In Review |

### T9 — Zero-Value Edge Cases

| Step | Actor | Action | Expected Result |
|------|-------|--------|-----------------|
| T9.1 | Client | Post job with $0 total value | TX should **revert** |
| T9.2 | Client | Post job with 0 milestones | TX should **revert** |

---

## 23. Test Scenario U — Frontend Navigation & UI

**Objective**: Verify that all pages render correctly, navigation works, and UI states reflect contract state.

### U1 — Page Accessibility

| Step | Page | Expected Result |
|------|------|-----------------|
| U1.1 | `/` (Dashboard) | Dashboard loads with job summary, recent activity |
| U1.2 | `/browse` | Job listing with filters; jobs sorted by recency |
| U1.3 | `/post-job` | Post Job form with all required fields |
| U1.4 | `/job/:id` | Job detail with milestones, status, actions |
| U1.5 | `/apply/:id` | Application form (only visible if job is in Open/Applications) |
| U1.6 | `/dispute/:jobId/:milestoneIdx` | Dispute detail with phase indicators, evidence list |
| U1.7 | `/judge` | Judge panel with dispute queue |
| U1.8 | `/admin` | Admin panel with role management, stats |
| U1.9 | `/profile` | Profile page with reputation score, tier badge |
| U1.10 | `/wallet` | Wallet page with balance display, withdraw button |

### U2 — Wallet Connection

| Step | Action | Expected Result |
|------|--------|-----------------|
| U2.1 | Open app without MetaMask connected | Connect button visible; most actions disabled |
| U2.2 | Click "Connect Wallet" | MetaMask popup; user approves; address shown in Navbar |
| U2.3 | Switch MetaMask account | UI updates to reflect new account's role/data |
| U2.4 | Switch to wrong network | Network badge shows warning; prompt to switch to correct network |

### U3 — Role-Based UI Visibility

| Step | Actor | Page | Expected Result |
|------|-------|------|-----------------|
| U3.1 | Client | `/job/:id` (own job, In Review milestone) | "Approve" and "Raise Dispute" buttons visible |
| U3.2 | Freelancer 1 | `/job/:id` (assigned job, Active) | "Submit Milestone" button visible for pending milestones |
| U3.3 | Random Person | `/job/:id` | No action buttons; view-only |
| U3.4 | Admin | `/admin` | Full admin controls visible |
| U3.5 | Non-Admin | `/admin` | Access denied or no functional controls |
| U3.6 | Judge 1 | `/judge` | Assigned disputes visible in queue |
| U3.7 | Non-Judge | `/judge` | Empty queue or access denied |

### U4 — Status Badge & Countdown Timer

| Step | Action | Expected Result |
|------|--------|-----------------|
| U4.1 | View job in Open state | StatusBadge shows "Open" (appropriate color) |
| U4.2 | View milestone In Review | StatusBadge shows "In Review"; CountdownTimer shows remaining review time |
| U4.3 | View dispute in Evidence phase | StatusBadge shows "Evidence"; CountdownTimer shows remaining evidence time |
| U4.4 | Timer reaches 0 | UI updates to indicate timeout; relevant action buttons appear (e.g., "Trigger Auto-Approve") |

### U5 — Transaction Feedback

| Step | Action | Expected Result |
|------|--------|-----------------|
| U5.1 | Submit any transaction | Loading indicator appears while TX is pending |
| U5.2 | TX succeeds | Success notification/toast displayed; page data refreshes |
| U5.3 | TX reverts | Error notification with reason displayed |
| U5.4 | User rejects MetaMask prompt | "Transaction rejected" message; no state change |

---

## Appendix A — Time Advancement (for Testers)

Since many test scenarios require advancing blockchain time, use the following commands in a separate terminal connected to the Hardhat node:

```bash
# Advance time by N seconds (e.g., 3 days = 259200 seconds)
npx hardhat console --network localhost
> await network.provider.send("evm_increaseTime", [259200])
> await network.provider.send("evm_mine")

# Common time values:
# 1 day   = 86400
# 2 days  = 172800
# 3 days  = 259200
# 5 days  = 432000
# 7 days  = 604800
# 14 days = 1209600
# 21 days = 1814400
# 30 days = 2592000
```

After advancing time, **refresh the frontend page** to update countdown timers and state.

---

## Appendix B — Test Result Tracking Template

| Scenario | Steps Passed | Steps Failed | Bugs Found | Tester | Date |
|----------|-------------|-------------|------------|--------|------|
| A — Happy Path | | | | | |
| B — Multi-Applicant | | | | | |
| C — Rejection & Reselection | | | | | |
| D — Offer Expiry | | | | | |
| E — Auto-Approve | | | | | |
| F — Client Cancellation | | | | | |
| G — Mutual Cancellation | | | | | |
| H — Withdraw Expired Job | | | | | |
| I — Abandonment | | | | | |
| J — Dispute (Freelancer Wins) | | | | | |
| K — Dispute (Client Wins) | | | | | |
| L — Dispute (Inconclusive) | | | | | |
| M — Key Non-Cooperation | | | | | |
| N — Ruling Timeout | | | | | |
| O — Admin & Roles | | | | | |
| P — Judge Workflow | | | | | |
| Q — Reputation & Tiers | | | | | |
| R — Wallet & Withdrawal | | | | | |
| S — Access Control | | | | | |
| T — Edge Cases | | | | | |
| U — Frontend & UI | | | | | |

---

## Appendix C — Contract Address Reference

After deployment, fill in the addresses below for reference during testing:

| Contract | Address |
|----------|---------|
| MockUSDC | `0x...` |
| DataAvailability | `0x...` |
| Reputation | `0x...` |
| Dispute | `0x...` |
| JobEscrow | `0x...` |
| Protocol Treasury | `0x...` |
