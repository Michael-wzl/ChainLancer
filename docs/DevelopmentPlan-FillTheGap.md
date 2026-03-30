# Development Plan — Filling the Gap: Judge Dashboard, Admin Dashboard & Lit Protocol Integration
 
> **Purpose**: Implementation guide for the remaining frontend features, with a parallel work-split designed to minimize inter-developer communication and merge conflicts.  
> **Prerequisites**: Read `docs/DeveloperGuide.md` in its entirety before starting. It documents the current codebase architecture, APIs, hooks, components, and the full gap analysis.  
> **Scope**: This document covers **how** to implement the remaining work identified in `DeveloperGuide.md` §16.

---

## Table of Contents

1. [Executive Summary — What Remains](#1-executive-summary--what-remains)
2. [Work Split Strategy](#2-work-split-strategy)
3. [Shared Interfaces & Contracts Between Developers](#3-shared-interfaces--contracts-between-developers)
4. [Developer A — Judge Dashboard & Dispute System](#4-developer-a--judge-dashboard--dispute-system)
5. [Developer B — Admin Dashboard & Platform Infrastructure](#5-developer-b--admin-dashboard--platform-infrastructure)
6. [Lit Protocol Integration (Joint Task — Phased)](#6-lit-protocol-integration-joint-task--phased)
7. [Integration Checklist](#7-integration-checklist)
8. [Testing Strategy](#8-testing-strategy)

---

## 1. Executive Summary — What Remains

The first version of the dApp covers the **Client** and **Freelancer** workflows end-to-end. The following areas are incomplete:

| Area | Current State | Target State |
|------|--------------|--------------|
| **Judge Dashboard** | No page, no components, no hook | Full page with dispute queue, evidence decryptor, ruling form |
| **Admin Dashboard** | No page, no components, no hook, no PlatformRoles integration | Full page with role management, judge assignment, platform stats |
| **`useDispute` Hook** | Dispute operations scattered across `useJobEscrow` and inline in `DisputeDetail.tsx` | Dedicated hook encapsulating all Dispute contract interactions |
| **`useAdmin` Hook** | Nonexistent | Hook for role management, judge assignment, platform statistics |
| **PlatformRoles ABI + Contract Instance** | ABI not copied, address not configured, not instantiated in `ContractContext` | Fully integrated |
| **Lit Protocol Crypto** | Uses MetaMask `personal_sign` + HKDF (see `src/crypto/keyExchange.ts`) | Threshold ECIES via `@lit-protocol/lit-node-client` |
| **Navbar Role Gating** | 5 static links | Conditional Judge/Admin links based on on-chain role check |
| **Route Registration** | 8 routes | +2 routes (`/judge`, `/admin`) |
| **`KeyDistributionPanel` Component** | Key distribution logic is inline in `DisputeDetail.tsx` | Extracted as a reusable component under `components/dispute/` |

---

## 2. Work Split Strategy

### 2.1 Assignment Overview

| Developer | Focus Area | Touches |
|-----------|-----------|---------|
| **Dev A** | **Judge System** — `useDispute` hook, Judge Dashboard page, 4 judge components, `KeyDistributionPanel`, dispute-side enhancements to `DisputeDetail` | `hooks/useDispute.ts`, `pages/JudgeDashboard.tsx`, `components/judge/*`, `components/dispute/KeyDistributionPanel.tsx`, updates to `pages/DisputeDetail.tsx` |
| **Dev B** | **Admin System + Infrastructure** — `useAdmin` hook, Admin Dashboard page, 4 admin components, PlatformRoles integration (ABI + ContractContext + config), Navbar role gating, route registration, Lit Protocol `litProtocol.ts` wrapper | `hooks/useAdmin.ts`, `pages/AdminDashboard.tsx`, `components/admin/*`, `contexts/ContractContext.tsx`, `config/contracts.ts`, `abis/PlatformRoles.json`, `layout/Navbar.tsx`, `App.tsx`, `crypto/litProtocol.ts` |

### 2.2 Why This Split Works

- **Zero shared files** for new code creation: Dev A creates files under `judge/`, `dispute/`, and `hooks/useDispute.ts`; Dev B creates files under `admin/`, `hooks/useAdmin.ts`, and `crypto/litProtocol.ts`. No overlapping new files.
- **Minimal shared-file edits**: Only 3 existing files require changes from both:
  - `App.tsx` — each developer adds one route. Dev B adds both routes in a single batch (see §3.2).
  - `ContractContext.tsx` — Dev B adds PlatformRoles (single addition). Dev A does not touch this file.
  - `layout/Navbar.tsx` — Dev B adds both conditional links (see §3.2). Dev A does not touch this file.
- **Independent contract surfaces**: Dev A interacts only with `Dispute` contract; Dev B interacts only with `PlatformRoles` (via AccessControl). Both use the existing `JobEscrow` read functions through `readContracts` but do not modify the existing hooks.
- **Lit Protocol handoff**: Dev B implements the `litProtocol.ts` wrapper (infrastructure-level). Dev A consumes it via the existing `keyExchange.ts` API. See §6 for phased integration.

### 2.3 Merge Order

1. **Dev B merges first** — infrastructure (PlatformRoles integration, routes, Navbar, Lit Protocol wrapper).
2. **Dev A merges second** — Judge Dashboard and dispute enhancements (which depend on Dev B's PlatformRoles role checks and Lit Protocol wrapper).

If Dev A needs to test before Dev B's merge, Dev A should use stub implementations (documented in §3.3).

---

## 3. Shared Interfaces & Contracts Between Developers

To enable parallel development with zero-communication merges, the following interfaces are agreed upon **in advance**.

### 3.1 `useAdmin` Hook API (Dev B implements, Dev A may consume for role checks)

```typescript
// src/hooks/useAdmin.ts — Dev B implements this

export interface UseAdminReturn {
  // Write operations
  grantRole: (contractName: ContractName, role: string, account: string) => Promise<void>;
  revokeRole: (contractName: ContractName, role: string, account: string) => Promise<void>;
  assignJudge: (disputeId: number, judgeAddress: string, ephemeralPubKey: string) => Promise<void>;
  
  // Read operations
  hasRole: (contractName: ContractName, role: string, account: string) => Promise<boolean>;
  
  // Loading state
  loading: boolean;
}

type ContractName = 'jobEscrow' | 'dispute' | 'reputation' | 'dataAvailability' | 'platformRoles';
```

**Dev A note**: If you need a role check before Dev B's hook is ready, use the stub in §3.3.

### 3.2 Route & Navbar Contract (Dev B owns these files)

Dev B will add the following to `App.tsx`:

```tsx
// New routes added by Dev B
<Route path="/judge" element={<JudgeDashboard />} />
<Route path="/admin" element={<AdminDashboard />} />
```

Dev B will add conditional links to `Navbar.tsx`:

```tsx
// Conditional links added by Dev B
{isJudge && <NavLink to="/judge">Judge Dashboard</NavLink>}
{isAdmin && <NavLink to="/admin">Admin Dashboard</NavLink>}
```

**Dev A**: Export your `JudgeDashboard` component from `pages/JudgeDashboard.tsx` as the default export. Dev B will import it.

### 3.3 Stub Implementations for Parallel Development

**Dev A can use these stubs** before Dev B's code is available:

```typescript
// Stub: role check (replace with useAdmin.hasRole when available)
async function hasRole(readContracts: any, role: string, address: string): Promise<boolean> {
  try {
    // Any contract inheriting AccessControl exposes hasRole
    return await readContracts.dispute.hasRole(role, address);
  } catch {
    return false;
  }
}
```

```typescript
// Stub: Lit Protocol (replace with litProtocol.ts when available)
// Dev A can continue using the existing keyExchange.ts (personal_sign) 
// until Dev B delivers litProtocol.ts. The API surface is identical:
// encryptForRecipient(keyHex, recipientAddress) → { ciphertext, dataToEncryptHash }
// decryptWithPrivateKey(ciphertext, dataToEncryptHash, recipientAddress) → keyHex
```

### 3.4 `useDispute` Hook API (Dev A implements, Dev B may reference for judge assignment flow)

```typescript
// src/hooks/useDispute.ts — Dev A implements this

export interface UseDisputeReturn {
  // Write operations
  submitEvidence: (disputeId: number, evidenceCID: string) => Promise<void>;
  closeEvidencePhase: (disputeId: number) => Promise<void>;
  distributeKeyToJudge: (disputeId: number, encryptedJobKey: Uint8Array) => Promise<void>;
  claimKeyDefault: (disputeId: number) => Promise<void>;
  submitRuling: (disputeId: number, ruling: number, reasoningHash: string, freelancerShareBps: number, depositSlashBps: number) => Promise<void>;
  executeRuling: (disputeId: number) => Promise<void>;

  // Read operations
  fetchDisputeDetails: (disputeId: number) => Promise<DisputeDetails>;
  fetchEvidence: (disputeId: number) => Promise<EvidenceItem[]>;
  fetchEncryptedKey: (disputeId: number, party: string) => Promise<string>;
  fetchDisputeDeadlines: (disputeId: number) => Promise<DisputeDeadlines>;
  fetchJudgeDisputes: (judgeAddress: string) => Promise<number[]>;

  // Loading state
  loading: boolean;
}

export interface DisputeDetails {
  jobId: number;
  milestoneIdx: number;
  initiator: string;
  client: string;
  freelancer: string;
  milestoneValue: bigint;
  judge: string;
  phase: number;    // DisputePhase enum
  ruling: number;   // Ruling enum
}

export interface EvidenceItem {
  submitter: string;
  evidenceHash: string;
  evidenceCID: string;
  submittedAt: number;
}

export interface DisputeDeadlines {
  evidenceDeadline: number;
  keyDistributionDeadline: number;
  rulingDeadline: number;
}
```

### 3.5 ContractContext Extension (Dev B owns)

Dev B will extend `ContractContext` to include PlatformRoles:

```typescript
// Added to ContractContextType by Dev B
interface ContractContextType {
  contracts: {
    // ... existing 5 contracts ...
    platformRoles: Contract | null;      // NEW
  } | null;
  readContracts: {
    // ... existing 5 contracts ...
    platformRoles: Contract | null;      // NEW
  } | null;
}
```

Dev A should access role checks via `readContracts.dispute.hasRole(...)` or `readContracts.platformRoles.hasRole(...)` — both work because all contracts inherit `AccessControl`.

### 3.6 Lit Protocol API Contract (Dev B implements `litProtocol.ts`, Dev A consumes via `keyExchange.ts`)

After Dev B delivers `crypto/litProtocol.ts`, Dev A will update `crypto/keyExchange.ts` to call it instead of the current `personal_sign` + HKDF approach. The **external API** of `keyExchange.ts` remains identical:

```typescript
// src/crypto/keyExchange.ts — API stays the same, internals change

// Before (current — personal_sign):
export async function encryptForRecipient(jobKeyBytes: Uint8Array, recipientAddress: string, signer: Signer): Promise<Uint8Array>
export async function decryptWithPrivateKey(encryptedPackage: Uint8Array, senderAddress: string, signer: Signer): Promise<Uint8Array>

// After (Lit Protocol — Dev B provides litProtocol.ts):
// Same function signatures, but internally call:
//   litProtocol.encryptJobKeyForRecipient(jobKeyBytes, recipientAddress)
//   litProtocol.decryptJobKeyAsRecipient(ciphertext, dataToEncryptHash, recipientAddress)
```

This means **no page-level code changes are needed** when swapping crypto backends. Only `keyExchange.ts` internals change.

---

## 4. Developer A — Judge Dashboard & Dispute System

### 4.1 Task Breakdown

| # | Task | New/Modified File(s) | Priority |
|---|------|---------------------|----------|
| A1 | Create `useDispute` hook | `src/hooks/useDispute.ts` | **High — do this first** |
| A2 | Create `JudgeDashboard` page | `src/pages/JudgeDashboard.tsx` | High |
| A3 | Create `DisputeQueue` component | `src/components/judge/DisputeQueue.tsx` | High |
| A4 | Create `EvidenceDecryptor` component | `src/components/judge/EvidenceDecryptor.tsx` | High |
| A5 | Create `RulingForm` component | `src/components/judge/RulingForm.tsx` | High |
| A6 | Create `DisputeReviewPanel` component | `src/components/judge/DisputeReviewPanel.tsx` | High |
| A7 | Create `KeyDistributionPanel` component | `src/components/dispute/KeyDistributionPanel.tsx` | Medium |
| A8 | Enhance `DisputeDetail` page | Modify `src/pages/DisputeDetail.tsx` | Medium |
| A9 | Write tests for `useDispute` hook | `src/__tests__/hooks/useDispute.test.ts` | Medium |
| A10 | Write tests for judge components | `src/__tests__/integration/judgeFlow.test.ts` | Low |

### 4.2 Task A1 — `useDispute` Hook

**File**: `src/hooks/useDispute.ts`

This hook encapsulates **all** Dispute contract interactions. Currently, `raiseDispute` lives in `useJobEscrow` (keep it there — it calls `Dispute.createDispute` via JobEscrow), and `submitEvidence` + `distributeKeyToJudge` are inline in `DisputeDetail.tsx`. Centralise the rest here.

**Implementation guidance**:

```typescript
import { useContracts } from '@/contexts/ContractContext';
import { useWallet } from '@/contexts/WalletContext';
import { parseContractError } from '@/utils/errors';
import toast from 'react-hot-toast';

export function useDispute() {
  const { contracts, readContracts } = useContracts();
  const { account } = useWallet();
  const [loading, setLoading] = useState(false);

  // Internal execute wrapper — same pattern as useJobEscrow
  const execute = async (label: string, fn: () => Promise<any>) => {
    setLoading(true);
    try {
      const tx = await fn();
      toast.loading(`${label}: waiting for confirmation...`);
      await tx.wait();
      toast.success(`${label} confirmed!`);
    } catch (e) {
      toast.error(parseContractError(e));
      throw e;
    } finally {
      setLoading(false);
    }
  };

  // --- Write operations ---

  const submitEvidence = async (disputeId: number, evidenceCID: string) => {
    // Compute evidenceHash from the CID content (keccak256 of raw encrypted bytes)
    // Call contracts.dispute.submitEvidence(disputeId, evidenceHash, evidenceCID)
  };

  const closeEvidencePhase = async (disputeId: number) => {
    await execute('Close Evidence Phase', () =>
      contracts!.dispute.closeEvidencePhase(disputeId)
    );
  };

  const distributeKeyToJudge = async (disputeId: number, encryptedJobKey: Uint8Array) => {
    await execute('Distribute Key', () =>
      contracts!.dispute.distributeKeyToJudge(disputeId, encryptedJobKey)
    );
  };

  const claimKeyDefault = async (disputeId: number) => {
    await execute('Claim Key Default', () =>
      contracts!.dispute.claimKeyDefault(disputeId)
    );
  };

  const submitRuling = async (
    disputeId: number,
    ruling: number,
    reasoningHash: string,
    freelancerShareBps: number,
    depositSlashBps: number
  ) => {
    await execute('Submit Ruling', () =>
      contracts!.dispute.submitRuling(disputeId, ruling, reasoningHash, freelancerShareBps, depositSlashBps)
    );
  };

  const executeRuling = async (disputeId: number) => {
    await execute('Execute Ruling', () =>
      contracts!.dispute.executeRuling(disputeId)
    );
  };

  // --- Read operations ---

  const fetchDisputeDetails = async (disputeId: number): Promise<DisputeDetails> => {
    const rc = readContracts!.dispute;
    const [jobId, milestoneIdx, initiator, client, freelancer, milestoneValue, judge, phase, ruling] =
      await rc.getDisputeDetails(disputeId);
    return {
      jobId: Number(jobId),
      milestoneIdx: Number(milestoneIdx),
      initiator, client, freelancer,
      milestoneValue,
      judge,
      phase: Number(phase),
      ruling: Number(ruling),
    };
  };

  const fetchEvidence = async (disputeId: number): Promise<EvidenceItem[]> => {
    const rc = readContracts!.dispute;
    const count = await rc.getEvidenceCount(disputeId);
    const items: EvidenceItem[] = [];
    for (let i = 0; i < Number(count); i++) {
      const [submitter, evidenceHash, evidenceCID, submittedAt] = await rc.getEvidence(disputeId, i);
      items.push({ submitter, evidenceHash, evidenceCID, submittedAt: Number(submittedAt) });
    }
    return items;
  };

  const fetchEncryptedKey = async (disputeId: number, party: string): Promise<string> => {
    const data = await readContracts!.dispute.getEncryptedKey(disputeId, party);
    return data; // raw bytes
  };

  const fetchDisputeDeadlines = async (disputeId: number): Promise<DisputeDeadlines> => {
    const [evidenceDeadline, keyDistributionDeadline, rulingDeadline] =
      await readContracts!.dispute.getDisputeDeadlines(disputeId);
    return {
      evidenceDeadline: Number(evidenceDeadline),
      keyDistributionDeadline: Number(keyDistributionDeadline),
      rulingDeadline: Number(rulingDeadline),
    };
  };

  /**
   * Fetch all dispute IDs assigned to a judge.
   * Strategy: Query JudgeAssigned events filtered by judge address.
   */
  const fetchJudgeDisputes = async (judgeAddress: string): Promise<number[]> => {
    const filter = readContracts!.dispute.filters.JudgeAssigned(null, judgeAddress);
    const events = await readContracts!.dispute.queryFilter(filter);
    return events.map(e => Number(e.args?.[0])); // disputeId is first arg
  };

  return {
    submitEvidence, closeEvidencePhase, distributeKeyToJudge,
    claimKeyDefault, submitRuling, executeRuling,
    fetchDisputeDetails, fetchEvidence, fetchEncryptedKey,
    fetchDisputeDeadlines, fetchJudgeDisputes,
    loading,
  };
}
```

**Key decisions**:
- `fetchJudgeDisputes` uses **event filtering** (`JudgeAssigned` events where `judge == address`). This is the only way to enumerate judge assignments without a subgraph.
- The `Dispute` contract ABI (`src/abis/Dispute.json`) already exists and includes all the required functions. Verify it includes `getDisputeDetails`, `getDisputeDeadlines`, `getEncryptedKey`, `submitRuling`, `executeRuling`, `closeEvidencePhase`, `claimKeyDefault`. If not, re-run `npm run copy-abis` after recompiling contracts.

### 4.3 Task A2 — `JudgeDashboard` Page

**File**: `src/pages/JudgeDashboard.tsx`

**Role Gate**: On mount, check if the connected address has `PLATFORM_JUDGE` role. Use:
```typescript
const isJudge = await readContracts.dispute.hasRole(ROLE_HASHES.PLATFORM_JUDGE, account);
```
If `false`, render an "Access Denied — You are not a registered judge" message with a link to the Dashboard.

**Layout** (all-in-one page with expandable detail pane):

```
┌──────────────────────────────────────────────────────────────┐
│  ⚖️ Judge Dashboard                                          │
├──────────────────────────────────────────────────────────────┤
│  <DisputeQueue                                               │
│    disputes={judgeDisputes}                                  │
│    onSelect={(disputeId) => setSelectedDispute(disputeId)}   │
│  />                                                          │
│                                                              │
│  {selectedDispute && (                                       │
│    <DisputeReviewPanel                                       │
│      disputeId={selectedDispute}                             │
│    />                                                        │
│  )}                                                          │
└──────────────────────────────────────────────────────────────┘
```

**State management**:
```typescript
const [judgeDisputes, setJudgeDisputes] = useState<DisputeDetails[]>([]);
const [selectedDisputeId, setSelectedDisputeId] = useState<number | null>(null);
```

**Data loading flow**:
1. Call `useDispute().fetchJudgeDisputes(account)` → get `disputeId[]`.
2. For each `disputeId`, call `fetchDisputeDetails(id)` + `fetchDisputeDeadlines(id)`.
3. Pass combined data to `<DisputeQueue>`.
4. On dispute selection, pass `disputeId` to `<DisputeReviewPanel>`.

### 4.4 Task A3 — `DisputeQueue` Component

**File**: `src/components/judge/DisputeQueue.tsx`

**Props**:
```typescript
interface DisputeQueueProps {
  disputes: Array<DisputeDetails & { deadlines: DisputeDeadlines }>;
  selectedId: number | null;
  onSelect: (disputeId: number) => void;
}
```

**Rendering**:
- List of dispute cards, each showing:
  - `Dispute #N` — `Job #X Milestone Y`
  - Phase badge (use existing `<StatusBadge>` component with dispute phase labels from `constants.ts`)
  - Client and freelancer addresses (truncated via `truncateAddress`)
  - Relevant deadline countdown (use `<CountdownTimer>`)
  - "View Details" button → calls `onSelect(disputeId)`
- Filter tabs: `All` | `Key Distribution` | `Under Review` | `Ruled` (client-side filter by `phase`)
- Highlight the currently selected dispute

### 4.5 Task A4 — `EvidenceDecryptor` Component

**File**: `src/components/judge/EvidenceDecryptor.tsx`

This is the judge-specific component that retrieves encrypted evidence from IPFS, decrypts it using the job key, and displays the plaintext.

**Props**:
```typescript
interface EvidenceDecryptorProps {
  evidenceItems: EvidenceItem[];
  jobKey: CryptoKey | null;       // null until judge decrypts the job key
  onDecrypted?: () => void;       // callback after successful decryption
}
```

**Behaviour**:
1. If `jobKey` is `null`, show a disabled state: "Decrypt the job key first to view evidence."
2. If `jobKey` is available:
   - For each `EvidenceItem`, fetch from IPFS using `retrieveBinaryFromIPFS(evidenceCID)`.
   - Decrypt using `decryptText(jobKey, encryptedData)` from `crypto/aes.ts`.
   - Display the decrypted text in a card with submitter address and timestamp.
3. Handle errors gracefully — some evidence may be files rather than text. Use `decryptFile` for binary and offer a download link.

### 4.6 Task A5 — `RulingForm` Component

**File**: `src/components/judge/RulingForm.tsx`

**Props**:
```typescript
interface RulingFormProps {
  disputeId: number;
  disputeDetails: DisputeDetails;
  phase: number;
  onRulingSubmitted: () => void;    // refresh callback
}
```

**Form fields**:

| Field | Type | Validation | Maps to Contract Param |
|-------|------|------------|----------------------|
| Ruling Outcome | `<select>` dropdown: Freelancer Wins (2), Client Wins (1), Inconclusive (0) | Required | `ruling` |
| Freelancer Share | `<input type="number">` (0-10000 BPS) | If FreelancerWins: >5000; if ClientWins: <5000 | `freelancerShareBps` |
| Deposit Slash | `<input type="number">` (0-5000 BPS) | Max 50% (5000 BPS) | `depositSlashBps` |
| Reasoning | `<textarea>` | Required, min 50 chars | Hashed on-chain as `reasoningHash` |

**Submit flow**:
```
1. Validate all inputs (BPS validation per contract rules)
2. Compute reasoningHash = keccak256(toUtf8Bytes(reasoningText))
3. (Optionally) Upload reasoning text to IPFS as plaintext for transparency
4. Call useDispute().submitRuling(disputeId, ruling, reasoningHash, freelancerShareBps, depositSlashBps)
5. On success, show toast + call onRulingSubmitted()
```

**Auto-fill helpers** (improve UX):
- When "Freelancer Wins" is selected, auto-set `freelancerShareBps = 10000` and `depositSlashBps = 0`.
- When "Client Wins" is selected, auto-set `freelancerShareBps = 0` and `depositSlashBps = 2500`.
- When "Inconclusive" is selected, auto-set `freelancerShareBps = 5000` and `depositSlashBps = 0`.
- All auto-filled values are editable by the judge.

**Post-ruling**: After `submitRuling` succeeds, show an "Execute Ruling" button that calls `useDispute().executeRuling(disputeId)`. This is a separate transaction because anyone can execute a ruled dispute, but the judge UI provides convenience.

### 4.7 Task A6 — `DisputeReviewPanel` Component

**File**: `src/components/judge/DisputeReviewPanel.tsx`

This is the **composite panel** that combines everything the judge needs to review a dispute.

**Props**:
```typescript
interface DisputeReviewPanelProps {
  disputeId: number;
}
```

**Internal state**:
```typescript
const [disputeDetails, setDisputeDetails] = useState<DisputeDetails | null>(null);
const [deadlines, setDeadlines] = useState<DisputeDeadlines | null>(null);
const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
const [jobKey, setJobKey] = useState<CryptoKey | null>(null);
const [decryptedAgreement, setDecryptedAgreement] = useState<string | null>(null);
const [decryptedDeliverable, setDecryptedDeliverable] = useState<string | null>(null);
```

**Sections**:

1. **Header**: Dispute ID, job ID, milestone index, phase badge, parties.
2. **Key Decryption Section** (visible in `KeyDistribution` and `UnderReview` phases):
   - Show key submission status: Client key ✅/❌, Freelancer key ✅/❌
   - "Decrypt Job Key" button:
     - Fetches encrypted keys from both parties via `useDispute().fetchEncryptedKey(disputeId, clientAddr)` and `fetchEncryptedKey(disputeId, freelancerAddr)`
     - Decrypts using `decryptWithPrivateKey()` from `crypto/keyExchange.ts`
     - Stores the decrypted key in component state
   - After key decryption: show "🔓 Job key decrypted" badge
3. **Agreement Section** (visible after key decryption):
   - Fetch agreement CID from `DataAvailability.getJobCIDs(jobId)` or from the job info
   - Decrypt with `decryptText(jobKey, data)`
   - Render plaintext in a styled card
4. **Deliverable Section** (visible after key decryption):
   - Fetch deliverable CID from `getMilestoneInfo(jobId, milestoneIdx).deliverableCID`
   - Decrypt and render
5. **Evidence Section**:
   - Render `<EvidenceDecryptor evidence={evidence} jobKey={jobKey} />`
6. **Ruling Section** (visible when phase is `UnderReview`):
   - Render `<RulingForm disputeId={disputeId} ... />`
7. **Ruling Result** (visible when phase is `Ruled` or `Executed`):
   - Show ruling outcome, BPS values, and execution status
   - If `Ruled` but not `Executed`, show "Execute Ruling" button

### 4.8 Task A7 — `KeyDistributionPanel` Component

**File**: `src/components/dispute/KeyDistributionPanel.tsx`

Extract the key distribution logic currently inline in `DisputeDetail.tsx` into a reusable component.

**Props**:
```typescript
interface KeyDistributionPanelProps {
  disputeId: number;
  judgeAddress: string;
  isClientKeySubmitted: boolean;
  isFreelancerKeySubmitted: boolean;
  keyDistributionDeadline: number;
  jobId: number;
  userRole: 'client' | 'freelancer' | 'none';
  onKeyDistributed: () => void;      // refresh callback
}
```

**Behaviour**:
1. Show key submission status for both parties.
2. If the connected user is a party who hasn't submitted yet:
   - "Distribute Key to Judge" button
   - On click: retrieve job key from localStorage → encrypt for judge address using `encryptForRecipient()` → call `distributeKeyToJudge(disputeId, encryptedKey)`
3. Show countdown to `keyDistributionDeadline`.
4. If deadline has passed and at least one key is missing, show "Claim Key Default" button (calls `claimKeyDefault(disputeId)`).

### 4.9 Task A8 — Enhance `DisputeDetail` Page

**Modifications** to `src/pages/DisputeDetail.tsx`:

1. **Replace inline dispute operations** with `useDispute()` hook calls.
2. **Replace inline key distribution logic** with `<KeyDistributionPanel>` component.
3. **Add `closeEvidencePhase` button**: visible when the dispute is in `Evidence` phase and the evidence deadline has passed. Any party can call this.
4. **Add `claimKeyDefault` button**: visible when in `KeyDistribution` phase and deadline has passed.
5. **Add execute ruling button**: visible when phase is `Ruled` — calls `executeRuling(disputeId)`.
6. **Add deadline countdowns**: use `<CountdownTimer>` for evidence deadline, key distribution deadline, and ruling deadline (from `fetchDisputeDeadlines`).

---

## 5. Developer B — Admin Dashboard & Platform Infrastructure

### 5.1 Task Breakdown

| # | Task | New/Modified File(s) | Priority |
|---|------|---------------------|----------|
| B1 | Copy PlatformRoles ABI + add to config | `src/abis/PlatformRoles.json`, `src/config/contracts.ts` | **High — do this first** |
| B2 | Extend `ContractContext` with PlatformRoles | Modify `src/contexts/ContractContext.tsx` | **High** |
| B3 | Create `useAdmin` hook | `src/hooks/useAdmin.ts` | **High** |
| B4 | Create `AdminDashboard` page | `src/pages/AdminDashboard.tsx` | High |
| B5 | Create `RoleManager` component | `src/components/admin/RoleManager.tsx` | High |
| B6 | Create `JudgeAssigner` component | `src/components/admin/JudgeAssigner.tsx` | High |
| B7 | Create `PlatformStats` component | `src/components/admin/PlatformStats.tsx` | Medium |
| B8 | Create `ContractPauser` component | `src/components/admin/ContractPauser.tsx` | Low |
| B9 | Add routes to `App.tsx` | Modify `src/App.tsx` | Medium |
| B10 | Add conditional Navbar links | Modify `src/components/layout/Navbar.tsx` | Medium |
| B11 | Implement `litProtocol.ts` wrapper | `src/crypto/litProtocol.ts` | Medium |
| B12 | Update `keyExchange.ts` to use Lit Protocol | Modify `src/crypto/keyExchange.ts` | Medium (after B11) |
| B13 | Install Lit Protocol dependencies | `package.json` | Medium (before B11) |
| B14 | Write tests for `useAdmin` hook | `src/__tests__/hooks/useAdmin.test.ts` | Medium |
| B15 | Write tests for admin components | `src/__tests__/integration/adminFlow.test.ts` | Low |

### 5.2 Task B1 — PlatformRoles ABI

**Step 1**: Generate the ABI. PlatformRoles is a **library** (not a deployable contract), but role management is done through contracts that **inherit** OpenZeppelin's `AccessControl`. The `grantRole`, `revokeRole`, `hasRole`, `getRoleAdmin` functions are part of the `AccessControl` ABI, which is already inherited by `JobEscrow`, `Dispute`, `Reputation`, and `DataAvailability`.

**Therefore**: You do NOT need a separate `PlatformRoles.json` ABI file. Instead, the `AccessControl` functions (`grantRole`, `revokeRole`, `hasRole`) are already present in each contract's ABI (e.g., `Dispute.json`, `JobEscrow.json`). Verify this by checking `src/abis/Dispute.json` for the `grantRole` function.

**Step 2**: Add the contract address configuration. Update `src/config/contracts.ts`:

```typescript
export const CONTRACT_ADDRESSES = {
  jobEscrow:        import.meta.env.VITE_JOB_ESCROW_ADDRESS,
  dispute:          import.meta.env.VITE_DISPUTE_ADDRESS,
  reputation:       import.meta.env.VITE_REPUTATION_ADDRESS,
  dataAvailability: import.meta.env.VITE_DATA_AVAILABILITY_ADDRESS,
  mockUSDC:         import.meta.env.VITE_MOCK_USDC_ADDRESS,
  // No separate PlatformRoles address needed — roles are managed on individual contracts
};
```

**Key insight**: Role management calls (`grantRole`, `revokeRole`) target the **specific contract** (e.g., call `dispute.grantRole(PLATFORM_JUDGE, judgeAddr)` on the Dispute contract, not on a separate PlatformRoles contract). This is because `PlatformRoles.sol` is a library defining role constants, not a standalone contract.

### 5.3 Task B2 — Extend `ContractContext`

Since `PlatformRoles` is a library (not a deployed contract), no changes to `ContractContext` are strictly required. The admin hook will call `grantRole`/`revokeRole` on existing contract instances (`contracts.dispute`, `contracts.jobEscrow`, etc.).

**However**, if the team later decides to deploy a centralised role registry, the context can be extended. For now, leave `ContractContext` unchanged.

### 5.4 Task B3 — `useAdmin` Hook

**File**: `src/hooks/useAdmin.ts`

```typescript
import { useContracts } from '@/contexts/ContractContext';
import { useWallet } from '@/contexts/WalletContext';
import { ROLE_HASHES } from '@/config/constants';
import { parseContractError } from '@/utils/errors';
import toast from 'react-hot-toast';

type ContractName = 'jobEscrow' | 'dispute' | 'reputation' | 'dataAvailability';

export function useAdmin() {
  const { contracts, readContracts } = useContracts();
  const { account } = useWallet();
  const [loading, setLoading] = useState(false);

  // Internal execute wrapper
  const execute = async (label: string, fn: () => Promise<any>) => {
    setLoading(true);
    try {
      const tx = await fn();
      toast.loading(`${label}: waiting for confirmation...`);
      await tx.wait();
      toast.success(`${label} confirmed!`);
    } catch (e) {
      toast.error(parseContractError(e));
      throw e;
    } finally {
      setLoading(false);
    }
  };

  // Resolve the contract instance from name
  const getContract = (name: ContractName, write = true) => {
    const source = write ? contracts : readContracts;
    return source?.[name] ?? null;
  };

  // --- Write operations ---

  const grantRole = async (contractName: ContractName, role: string, account: string) => {
    const contract = getContract(contractName, true);
    if (!contract) throw new Error('Contract not available');
    await execute('Grant Role', () => contract.grantRole(role, account));
  };

  const revokeRole = async (contractName: ContractName, role: string, account: string) => {
    const contract = getContract(contractName, true);
    if (!contract) throw new Error('Contract not available');
    await execute('Revoke Role', () => contract.revokeRole(role, account));
  };

  /**
   * Assign a judge to a dispute.
   * Calls Dispute.assignJudge(disputeId, judgeAddr, ephemeralPubKey).
   * Requires PLATFORM_ADMIN role on the Dispute contract.
   */
  const assignJudge = async (disputeId: number, judgeAddress: string, ephemeralPubKey: string) => {
    await execute('Assign Judge', () =>
      contracts!.dispute.assignJudge(disputeId, judgeAddress, ethers.toUtf8Bytes(ephemeralPubKey))
    );
  };

  // --- Read operations ---

  const hasRole = async (contractName: ContractName, role: string, addr: string): Promise<boolean> => {
    const contract = getContract(contractName, false);
    if (!contract) return false;
    try {
      return await contract.hasRole(role, addr);
    } catch {
      return false;
    }
  };

  /**
   * Enumerate current holders of a role by scanning RoleGranted / RoleRevoked events.
   * Returns an array of addresses that currently hold the role.
   */
  const getRoleHolders = async (contractName: ContractName, role: string): Promise<string[]> => {
    const contract = getContract(contractName, false);
    if (!contract) return [];

    // Get all RoleGranted events for this role
    const grantedFilter = contract.filters.RoleGranted(role);
    const grantedEvents = await contract.queryFilter(grantedFilter);

    // Get all RoleRevoked events for this role
    const revokedFilter = contract.filters.RoleRevoked(role);
    const revokedEvents = await contract.queryFilter(revokedFilter);

    // Build a set of current holders
    const holders = new Set<string>();
    const revokedSet = new Set(revokedEvents.map(e => `${e.args?.[1]}-${e.blockNumber}`));

    for (const e of grantedEvents) {
      const addr = e.args?.[1] as string;
      holders.add(addr);
    }
    for (const e of revokedEvents) {
      const addr = e.args?.[1] as string;
      holders.delete(addr);
    }

    return Array.from(holders);
  };

  /**
   * Fetch aggregate platform statistics.
   */
  const fetchPlatformStats = async () => {
    const je = readContracts!.jobEscrow;
    const disp = readContracts!.dispute;

    const nextJobId = Number(await je.nextJobId());
    const nextDisputeId = Number(await disp.nextDisputeId());

    // Iterate jobs for aggregation (fine for demo scale <100 jobs)
    let openJobs = 0, activeJobs = 0, completedJobs = 0;
    let totalEscrowedValue = BigInt(0);

    for (let i = 0; i < nextJobId; i++) {
      try {
        const info = await je.getJobInfo(i);
        const state = Number(info.state ?? info[2]); // depends on ABI return shape
        const totalAmount = info.totalAmount ?? info[3];
        if (state === 0) openJobs++;          // Open
        else if (state === 2) { activeJobs++; totalEscrowedValue += BigInt(totalAmount); }
        else if (state === 3) completedJobs++;
      } catch { /* skip invalid */ }
    }

    // Count dispute phases
    let activeDisputes = 0, resolvedDisputes = 0;
    for (let i = 0; i < nextDisputeId; i++) {
      try {
        const [phase] = await disp.getDisputeStatus(i);
        if (Number(phase) < 5) activeDisputes++;  // Not yet Executed
        else resolvedDisputes++;
      } catch { /* skip */ }
    }

    return {
      totalJobs: nextJobId,
      openJobs,
      activeJobs,
      completedJobs,
      totalEscrowedValue,
      totalDisputes: nextDisputeId,
      activeDisputes,
      resolvedDisputes,
    };
  };

  /**
   * Fetch disputes that are in AwaitingJudge phase (need judge assignment).
   */
  const fetchPendingDisputes = async (): Promise<DisputeDetails[]> => {
    const disp = readContracts!.dispute;
    const nextDisputeId = Number(await disp.nextDisputeId());
    const pending: DisputeDetails[] = [];

    for (let i = 0; i < nextDisputeId; i++) {
      try {
        const [phase] = await disp.getDisputeStatus(i);
        if (Number(phase) === 1) { // AwaitingJudge
          const details = await disp.getDisputeDetails(i);
          pending.push({
            disputeId: i,
            jobId: Number(details[0]),
            milestoneIdx: Number(details[1]),
            initiator: details[2],
            client: details[3],
            freelancer: details[4],
            milestoneValue: details[5],
            judge: details[6],
            phase: Number(details[7]),
            ruling: Number(details[8]),
          });
        }
      } catch { /* skip */ }
    }

    return pending;
  };

  return {
    grantRole, revokeRole, assignJudge,
    hasRole, getRoleHolders,
    fetchPlatformStats, fetchPendingDisputes,
    loading,
  };
}
```

**Important**: The hook needs access to `nextDisputeId` on the Dispute contract. Verify this function exists in the ABI. If not, use event count as a proxy.

### 5.5 Task B4 — `AdminDashboard` Page

**File**: `src/pages/AdminDashboard.tsx`

**Role Gate**: Check for `DEFAULT_ADMIN_ROLE` (the zero-hash role `0x000...000`) or `PLATFORM_ADMIN` role on the Dispute contract:
```typescript
const isAdmin = await readContracts.dispute.hasRole(ROLE_HASHES.PLATFORM_ADMIN, account)
  || await readContracts.dispute.hasRole(ROLE_HASHES.DEFAULT_ADMIN, account);
```

**Layout** (tab-based):

```
┌──────────────────────────────────────────────────────────────┐
│  🛡️ Admin Dashboard                                          │
├──────────────────────────────────────────────────────────────┤
│  [Platform Stats]  [Role Management]  [Judge Assignment]     │
│                                                              │
│  <Tab Content based on selection>                            │
│    - PlatformStats                                           │
│    - RoleManager                                             │
│    - JudgeAssigner (with list of pending disputes)           │
└──────────────────────────────────────────────────────────────┘
```

**Tabs**:
1. **Platform Stats** → `<PlatformStats />`
2. **Role Management** → `<RoleManager />`
3. **Judge Assignment** → `<JudgeAssigner />`
4. (Optional) **Contract Controls** → `<ContractPauser />` (low priority — only if contracts implement `Pausable`)

### 5.6 Task B5 — `RoleManager` Component

**File**: `src/components/admin/RoleManager.tsx`

**Sections**:

1. **Current Role Holders Table**:
   - For each role (`PLATFORM_ADMIN`, `PLATFORM_JUDGE`), call `useAdmin().getRoleHolders('dispute', role)`.
   - Render a table with columns: Address, Role, [Revoke] button.
   - On revoke: call `revokeRole('dispute', role, address)`.

2. **Grant Role Form**:
   - Inputs: Role dropdown (`PLATFORM_ADMIN` / `PLATFORM_JUDGE`), Address text input.
   - Contract selector: dropdown of target contracts (Dispute, JobEscrow, etc.) — because the same role may need to be granted on multiple contracts.
   - Submit button: calls `grantRole(contractName, role, address)`.

**UX note**: When granting `PLATFORM_JUDGE`, the admin typically only needs to grant on the Dispute contract. When granting `ESCROW_ROLE`, the admin grants on JobEscrow. Provide sensible defaults in the UI to minimise confusion.

### 5.7 Task B6 — `JudgeAssigner` Component

**File**: `src/components/admin/JudgeAssigner.tsx`

**Props**:
```typescript
interface JudgeAssignerProps {
  pendingDisputes: DisputeDetails[];
  onAssigned: () => void;         // refresh callback
}
```

**Rendering**:
- List of pending disputes (phase = `AwaitingJudge`), each showing:
  - Dispute ID, Job ID, Milestone Index
  - Client and Freelancer addresses
  - Evidence close timestamp
- For each dispute, an **assignment form**:
  - Judge address input (`<input type="text" placeholder="0x..." />`)
  - (Optional) Ephemeral public key input — for the demo, this can be auto-generated or a placeholder
  - "Assign Judge" button: calls `useAdmin().assignJudge(disputeId, judgeAddress, ephemeralPubKey)`

**Ephemeral public key strategy** (for the demo):
- The simplest approach: use the judge's actual Ethereum address as the "ephemeral public key" (pass as bytes). This avoids key generation complexity.
- The contract accepts any `bytes` for `ephemeralPubKey` — it's stored for the key distribution phase but not cryptographically validated on-chain.
- In the current key distribution flow (both MetaMask-based and Lit Protocol-based), the job key is encrypted to the judge's Ethereum address directly, so the ephemeral key is informational.

### 5.8 Task B7 — `PlatformStats` Component

**File**: `src/components/admin/PlatformStats.tsx`

**Data**: Uses `useAdmin().fetchPlatformStats()`.

**Rendering**: A grid of stat cards (reuse the same card pattern as `Dashboard.tsx`):

| Stat | Source |
|------|--------|
| Total Jobs | `nextJobId` |
| Open Jobs | Filtered count |
| Active Jobs | Filtered count |
| Completed Jobs | Filtered count |
| Total Escrowed Value | Sum of active job values (formatted as USDC) |
| Total Disputes | `nextDisputeId` |
| Active Disputes | Disputes not in Executed phase |
| Resolved Disputes | Disputes in Executed phase |

### 5.9 Task B8 — `ContractPauser` Component (Low Priority)

**File**: `src/components/admin/ContractPauser.tsx`

**Note**: This is only relevant if the contracts implement OpenZeppelin's `Pausable` pattern. Check the contract source:
- If `paused()`, `pause()`, `unpause()` exist → implement this component.
- If not → skip and render "Contract pausing is not currently supported."

If implemented:
- For each contract (JobEscrow, Dispute), show: Contract name, Paused status (true/false), Toggle button (Pause/Unpause).
- Call `contracts.jobEscrow.pause()` / `contracts.jobEscrow.unpause()`.

### 5.10 Task B9 — Route Registration

**File**: Modify `src/App.tsx`

Add two new routes inside the existing `<Routes>` block:

```tsx
import JudgeDashboard from '@/pages/JudgeDashboard';
import AdminDashboard from '@/pages/AdminDashboard';

// Inside <Routes>:
<Route path="/judge" element={<JudgeDashboard />} />
<Route path="/admin" element={<AdminDashboard />} />
```

Place these routes before the catch-all `*` route.

### 5.11 Task B10 — Conditional Navbar Links

**File**: Modify `src/components/layout/Navbar.tsx`

Add role-aware conditional links:

```tsx
// Inside Navbar component:
const { account } = useWallet();
const { readContracts } = useContracts();
const [isJudge, setIsJudge] = useState(false);
const [isAdmin, setIsAdmin] = useState(false);

useEffect(() => {
  if (!account || !readContracts?.dispute) return;
  
  const checkRoles = async () => {
    const judgeRole = await readContracts.dispute.hasRole(ROLE_HASHES.PLATFORM_JUDGE, account);
    const adminRole = await readContracts.dispute.hasRole(ROLE_HASHES.PLATFORM_ADMIN, account)
      || await readContracts.dispute.hasRole(ROLE_HASHES.DEFAULT_ADMIN, account);
    setIsJudge(judgeRole);
    setIsAdmin(adminRole);
  };
  
  checkRoles();
}, [account, readContracts]);

// In the navigation link list:
{isJudge && <NavLink to="/judge" className="...">⚖️ Judge</NavLink>}
{isAdmin && <NavLink to="/admin" className="...">🛡️ Admin</NavLink>}
```

**Cache the result**: Role checks require RPC calls. Cache the result for the session and only re-check on account change.

### 5.12 Task B11 — Lit Protocol Wrapper

**File**: `src/crypto/litProtocol.ts`

Install dependencies first (Task B13):
```bash
npm install @lit-protocol/lit-node-client @lit-protocol/constants @lit-protocol/types
```

See `DevelopmentPlan-Stage2.md` §8.4.1 for the full implementation specification. Key points:

1. **Lazy singleton**: The `LitNodeClient` is initialised once and reused.
2. **Network**: Use `LitNetwork.DatilDev` (free test network, no API key needed).
3. **Access control**: Use EVM address-based conditions to restrict decryption to a specific wallet.
4. **Auth signature**: Generate SIWE (Sign-In with Ethereum) auth sigs via MetaMask.

**Exports**:
```typescript
export async function connectLitClient(): Promise<LitNodeClient>;
export async function encryptJobKeyForRecipient(jobKeyBytes: Uint8Array, recipientAddress: string): Promise<{ ciphertext: string; dataToEncryptHash: string }>;
export async function decryptJobKeyAsRecipient(ciphertext: string, dataToEncryptHash: string, recipientAddress: string): Promise<Uint8Array>;
export function disconnectLitClient(): void;
```

### 5.13 Task B12 — Update `keyExchange.ts` to Use Lit Protocol

**File**: Modify `src/crypto/keyExchange.ts`

After `litProtocol.ts` is implemented, update the internal implementation:

**Current** (`personal_sign` + HKDF):
```typescript
export async function encryptForRecipient(jobKeyBytes, recipientAddress, signer) { ... }
export async function decryptWithPrivateKey(encryptedPackage, senderAddress, signer) { ... }
```

**Updated** (Lit Protocol):
```typescript
import { encryptJobKeyForRecipient, decryptJobKeyAsRecipient } from './litProtocol';

export async function encryptForRecipient(
  jobKeyBytes: Uint8Array,
  recipientAddress: string,
  _signer?: any   // Keep param for backward compat, but unused with Lit
): Promise<Uint8Array> {
  const { ciphertext, dataToEncryptHash } = await encryptJobKeyForRecipient(jobKeyBytes, recipientAddress);
  // Encode ciphertext + hash into a single Uint8Array for storage
  const encoder = new TextEncoder();
  const payload = JSON.stringify({ ciphertext, dataToEncryptHash });
  return encoder.encode(payload);
}

export async function decryptWithPrivateKey(
  encryptedPackage: Uint8Array,
  _senderAddress: string,    // Unused with Lit Protocol
  _signer?: any
): Promise<Uint8Array> {
  const decoder = new TextDecoder();
  const { ciphertext, dataToEncryptHash } = JSON.parse(decoder.decode(encryptedPackage));
  // recipientAddress is the connected wallet — Lit Protocol checks via auth sig
  const provider = new ethers.BrowserProvider((window as any).ethereum);
  const signer = await provider.getSigner();
  const recipientAddress = await signer.getAddress();
  return decryptJobKeyAsRecipient(ciphertext, dataToEncryptHash, recipientAddress);
}
```

**Important**: The return type changes from a binary format to a JSON-encoded format. Update any code that reads this data (e.g., `distributeKeyToJudge` on-chain accepts `bytes`, so the JSON string encoded as bytes is fine — it's opaque data stored and retrieved as-is).

---

## 6. Lit Protocol Integration (Joint Task — Phased)

The Lit Protocol migration touches both developers' work areas. To avoid blocking, follow this phased approach:

### Phase 1 — Dev B implements `litProtocol.ts` (independent)
- Create the wrapper with the exports defined above.
- Write unit tests for encrypt/decrypt round-trip using a local test setup.
- **Does not block Dev A** — Dev A continues using the existing `keyExchange.ts` (personal_sign).

### Phase 2 — Dev B updates `keyExchange.ts` (independent)
- Swap internals to call `litProtocol.ts`.
- **Does not block Dev A** — the API surface of `keyExchange.ts` stays the same.

### Phase 3 — Dev A tests the integrated flow (after Dev B merges)
- Dev A's `DisputeReviewPanel` and `KeyDistributionPanel` call `encryptForRecipient()` / `decryptWithPrivateKey()` from `keyExchange.ts`.
- With Lit Protocol backend, the judge decryption flow now uses threshold ECIES instead of personal_sign.
- Dev A verifies: key distribution → judge decryption → evidence decryption → ruling submission.

### Fallback
If Lit Protocol integration faces issues (SDK compatibility, network availability), the existing `personal_sign` + HKDF approach is **fully functional** and can be kept for the demo. Document which backend is active in the `.env` or a config flag:

```typescript
// Optional feature flag in constants.ts
export const USE_LIT_PROTOCOL = import.meta.env.VITE_USE_LIT_PROTOCOL === 'true';
```

---

## 7. Integration Checklist

Before final merge, verify the following end-to-end flows:

### 7.1 Judge Flow

- [ ] Judge connects wallet → Navbar shows "Judge" link
- [ ] Judge navigates to `/judge` → sees assigned disputes
- [ ] Judge selects a dispute → `DisputeReviewPanel` loads
- [ ] Judge clicks "Decrypt Job Key" → MetaMask prompts signature → key decrypted
- [ ] Judge views decrypted agreement, deliverable, and evidence
- [ ] Judge fills in ruling form → validates BPS constraints
- [ ] Judge submits ruling → transaction confirmed → phase transitions to `Ruled`
- [ ] Judge (or anyone) executes ruling → funds redistributed

### 7.2 Admin Flow

- [ ] Admin connects wallet → Navbar shows "Admin" link
- [ ] Admin navigates to `/admin` → sees platform stats
- [ ] Admin views current role holders for `PLATFORM_JUDGE` and `PLATFORM_ADMIN`
- [ ] Admin grants `PLATFORM_JUDGE` role to a new address → transaction confirmed
- [ ] Admin revokes a role → transaction confirmed
- [ ] Admin views pending disputes (AwaitingJudge phase)
- [ ] Admin assigns a judge to a dispute → transaction confirmed → dispute transitions to `KeyDistribution`

### 7.3 Dispute Flow Enhancement (Client/Freelancer Side)

- [ ] Client/Freelancer can close evidence phase after deadline
- [ ] Client/Freelancer can distribute key to judge during `KeyDistribution` phase
- [ ] `claimKeyDefault` works when deadline passes without full key submission
- [ ] Execute ruling button appears after ruling is submitted

### 7.4 Cross-Role Integration

- [ ] Admin assigns judge → Judge sees dispute in dashboard → Client/Freelancer distribute keys → Judge decrypts and rules → Ruling executed → Funds redistributed → Reputation updated
- [ ] Role gating works: non-judge cannot access `/judge`, non-admin cannot access `/admin`
- [ ] Role changes reflect immediately: grant judge role → that account sees Judge link in Navbar on next connection

---

## 8. Testing Strategy

### 8.1 Dev A Tests

| Test File | Coverage |
|-----------|----------|
| `__tests__/hooks/useDispute.test.ts` | Mock Dispute contract, test all write/read operations |
| `__tests__/integration/judgeFlow.test.ts` | Mock full judge workflow: fetch disputes → decrypt key → view evidence → submit ruling → execute |
| `__tests__/components/RulingForm.test.ts` | Form validation: BPS constraints, required fields, auto-fill behaviour |

### 8.2 Dev B Tests

| Test File | Coverage |
|-----------|----------|
| `__tests__/hooks/useAdmin.test.ts` | Mock AccessControl contract, test grantRole/revokeRole/hasRole/getRoleHolders |
| `__tests__/integration/adminFlow.test.ts` | Mock admin workflow: view stats → assign judge → grant role |
| `__tests__/crypto/litProtocol.test.ts` | Lit Protocol encrypt/decrypt round-trip (may need to mock Lit SDK for CI) |

### 8.3 Testing Approach

- Use the **existing Vitest + Testing Library setup** (already configured in `vitest.config.ts`).
- Mock contract calls using `vi.fn()` — same pattern as existing tests in `__tests__/hooks/useJobEscrow.test.ts`.
- For Lit Protocol tests, mock the `LitNodeClient` entirely since the Datil-dev network may not be available in CI.
- Integration tests should test the **data flow** (hook → contract → state update), not the UI rendering (keep UI tests lightweight).

### 8.4 Manual Testing Script

After integration, run through the full demo script from `DevelopmentPlan-Stage2.md` §12, specifically Acts 7–9 (Dispute, Admin, Judge) which cover the new functionality.

---

*End of Development Plan — Fill the Gap*
