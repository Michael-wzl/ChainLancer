# Development Plan — Stage 2: Frontend, IPFS Integration & Local Demo Deployment

> **Role**: Tech Lead — Stage 2 Implementation Specification  
> **Date**: March 2026 (Revised)  
> **Base Documents**: `WorkflowDesign.md`, `DevelopmentPlan.md` (Stage 1)  
> **Scope**: React frontend for **all four personas** (Client, Freelancer, Judge, Admin), IPFS integration (Pinata), production-grade client-side cryptography (ECIES via Lit Protocol), Remix IDE deployment workflow, **local desktop deployment**. Judge dashboard and Admin dashboard are **in scope**.  
> **Non-Goal**: This document does not cover work division or timeline. Accessibility (WCAG) compliance is explicitly out of scope — this is a demo.

---

## Table of Contents

1. [Stage 2 Objectives & Demo Scope](#1-stage-2-objectives--demo-scope)
2. [Deployment Architecture](#2-deployment-architecture)
3. [On-Chain Deployment via Remix IDE](#3-on-chain-deployment-via-remix-ide)
4. [Repository Structure (Stage 2 Additions)](#4-repository-structure-stage-2-additions)
5. [Technology Stack (Stage 2)](#5-technology-stack-stage-2)
6. [Frontend Architecture](#6-frontend-architecture)
7. [IPFS Integration (Pinata)](#7-ipfs-integration-pinata)
8. [Client-Side Cryptographic Module](#8-client-side-cryptographic-module)
9. [Contract Integration Layer](#9-contract-integration-layer)
10. [Page-by-Page Specification](#10-page-by-page-specification)
11. [Local Desktop Deployment](#11-local-desktop-deployment)
12. [Demo Script — Board Presentation](#12-demo-script--board-presentation)
13. [Environment Variables & Configuration](#13-environment-variables--configuration)
14. [Testing Strategy (Stage 2)](#14-testing-strategy-stage-2)
15. [Simplifications & Known Limitations (Demo Scope)](#15-simplifications--known-limitations-demo-scope)

---

## 1. Stage 2 Objectives & Demo Scope

### 1.1 Objectives

Stage 1 delivered the complete on-chain contract suite (JobEscrow, Dispute, Reputation, DataAvailability, MockUSDC) with full unit, integration, and security tests. Stage 2 builds the **off-chain layer** required to produce a working demo:

| # | Deliverable | Description |
|---|-------------|-------------|
| 1 | **React Frontend (dApp)** | Client, Freelancer, **Judge**, and **Admin** UIs for the full platform lifecycle |
| 2 | **IPFS Integration** | Agreements, deliverables, and proposals uploaded to Pinata; retrieved via IPFS HTTP gateway |
| 3 | **Client-Side Cryptography (ECIES)** | AES-256-GCM encryption/decryption, per-job key generation, **proper ECIES key exchange via Lit Protocol** |
| 4 | **Remix IDE Deployment** | Contracts deployable on any EVM testnet (Base Sepolia, Sepolia, etc.) via Remix IDE with "Injected Provider" |
| 5 | **Judge Dashboard** | Dedicated UI for judges: view assigned disputes, decrypt evidence, submit rulings |
| 6 | **Admin Dashboard** | Platform admin UI: role management (grant/revoke), judge assignment, contract pause/unpause |
| 7 | **Local Desktop Deployment** | Frontend served via Vite dev server on `localhost` for the board demo |

### 1.2 Scope Boundaries — What We Build vs. What We Defer

| In Scope (Demo) | Deferred (Post-Demo) |
|------------------|---------------------|
| Client: post job, select freelancer, approve milestones, raise dispute, cancel, withdraw | WalletConnect, multi-wallet support |
| Freelancer: browse jobs, apply, confirm & stake, submit milestones, raise dispute, withdraw | Subgraph / indexer for historical queries |
| **Judge: view assigned disputes, decrypt evidence via Lit Protocol, submit rulings** | Self-hosted IPFS pinning node, retention enforcement service |
| **Admin: role management (grant/revoke roles), judge assignment, pause/unpause** | Hardhat-scripted automated CI/CD deployment |
| Dispute: full lifecycle including evidence, key distribution, judge ruling, execution | Multi-network support with network switcher |
| IPFS: upload and retrieve encrypted content via Pinata | Full mobile-responsive design |
| **Crypto: proper ECIES key exchange via Lit Protocol** for freelancer + judge key distribution | Backend pinning service listening to CIDRegistered events |
| MetaMask wallet connection | Production error handling, retry logic, tx acceleration |
| Real-time event-driven UI updates | WCAG accessibility compliance |
| Local desktop deployment (Vite dev server) | Cloud deployment (Azure / Vercel) |

### 1.3 Demo Persona Flows

The demo will showcase **four personas** interacting with the platform through separate MetaMask accounts:

**Client (Account A):**
1. Connect wallet → Mint test USDC → Post a job (with encrypted agreement on IPFS)
2. Review freelancer's application → Select freelancer → Wait for stake confirmation
3. Review submitted milestone (decrypt from IPFS) → Approve milestone
4. Raise dispute on a milestone → Submit evidence → Distribute key to judge via Lit Protocol
5. View reputation profile → Withdraw released funds

**Freelancer (Account B):**
1. Connect wallet → Mint test USDC (for deposit) → Browse open jobs
2. Apply to a job (with proposal on IPFS) → Accept offer & stake deposit
3. Submit milestone (with encrypted deliverable on IPFS)
4. Submit dispute evidence → Distribute key to judge via Lit Protocol
5. View reputation profile → Withdraw earned funds

**Judge (Account C):**
1. Connect wallet → Navigate to Judge Dashboard
2. View assigned disputes (filtered by `JudgeAssigned` events where `judge == address`)
3. Retrieve encrypted keys from both parties → Decrypt $K_{job}$ using Lit Protocol
4. Fetch and decrypt agreement, deliverable, and evidence from IPFS
5. Submit ruling: choose outcome (FreelancerWins / ClientWins / Inconclusive), set `freelancerShareBps`, `depositSlashBps`, provide reasoning hash
6. Execute the ruling → See funds redistributed

**Admin (Account D / Deployer):**
1. Connect wallet → Navigate to Admin Dashboard
2. View all platform roles and their current holders
3. Assign a judge to a pending dispute (provide judge address + ephemeral public key)
4. Grant/revoke `PLATFORM_JUDGE` and `PLATFORM_ADMIN` roles
5. View platform-wide statistics (total jobs, total escrowed value, active disputes)
6. Emergency pause/unpause contracts (if Pausable is implemented)

---

## 2. Deployment Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                    Local Desktop Demo Architecture                       │
│                                                                          │
│   ┌──────────────────────────────────┐   ┌────────────────────────────┐ │
│   │  localhost:5173 (Vite Dev)       │   │    Pinata Cloud            │ │
│   │  (React Frontend)               │   │    (IPFS Pinning)          │ │
│   │                                  │   │                            │ │
│   │   ┌──────────┐  ┌────────────┐   │   │  ┌──────────────────────┐  │ │
│   │   │  React   │  │  Crypto    │   │   │  │  Pinata SDK          │  │ │
│   │   │  UI      │  │  Module    │   │   │  │  (upload/retrieve)   │  │ │
│   │   │  Pages   │  │  (ECIES    │   │   │  └──────────────────────┘  │ │
│   │   │  ─────   │  │  via Lit)  │   │   └──────────┬─────────────────┘ │
│   │   │ Client   │  └──────┬─────┘   │              │                   │
│   │   │Freelancer│         │          │              │                   │
│   │   │ Judge    │         │          │              │                   │
│   │   │ Admin    │         │          │              │                   │
│   │   └────┬─────┘         │          │              │                   │
│   │        │               │          │              │                   │
│   │        ▼               ▼          │              │                   │
│   │   ┌──────────────────────────┐    │              │                   │
│   │   │  ethers.js v6            │    │              │                   │
│   │   │  (MetaMask / Injected)   │◄───┼──────────────┘                   │
│   │   └──────────┬───────────────┘    │                                  │
│   │              │                    │   ┌────────────────────────────┐ │
│   │              │                    │   │  Lit Protocol SDK          │ │
│   │              │                    │   │  (Decentralized key mgmt   │ │
│   │              │                    │   │   & threshold ECIES)       │ │
│   │              │                    │   └────────────────────────────┘ │
│   └──────────────┼────────────────────┘                                  │
│                  │                                                        │
│                  ▼                                                        │
│   ┌──────────────────────────────────────────────┐                       │
│   │     EVM Testnet (e.g., Base Sepolia)          │                      │
│   │     — or Hardhat Local (localhost:8545) —      │                      │
│   │     Deployed via Remix IDE or Hardhat          │                      │
│   │                                               │                      │
│   │   ┌──────────────┐  ┌─────────────────────┐  │                      │
│   │   │  MockUSDC    │  │  DataAvailability    │  │                      │
│   │   └──────────────┘  └─────────────────────┘  │                      │
│   │   ┌──────────────┐  ┌─────────────────────┐  │                      │
│   │   │  Reputation  │  │  Dispute             │  │                      │
│   │   └──────────────┘  └─────────────────────┘  │                      │
│   │   ┌──────────────────────────────────────────┤                      │
│   │   │  JobEscrow (central contract)            │                      │
│   │   └──────────────────────────────────────────┘                      │
│   └──────────────────────────────────────────────┘                       │
└──────────────────────────────────────────────────────────────────────────┘
```

**Key design decisions:**
- **No backend server.** The React frontend communicates directly with the blockchain (via MetaMask) and IPFS (via Pinata SDK). This eliminates an entire deployment tier and keeps the demo architecture simple.
- **Local deployment only.** The frontend runs on `localhost:5173` via Vite dev server. No cloud hosting required — the presenter runs `npm run dev` on their laptop before the demo.
- **Pinata API keys** are stored in a local `.env` file and injected at dev-server startup. Since the app runs locally, there is no risk of key exposure to the public internet.
- **Lit Protocol** provides production-grade ECIES key exchange. The Lit SDK runs client-side and uses the Lit network's threshold cryptography for encrypting/decrypting job keys — replacing insecure address-derived schemes.
- **Contracts are deployed once** via Remix IDE or Hardhat; the frontend reads the deployed addresses from a config file.

---

## 3. On-Chain Deployment via Remix IDE

The RM requires contracts to be deployable via Remix IDE. This section documents the **exact procedure** for the demo.

### 3.1 Prerequisites

| Item | Details |
|------|---------|
| MetaMask | Installed with at least 4 accounts: Deployer/Admin, Client, Freelancer, Judge |
| Testnet ETH | Faucet ETH on Base Sepolia (or any target testnet) for all 4 accounts |
| Remix IDE | https://remix.ethereum.org — browser-based, no install required |
| Contract Source | All `.sol` files from the `contracts/` directory |

### 3.2 Remix Deployment Procedure

#### Step 1: Import Contracts into Remix

1. Open Remix IDE → Create a new workspace (e.g., "ChainLancer")
2. Create the same folder structure:
   ```
   contracts/
   ├── access/PlatformRoles.sol
   ├── core/JobEscrow.sol
   ├── core/Dispute.sol
   ├── core/Reputation.sol
   ├── core/DataAvailability.sol
   ├── interfaces/IJobEscrow.sol
   ├── interfaces/IDispute.sol
   ├── interfaces/IReputation.sol
   ├── interfaces/IDataAvailability.sol
   ├── libraries/DisputeFeeLib.sol
   ├── libraries/ReputationLib.sol
   ├── libraries/TimeoutLib.sol
   └── mocks/MockUSDC.sol
   ```
3. Copy each file's content into the corresponding Remix file
4. Install OpenZeppelin via Remix: the `@openzeppelin/contracts` imports resolve automatically from npm via Remix's built-in resolver

#### Step 2: Compile

1. Go to **Solidity Compiler** tab
2. Set compiler version: `0.8.24`
3. Enable **optimization** (200 runs) and **viaIR** (matches `hardhat.config.ts`)
4. Compile `JobEscrow.sol` (this will compile all dependencies transitively)
5. Verify zero errors / zero warnings

#### Step 3: Deploy (Ordered Sequence)

Switch to the **Deploy & Run** tab. Set Environment to **Injected Provider - MetaMask**. Connect the **Deployer** account.

| Order | Contract | Constructor Args | Notes |
|-------|----------|-----------------|-------|
| 1 | `MockUSDC` | _(none)_ | Record address as `USDC_ADDR` |
| 2 | `DataAvailability` | _(none)_ | Record address as `DA_ADDR` |
| 3 | `Reputation` | _(none)_ | Record address as `REP_ADDR` |
| 4 | `Dispute` | `_dataAvailability`: `DA_ADDR` | Record address as `DISP_ADDR` |
| 5 | `JobEscrow` | `_usdc`: `USDC_ADDR`, `_dispute`: `DISP_ADDR`, `_reputation`: `REP_ADDR`, `_dataAvailability`: `DA_ADDR`, `_treasury`: `DEPLOYER_ADDR` | Record address as `ESCROW_ADDR` |

#### Step 4: Post-Deploy Configuration (Role Wiring)

After deploying all contracts, execute the following transactions **from the Deployer account** via Remix's "Deployed Contracts" panel. These role-granting calls match the deploy script exactly:

```
Role Constants (compute with keccak256 or copy from PlatformRoles.sol):
  ESCROW_ROLE    = keccak256("ESCROW_ROLE")    = 0x3e3ded1b2a4e73a2b1e79f3e3775e684b4e3c0a7... (use ethers.keccak256)
  DISPUTE_ROLE   = keccak256("DISPUTE_ROLE")   = 0x...
  PLATFORM_ADMIN = keccak256("PLATFORM_ADMIN") = 0x...
```

| # | Target Contract | Function Call | Arguments |
|---|----------------|---------------|-----------|
| 1 | Dispute | `setJobEscrow(ESCROW_ADDR)` | Wire the circular reference |
| 2 | Reputation | `grantRole(ESCROW_ROLE, ESCROW_ADDR)` | JobEscrow can update reputation |
| 3 | Dispute | `grantRole(ESCROW_ROLE, ESCROW_ADDR)` | JobEscrow can create disputes |
| 4 | JobEscrow | `grantRole(DISPUTE_ROLE, DISP_ADDR)` | Dispute can call `executeDisputeRuling` |
| 5 | DataAvailability | `grantRole(ESCROW_ROLE, ESCROW_ADDR)` | JobEscrow can register CIDs |
| 6 | DataAvailability | `grantRole(DISPUTE_ROLE, DISP_ADDR)` | Dispute can register evidence CIDs |
| 7 | Dispute | `grantRole(PLATFORM_ADMIN, DEPLOYER_ADDR)` | Deployer can assign judges |

> **Tip for the developer**: Create a helper script `scripts/remix-config-helper.ts` that pre-computes all the role hashes and prints the exact Remix function call parameters for easy copy-paste.

#### Step 5: Mint Test USDC

From the Remix "Deployed Contracts" panel, call `MockUSDC.mint()`:

| Call | To | Amount |
|------|----|--------|
| `mint(CLIENT_ADDR, 100000000000)` | Client account | 100,000 USDC (6 decimals) |
| `mint(FREELANCER_ADDR, 100000000000)` | Freelancer account | 100,000 USDC (6 decimals) |

### 3.3 Role Hash Reference

For convenience, pre-compute and document the exact `bytes32` values in the frontend config:

```typescript
// Pre-computed role hashes (paste these in Remix for grantRole calls)
const ROLES = {
  ESCROW_ROLE:    ethers.keccak256(ethers.toUtf8Bytes("ESCROW_ROLE")),
  DISPUTE_ROLE:   ethers.keccak256(ethers.toUtf8Bytes("DISPUTE_ROLE")),
  PLATFORM_ADMIN: ethers.keccak256(ethers.toUtf8Bytes("PLATFORM_ADMIN")),
  PLATFORM_JUDGE: ethers.keccak256(ethers.toUtf8Bytes("PLATFORM_JUDGE")),
};
```

### 3.4 Hardhat Deployment (Alternative)

The existing `scripts/deploy.ts` and `scripts/seed.ts` remain fully functional for automated deployment via:

```bash
npx hardhat run scripts/deploy.ts --network baseSepolia
npx hardhat run scripts/seed.ts --network baseSepolia
```

The frontend works identically regardless of whether contracts were deployed via Remix or Hardhat — it only needs the final contract addresses.

---

## 4. Repository Structure (Stage 2 Additions)

All Stage 2 code lives under a new `frontend/` directory at the repository root:

```
frontend/
├── index.html
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
├── .env.example                         # Template for required env vars
├── public/
│   └── chainlancer-logo.svg
├── src/
│   ├── main.tsx                         # App entry point
│   ├── App.tsx                          # Router + global providers
│   ├── vite-env.d.ts
│   │
│   ├── config/
│   │   ├── contracts.ts                 # Deployed contract addresses (per-network)
│   │   ├── networks.ts                  # Chain configs (Base Sepolia, Hardhat, etc.)
│   │   └── constants.ts                 # Shared constants (timeouts, BPS values)
│   │
│   ├── abis/                            # ABI JSON files (copied from artifacts/)
│   │   ├── JobEscrow.json
│   │   ├── Dispute.json
│   │   ├── Reputation.json
│   │   ├── DataAvailability.json
│   │   └── MockUSDC.json
│   │
│   ├── contexts/
│   │   ├── WalletContext.tsx            # MetaMask connection state, signer, provider
│   │   └── ContractContext.tsx          # Typed contract instances (shared across pages)
│   │
│   ├── hooks/
│   │   ├── useJobEscrow.ts             # Hooks for all JobEscrow write operations
│   │   ├── useReputation.ts            # Hooks for reading reputation profiles/scores
│   │   ├── useJobEvents.ts             # Real-time event subscriptions
│   │   ├── useJobList.ts               # Fetch & filter open/active jobs
│   │   ├── useCountdown.ts             # Timer hook for T_review, T_stake, etc.
│   │   ├── useMockUSDC.ts             # Mint & approve helpers (testnet only)
│   │   ├── useDispute.ts              # Hooks for Dispute contract interactions
│   │   └── useAdmin.ts                # Hooks for admin role management
│   │
│   ├── crypto/
│   │   ├── jobKey.ts                    # generateJobKey(), generateSalt()
│   │   ├── aes.ts                       # AES-256-GCM encrypt/decrypt
│   │   ├── keyExchange.ts              # ECIES via Lit Protocol: encryptForRecipient(), decryptWithPrivateKey()
│   │   ├── litProtocol.ts             # Lit Protocol SDK wrapper: connect, encrypt, decrypt
│   │   ├── hash.ts                      # computeAgreementHash(salt, plaintext)
│   │   └── index.ts                     # Re-exports
│   │
│   ├── ipfs/
│   │   ├── pinata.ts                    # Pinata SDK wrapper: upload, retrieve
│   │   ├── gateway.ts                   # IPFS HTTP gateway fetch
│   │   └── index.ts
│   │
│   ├── pages/
│   │   ├── Dashboard.tsx                # Landing — overview, recent jobs, wallet balance
│   │   ├── BrowseJobs.tsx               # List open jobs with filters
│   │   ├── PostJob.tsx                  # Client: create job form
│   │   ├── JobDetail.tsx                # Job detail: milestones, status, actions
│   │   ├── ApplyJob.tsx                 # Freelancer: submit application + proposal
│   │   ├── DisputeDetail.tsx            # Dispute timeline, evidence list, status
│   │   ├── JudgeDashboard.tsx           # Judge: assigned disputes, decrypt, rule
│   │   ├── AdminDashboard.tsx           # Admin: role mgmt, judge assignment, stats
│   │   ├── Profile.tsx                  # User reputation profile
│   │   └── Wallet.tsx                   # Withdrawable balance, tx history
│   │
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Navbar.tsx               # Top nav: logo, wallet connect, network badge
│   │   │   ├── Footer.tsx
│   │   │   └── Layout.tsx               # Layout wrapper with sidebar (optional)
│   │   ├── job/
│   │   │   ├── JobCard.tsx              # Summary card for job listings
│   │   │   ├── MilestoneTimeline.tsx    # Visual milestone progress tracker
│   │   │   ├── MilestoneActions.tsx     # Context-aware action buttons per milestone
│   │   │   ├── ApplicationList.tsx      # List of freelancer applications (client view)
│   │   │   └── CountdownTimer.tsx       # Countdown display for timeouts
│   │   ├── dispute/
│   │   │   ├── DisputeBanner.tsx        # Alert banner when milestone is disputed
│   │   │   ├── EvidenceList.tsx         # Submitted evidence display
│   │   │   └── KeyDistributionPanel.tsx # UI for distributing K_job to judge
│   │   ├── judge/
│   │   │   ├── DisputeQueue.tsx         # List of disputes assigned to the judge
│   │   │   ├── EvidenceDecryptor.tsx    # Decrypt & view evidence using Lit Protocol
│   │   │   ├── RulingForm.tsx           # Ruling submission form (outcome, BPS, reasoning)
│   │   │   └── DisputeReviewPanel.tsx   # Combined panel: agreement + deliverable + evidence
│   │   ├── admin/
│   │   │   ├── RoleManager.tsx          # Grant/revoke role UI (table + forms)
│   │   │   ├── JudgeAssigner.tsx        # Assign judge to dispute (address + ephemeral pubkey)
│   │   │   ├── PlatformStats.tsx        # Aggregate stats: total jobs, disputes, escrowed value
│   │   │   └── ContractPauser.tsx       # Emergency pause/unpause toggle
│   │   ├── reputation/
│   │   │   ├── ReputationBadge.tsx      # Tier badge (New/Bronze/Silver/Gold)
│   │   │   └── ScoreCard.tsx            # Score breakdown display
│   │   ├── wallet/
│   │   │   ├── ConnectButton.tsx        # MetaMask connect/disconnect
│   │   │   ├── NetworkBadge.tsx         # Current chain indicator
│   │   │   └── BalanceDisplay.tsx       # USDC + withdrawable balance
│   │   ├── common/
│   │   │   ├── TransactionButton.tsx    # Button with pending/confirmed/error states
│   │   │   ├── FileUpload.tsx           # Drag-and-drop file upload (encrypts + pins)
│   │   │   ├── IPFSFileViewer.tsx       # Fetch + decrypt + render IPFS content
│   │   │   └── StatusBadge.tsx          # Job/milestone status pill
│   │   └── testnet/
│   │       └── FaucetPanel.tsx          # Mint USDC + show testnet info (demo only)
│   │
│   ├── utils/
│   │   ├── format.ts                    # USDC formatting (6 decimals), date formatting
│   │   ├── errors.ts                    # User-friendly error messages from contract reverts
│   │   ├── typeGuards.ts               # Type narrowing helpers
│   │   └── storage.ts                   # localStorage for job keys (per-session)
│   │
│   └── styles/
│       └── globals.css                  # Tailwind CSS base + custom styles
```

---

## 5. Technology Stack (Stage 2)

| Layer | Technology | Version | Rationale |
|-------|-----------|---------|-----------|
| **UI Framework** | React 18 | `^18.3` | Hooks-based, mature ecosystem, fast rendering |
| **Build Tool** | Vite 5 | `^5.4` | Sub-second HMR, native ESM, production-optimized builds |
| **Language** | TypeScript 5 | `~5.4` | Type-safe contract interaction, shared types with Hardhat |
| **Routing** | React Router v6 | `^6.26` | Standard SPA routing |
| **Styling** | Tailwind CSS 3 | `^3.4` | Utility-first, rapid prototyping, consistent design |
| **UI Components** | shadcn/ui | Latest | Accessible, composable components built on Radix UI |
| **Blockchain** | ethers.js v6 | `^6.13` | Typed contract calls, event filters, BigInt-native |
| **Wallet** | MetaMask (EIP-1193) | — | Direct `window.ethereum` injection; no extra SDK |
| **IPFS Pinning** | Pinata SDK | `^2.1` | Managed pinning, free tier sufficient for demo |
| **IPFS Retrieval** | Pinata Gateway / public IPFS gateway | — | `https://gateway.pinata.cloud/ipfs/{CID}` |
| **Cryptography** | Web Crypto API (browser-native) | — | AES-256-GCM symmetric encryption/decryption — no external crypto lib for symmetric ops |
| **Key Exchange (ECIES)** | Lit Protocol SDK | `^6.x` | Production-grade threshold ECIES: encrypt job keys to specific wallet addresses, decrypt via wallet signature. Replaces insecure demo key exchange |
| **State Management** | React Context + `useReducer` | — | Sufficient for demo scale; no Redux needed |
| **Notifications** | react-hot-toast | `^2.4` | Lightweight toast notifications for tx status |
| **Icons** | Lucide React | `^0.400` | Consistent icon set |

### 5.1 Package.json (frontend/)

```json
{
  "name": "chainlancer-frontend",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "copy-abis": "node scripts/copy-abis.mjs"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.0",
    "ethers": "^6.13.0",
    "react-hot-toast": "^2.4.1",
    "lucide-react": "^0.400.0",
    "pinata-web3": "^0.5.0",
    "@lit-protocol/lit-node-client": "^6.0.0",
    "@lit-protocol/constants": "^6.0.0",
    "@lit-protocol/auth-helpers": "^6.0.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^2.4.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "typescript": "~5.4.0",
    "vite": "^5.4.0"
  }
}
```

---

## 6. Frontend Architecture

### 6.1 Provider Hierarchy

```tsx
// src/App.tsx
<BrowserRouter>
  <WalletProvider>           {/* MetaMask connection, signer, chainId */}
    <ContractProvider>       {/* Typed contract instances, re-instantiate on signer change */}
      <Toaster />            {/* Global toast notifications */}
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/jobs" element={<BrowseJobs />} />
          <Route path="/jobs/new" element={<PostJob />} />
          <Route path="/jobs/:jobId" element={<JobDetail />} />
          <Route path="/jobs/:jobId/apply" element={<ApplyJob />} />
          <Route path="/jobs/:jobId/dispute/:disputeId" element={<DisputeDetail />} />
          <Route path="/judge" element={<JudgeDashboard />} />
          <Route path="/admin" element={<AdminDashboard />} />
          <Route path="/profile/:address" element={<Profile />} />
          <Route path="/wallet" element={<Wallet />} />
        </Routes>
      </Layout>
    </ContractProvider>
  </WalletProvider>
</BrowserRouter>
```

### 6.2 WalletContext Specification

```typescript
// src/contexts/WalletContext.tsx

interface WalletState {
  isConnected: boolean;
  address: string | null;
  chainId: number | null;
  signer: ethers.Signer | null;
  provider: ethers.BrowserProvider | null;
  isCorrectNetwork: boolean;          // true if chainId matches target network
}

interface WalletActions {
  connect: () => Promise<void>;        // Request MetaMask connection
  disconnect: () => void;              // Clear local state (MetaMask stays connected)
  switchNetwork: () => Promise<void>;  // Request network switch to target chain
}
```

**Implementation notes:**
- Listen for `accountsChanged` and `chainChanged` events on `window.ethereum`
- On network mismatch, show a banner prompting the user to switch
- Store the last connected address in `localStorage` for auto-reconnect on page reload

### 6.3 ContractContext Specification

```typescript
// src/contexts/ContractContext.tsx

interface ContractInstances {
  jobEscrow: ethers.Contract;        // Typed via ABI
  dispute: ethers.Contract;
  reputation: ethers.Contract;
  dataAvailability: ethers.Contract;
  mockUSDC: ethers.Contract;
}
```

**Implementation notes:**
- Re-instantiate all contracts when the signer changes (wallet connect/disconnect/account switch)
- For read-only queries, use the provider (no signer needed)
- For write operations, use the signer
- Import ABIs from `src/abis/*.json` — these are copied from `artifacts/contracts/*/` via a build script

### 6.4 ABI Copy Script

Create `frontend/scripts/copy-abis.mjs`:

```javascript
// Reads compiled artifacts from the root artifacts/ directory
// and copies only the ABI portion into frontend/src/abis/

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const ABI_DIR = join(__dirname, '..', 'src', 'abis');

const contracts = [
  { name: 'JobEscrow',         path: 'contracts/core/JobEscrow.sol/JobEscrow.json' },
  { name: 'Dispute',           path: 'contracts/core/Dispute.sol/Dispute.json' },
  { name: 'Reputation',        path: 'contracts/core/Reputation.sol/Reputation.json' },
  { name: 'DataAvailability',  path: 'contracts/core/DataAvailability.sol/DataAvailability.json' },
  { name: 'MockUSDC',          path: 'contracts/mocks/MockUSDC.sol/MockUSDC.json' },
];

mkdirSync(ABI_DIR, { recursive: true });

for (const c of contracts) {
  const artifact = JSON.parse(readFileSync(join(ROOT, 'artifacts', c.path), 'utf-8'));
  writeFileSync(
    join(ABI_DIR, `${c.name}.json`),
    JSON.stringify(artifact.abi, null, 2)
  );
  console.log(`  ✓ ${c.name}.json`);
}
```

Run with `npm run copy-abis` after compiling contracts.

---

## 7. IPFS Integration (Pinata)

### 7.1 Overview

All content uploaded to IPFS is **encrypted client-side** before upload. The IPFS layer never sees plaintext. The flow is:

```
Plaintext → AES-256-GCM Encrypt (browser) → Ciphertext → Pinata Upload → CID
CID → Pinata/IPFS Gateway Fetch → Ciphertext → AES-256-GCM Decrypt (browser) → Plaintext
```

### 7.2 Pinata SDK Wrapper

```typescript
// src/ipfs/pinata.ts

import { PinataSDK } from "pinata-web3";

const pinata = new PinataSDK({
  pinataJwt: import.meta.env.VITE_PINATA_JWT,
  pinataGateway: import.meta.env.VITE_PINATA_GATEWAY,  // e.g., "your-gateway.mypinata.cloud"
});

/**
 * Upload encrypted content to Pinata.
 * @param encryptedData - The AES-256-GCM encrypted payload (ciphertext + IV + tag)
 * @param metadata - Human-readable metadata for Pinata dashboard (NOT content — just labels)
 * @returns The IPFS CID
 */
export async function uploadToPinata(
  encryptedData: Uint8Array,
  metadata: { name: string; jobId: number; contentType: string }
): Promise<string> {
  const file = new File([encryptedData], metadata.name, {
    type: "application/octet-stream",
  });

  const result = await pinata.upload.file(file).addMetadata({
    name: metadata.name,
    keyValues: {
      jobId: String(metadata.jobId),
      contentType: metadata.contentType,
    },
  });

  return result.IpfsHash;  // This is the CID
}

/**
 * Retrieve encrypted content from IPFS gateway.
 * @param cid - The IPFS CID
 * @returns The raw encrypted bytes
 */
export async function fetchFromIPFS(cid: string): Promise<Uint8Array> {
  const gatewayUrl = `https://${import.meta.env.VITE_PINATA_GATEWAY}/ipfs/${cid}`;
  const response = await fetch(gatewayUrl);
  if (!response.ok) {
    throw new Error(`IPFS fetch failed: ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}
```

### 7.3 Upload + On-Chain Registration Flow

Every IPFS upload in the dApp follows this sequence:

```
1. User provides plaintext content (agreement text, deliverable file, proposal, evidence)
2. Frontend generates or retrieves K_job (AES-256 key)
3. Frontend encrypts plaintext → ciphertext (AES-256-GCM, random IV)
4. Frontend uploads ciphertext to Pinata → receives CID
5. Frontend computes encryptedHash = keccak256(ciphertext)
6. Frontend calls the on-chain function with (CID, encryptedHash, ...)
   - postJob() → agreementCID + agreementHash
   - submitMilestone() → deliverableCID + deliverableHash
   - submitEvidence() → evidenceCID + evidenceHash
7. On-chain function internally calls DataAvailability.registerCID()
8. CIDRegistered event emitted (consumed by any off-chain listener)
```

### 7.4 Encrypted Payload Format

All encrypted IPFS payloads follow a consistent binary format:

```
┌──────────────────────────────────────────────────────────┐
│ Byte Layout (for all encrypted IPFS content)             │
├────────────┬─────────────────────────────────────────────┤
│ Bytes 0-11 │ IV (12 bytes, random per encryption)        │
│ Bytes 12-N │ Ciphertext (AES-256-GCM encrypted payload)  │
│ Last 16    │ Authentication Tag (appended by GCM)         │
└────────────┴─────────────────────────────────────────────┘
```

For **agreements** specifically, the plaintext before encryption is:

```
┌──────────────────────────────────────────────────────────┐
│ Agreement Plaintext Layout                               │
├────────────────┬─────────────────────────────────────────┤
│ Bytes 0-31     │ Salt (32 bytes, random)                  │
│ Bytes 32-N     │ Agreement content (UTF-8 text)           │
└────────────────┴─────────────────────────────────────────┘
agreementHash = keccak256(salt || agreementContent)
```

### 7.5 Pinata Free Tier Limits

| Resource | Free Tier Limit | Sufficient for Demo? |
|----------|----------------|---------------------|
| Storage | 1 GB | ✅ Yes — encrypted text is tiny |
| Uploads | 200/day | ✅ Yes |
| Gateway requests | 200/day | ✅ Yes |
| Dedicated Gateway | 1 included | ✅ Yes |

---

## 8. Client-Side Cryptographic Module

All cryptography runs in the browser using the **Web Crypto API**. No private keys or plaintext ever leave the user's device.

### 8.1 Job Key Generation

```typescript
// src/crypto/jobKey.ts

/** Generate a random 256-bit symmetric key for a job */
export function generateJobKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

/** Generate a random 256-bit salt for agreement hash */
export function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}
```

### 8.2 AES-256-GCM Encryption / Decryption

```typescript
// src/crypto/aes.ts

/** Encrypt plaintext with AES-256-GCM. Returns IV + ciphertext (tag appended by GCM). */
export async function aesEncrypt(
  plaintext: Uint8Array,
  keyBytes: Uint8Array
): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));  // 96-bit IV
  const cryptoKey = await crypto.subtle.importKey(
    "raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt"]
  );
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    plaintext
  );
  // Concatenate: IV (12 bytes) + Ciphertext+Tag
  const result = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(ciphertext), iv.byteLength);
  return result;
}

/** Decrypt AES-256-GCM ciphertext. Input: IV + ciphertext (as produced by aesEncrypt). */
export async function aesDecrypt(
  encryptedData: Uint8Array,
  keyBytes: Uint8Array
): Promise<Uint8Array> {
  const iv = encryptedData.slice(0, 12);
  const ciphertext = encryptedData.slice(12);
  const cryptoKey = await crypto.subtle.importKey(
    "raw", keyBytes, { name: "AES-GCM" }, false, ["decrypt"]
  );
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    ciphertext
  );
  return new Uint8Array(plaintext);
}
```

### 8.3 Agreement Hash Computation

```typescript
// src/crypto/hash.ts
import { ethers } from "ethers";

/**
 * Compute agreementHash = keccak256(salt || plaintext)
 * This matches the on-chain verification.
 */
export function computeAgreementHash(salt: Uint8Array, plaintext: Uint8Array): string {
  const combined = new Uint8Array(salt.length + plaintext.length);
  combined.set(salt, 0);
  combined.set(plaintext, salt.length);
  return ethers.keccak256(combined);
}
```

### 8.4 ECIES Key Exchange via Lit Protocol

The job key $K_{job}$ must be securely shared with the freelancer (at job activation) and with the judge (during dispute key distribution). We use **Lit Protocol** for production-grade threshold ECIES, which provides:

- **Access-controlled encryption**: Encrypt data such that only a specific Ethereum address can decrypt it.
- **Wallet-based decryption**: The recipient proves ownership of their address by signing a message via MetaMask — no private key export required.
- **Threshold cryptography**: The Lit network splits decryption across multiple nodes, so no single party has the full key.

#### 8.4.1 Lit Protocol SDK Wrapper

```typescript
// src/crypto/litProtocol.ts

import * as LitJsSdk from "@lit-protocol/lit-node-client";
import { LitNetwork } from "@lit-protocol/constants";
import { ethers } from "ethers";

let litNodeClient: LitJsSdk.LitNodeClient | null = null;

/**
 * Initialize the Lit Protocol client (call once at app startup).
 * Uses the Datil-dev test network for the demo.
 */
export async function connectLitClient(): Promise<LitJsSdk.LitNodeClient> {
  if (litNodeClient) return litNodeClient;

  litNodeClient = new LitJsSdk.LitNodeClient({
    litNetwork: LitNetwork.DatilDev,   // Free test network — no payment required
    debug: false,
  });
  await litNodeClient.connect();
  return litNodeClient;
}

/**
 * Build an Access Control Condition that restricts decryption
 * to a specific Ethereum address.
 */
function buildAccessControlForAddress(address: string) {
  return [
    {
      contractAddress: "",
      standardContractType: "",
      chain: "ethereum",
      method: "",
      parameters: [":userAddress"],
      returnValueTest: {
        comparator: "=",
        value: address.toLowerCase(),
      },
    },
  ];
}

/**
 * Encrypt a job key so that only the specified recipient can decrypt.
 * Uses Lit Protocol's threshold encryption with an access control
 * condition bound to the recipient's Ethereum address.
 *
 * @param jobKeyBytes         The 256-bit job key as Uint8Array
 * @param recipientAddress    The Ethereum address allowed to decrypt
 * @returns                   { ciphertext, dataToEncryptHash } — store both on-chain or IPFS
 */
export async function encryptJobKeyForRecipient(
  jobKeyBytes: Uint8Array,
  recipientAddress: string
): Promise<{ ciphertext: string; dataToEncryptHash: string }> {
  const client = await connectLitClient();
  const accessControlConditions = buildAccessControlForAddress(recipientAddress);

  const { ciphertext, dataToEncryptHash } = await LitJsSdk.encryptString(
    {
      accessControlConditions,
      dataToEncrypt: ethers.hexlify(jobKeyBytes),
    },
    client
  );

  return { ciphertext, dataToEncryptHash };
}

/**
 * Decrypt a job key that was encrypted for the connected wallet's address.
 * The user will be prompted to sign a message via MetaMask to prove ownership.
 *
 * @param ciphertext           The encrypted ciphertext from encryptJobKeyForRecipient()
 * @param dataToEncryptHash    The hash returned alongside the ciphertext
 * @param recipientAddress     The address the data was encrypted for (must match connected wallet)
 * @returns                    The decrypted job key as Uint8Array
 */
export async function decryptJobKeyAsRecipient(
  ciphertext: string,
  dataToEncryptHash: string,
  recipientAddress: string
): Promise<Uint8Array> {
  const client = await connectLitClient();
  const accessControlConditions = buildAccessControlForAddress(recipientAddress);

  // Get auth signature from MetaMask
  const provider = new ethers.BrowserProvider((window as any).ethereum);
  const signer = await provider.getSigner();
  const authSig = await generateAuthSig(signer, recipientAddress);

  const decryptedString = await LitJsSdk.decryptToString(
    {
      accessControlConditions,
      ciphertext,
      dataToEncryptHash,
      authSig,
      chain: "ethereum",
    },
    client
  );

  return ethers.getBytes(decryptedString);
}

/**
 * Generate an EIP-4361 (SIWE) auth signature for Lit Protocol.
 */
async function generateAuthSig(
  signer: ethers.Signer,
  address: string
) {
  const domain = "localhost";
  const origin = "http://localhost:5173";
  const statement = "Sign this message to decrypt content on ChainLancer via Lit Protocol.";
  const expirationTime = new Date(Date.now() + 1000 * 60 * 60).toISOString(); // 1 hour

  const siweMessage = `${domain} wants you to sign in with your Ethereum account:\n${address}\n\n${statement}\n\nURI: ${origin}\nVersion: 1\nChain ID: 1\nNonce: ${Math.random().toString(36).slice(2)}\nIssued At: ${new Date().toISOString()}\nExpiration Time: ${expirationTime}`;

  const signature = await signer.signMessage(siweMessage);

  return {
    sig: signature,
    derivedVia: "web3.eth.personal.sign",
    signedMessage: siweMessage,
    address: address.toLowerCase(),
  };
}

/**
 * Disconnect the Lit client (call on wallet disconnect).
 */
export function disconnectLitClient(): void {
  if (litNodeClient) {
    litNodeClient.disconnect();
    litNodeClient = null;
  }
}
```

#### 8.4.2 Key Exchange Wrapper (High-Level API)

```typescript
// src/crypto/keyExchange.ts

import {
  encryptJobKeyForRecipient,
  decryptJobKeyAsRecipient,
} from "./litProtocol";
import { ethers } from "ethers";

/**
 * Encrypt K_job for the freelancer using Lit Protocol ECIES.
 * Called by the client at selectFreelancer().
 *
 * The returned { ciphertext, dataToEncryptHash } should be stored on-chain
 * (passed to the contract or stored via DataAvailability).
 */
export async function encryptForRecipient(
  jobKeyHex: string,
  recipientAddress: string
): Promise<{ ciphertext: string; dataToEncryptHash: string }> {
  const jobKeyBytes = ethers.getBytes(jobKeyHex);
  return encryptJobKeyForRecipient(jobKeyBytes, recipientAddress);
}

/**
 * Decrypt K_job as the recipient (freelancer or judge).
 * The connected wallet must match the recipientAddress.
 *
 * @returns Hex-encoded job key
 */
export async function decryptWithPrivateKey(
  ciphertext: string,
  dataToEncryptHash: string,
  recipientAddress: string
): Promise<string> {
  const jobKeyBytes = await decryptJobKeyAsRecipient(
    ciphertext,
    dataToEncryptHash,
    recipientAddress
  );
  return ethers.hexlify(jobKeyBytes);
}

/**
 * Encrypt K_job for the judge during dispute key distribution.
 * Called by client/freelancer when distributeKeyToJudge() is invoked.
 *
 * Uses the judge's ephemeral public key address from the dispute record.
 */
export async function encryptKeyForJudge(
  jobKeyHex: string,
  judgeAddress: string
): Promise<{ ciphertext: string; dataToEncryptHash: string }> {
  const jobKeyBytes = ethers.getBytes(jobKeyHex);
  return encryptJobKeyForRecipient(jobKeyBytes, judgeAddress);
}
```

#### 8.4.3 Key Exchange Flow Summary

**At `selectFreelancer()` (Client encrypts $K_{job}$ for Freelancer):**

```
1. Client retrieves K_job from localStorage
2. Client calls encryptForRecipient(K_job, freelancerAddress) via Lit Protocol
3. Lit SDK encrypts K_job with access control: only freelancerAddress can decrypt
4. Client stores { ciphertext, dataToEncryptHash } on-chain via selectFreelancer()
5. Freelancer retrieves encrypted data from on-chain
6. Freelancer calls decryptWithPrivateKey() — signs via MetaMask to prove identity
7. Lit network validates access control + returns decrypted K_job
8. Freelancer stores K_job in localStorage
```

**At `distributeKeyToJudge()` (Party encrypts $K_{job}$ for Judge):**

```
1. Client/Freelancer retrieves K_job from localStorage
2. Client/Freelancer retrieves judge address from dispute record
3. Client/Freelancer calls encryptKeyForJudge(K_job, judgeAddress) via Lit Protocol
4. Stores { ciphertext, dataToEncryptHash } on-chain via distributeKeyToJudge()
5. Judge retrieves encrypted key from on-chain
6. Judge calls decryptWithPrivateKey() — signs via MetaMask to prove identity
7. Lit network validates and returns decrypted K_job
8. Judge can now decrypt all IPFS content for the dispute
```

> **✅ Security**: Unlike the previous address-derived scheme, Lit Protocol ECIES ensures that **only the wallet owner** can decrypt. An observer who knows the address cannot derive the decryption key — they would need to produce a valid signature from the private key. This is production-grade cryptography suitable for real deployment.

### 8.5 Job Key Storage (Browser)

```typescript
// src/utils/storage.ts

const KEY_PREFIX = "chainlancer_job_key_";

/** Store a job key in localStorage (per-wallet, per-job) */
export function storeJobKey(walletAddress: string, jobId: number, key: Uint8Array): void {
  const storageKey = `${KEY_PREFIX}${walletAddress.toLowerCase()}_${jobId}`;
  localStorage.setItem(storageKey, ethers.hexlify(key));
}

/** Retrieve a job key from localStorage */
export function getJobKey(walletAddress: string, jobId: number): Uint8Array | null {
  const storageKey = `${KEY_PREFIX}${walletAddress.toLowerCase()}_${jobId}`;
  const hex = localStorage.getItem(storageKey);
  if (!hex) return null;
  return ethers.getBytes(hex);
}

/** Clear all job keys (e.g., on wallet disconnect) */
export function clearJobKeys(): void {
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(KEY_PREFIX)) keysToRemove.push(key);
  }
  keysToRemove.forEach((k) => localStorage.removeItem(k));
}
```

---

## 9. Contract Integration Layer

### 9.1 Hook Pattern — Transaction Lifecycle

Every contract write operation is wrapped in a hook that manages the **4-state transaction lifecycle**:

```typescript
// Pattern used by all write hooks

type TxStatus = "idle" | "pending" | "confirming" | "confirmed" | "error";

function useContractWrite<TArgs extends unknown[]>(
  contractMethod: (...args: TArgs) => Promise<ethers.ContractTransactionResponse>
) {
  const [status, setStatus] = useState<TxStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const execute = async (...args: TArgs) => {
    try {
      setStatus("pending");       // Waiting for user to confirm in MetaMask
      const tx = await contractMethod(...args);
      setTxHash(tx.hash);
      setStatus("confirming");    // Tx submitted, waiting for block confirmation
      toast.loading("Transaction submitted...");
      await tx.wait();
      setStatus("confirmed");     // Tx confirmed on-chain
      toast.success("Transaction confirmed!");
    } catch (err) {
      setStatus("error");
      setError(parseContractError(err));
      toast.error(parseContractError(err));
    }
  };

  return { execute, status, error, txHash };
}
```

### 9.2 Hook Inventory

```typescript
// src/hooks/useJobEscrow.ts

export function usePostJob()              // postJob(agreementHash, milestoneValues, deadlines, timeout, cid)
export function useApplyForJob()          // applyForJob(jobId, proposalHash)
export function useSelectFreelancer()     // selectFreelancer(jobId, freelancerAddr, encryptedKey)
export function useConfirmAndStake()      // confirmAndStake(jobId)
export function useRejectOffer()          // rejectOffer(jobId)
export function useSubmitMilestone()      // submitMilestone(jobId, milestoneIdx, hash, cid)
export function useApproveMilestone()     // approveMilestone(jobId, milestoneIdx)
export function useTriggerAutoApprove()   // triggerAutoApprove(jobId, milestoneIdx)
export function useRaiseDispute()         // raiseDispute(jobId, milestoneIdx)
export function useClaimAbandonment()     // claimAbandonment(jobId, milestoneIdx)
export function useCancelJob()            // cancelJob(jobId)
export function useRequestCancellation()  // requestCancellation(jobId)
export function useAcceptCancellation()   // acceptCancellation(jobId)
export function useWithdraw()             // withdraw()
export function useWithdrawExpiredJob()   // withdrawExpiredJob(jobId)

// src/hooks/useReputation.ts
export function useFreelancerProfile(address: string)  // Read freelancerProfiles[addr]
export function useClientProfile(address: string)      // Read clientProfiles[addr]
export function useClientTier(address: string)         // Read getClientTier(addr)

// src/hooks/useMockUSDC.ts
export function useMintUSDC()                          // mint(to, amount)
export function useApproveUSDC()                       // approve(spender, amount)
export function useUSDCBalance(address: string)        // balanceOf(addr)

// src/hooks/useJobList.ts
export function useJobList()                           // Read nextJobId, iterate jobs[0..n]
export function useJobDetail(jobId: number)            // Read jobs[jobId] + milestones + applications

// src/hooks/useJobEvents.ts
export function useJobEvents(jobId: number)            // Subscribe to contract events for a specific job

// src/hooks/useCountdown.ts
export function useCountdown(targetTimestamp: number)  // Returns { days, hours, minutes, seconds, isExpired }

// src/hooks/useDispute.ts
export function useSubmitEvidence()                    // submitEvidence(disputeId, evidenceHash, evidenceCID)
export function useCloseEvidencePhase()                // closeEvidencePhase(disputeId)
export function useDistributeKeyToJudge()              // distributeKeyToJudge(disputeId, encryptedJobKey)
export function useClaimKeyDefault()                   // claimKeyDefault(disputeId)
export function useSubmitRuling()                      // submitRuling(disputeId, ruling, reasoningHash, fShareBps, dSlashBps)
export function useExecuteRuling()                     // executeRuling(disputeId)
export function useDisputeDetail(disputeId: number)    // Read dispute details + evidence + deadlines
export function useJudgeDisputes(judgeAddress: string) // Read all disputes assigned to judge (via events)

// src/hooks/useAdmin.ts
export function useGrantRole()                         // grantRole(role, account) on any contract
export function useRevokeRole()                        // revokeRole(role, account)
export function useHasRole(role: string, addr: string) // hasRole(role, account) — read-only
export function useAssignJudge()                       // assignJudge(disputeId, judgeAddr, ephemeralPubKey)
export function useRoleHolders()                       // Enumerate role members via events
export function usePlatformStats()                     // Aggregate stats: nextJobId, nextDisputeId, etc.
```

### 9.3 Job List Retrieval Strategy

Since there is no subgraph or indexer in the demo, job listing is done by:

1. Read `nextJobId` from the contract → gives the total count
2. Iterate `jobs[0]` to `jobs[nextJobId - 1]`, calling `getJobInfo()` for each
3. Client-side filter by state (Open, Active, etc.) and role (client's jobs vs. all jobs)
4. For the demo (<50 jobs), this is efficient enough. For production, a subgraph would be used.

```typescript
// src/hooks/useJobList.ts

export function useJobList() {
  const { jobEscrow } = useContracts();
  const [jobs, setJobs] = useState<JobInfo[]>([]);

  useEffect(() => {
    async function fetchJobs() {
      const nextId = await jobEscrow.nextJobId();
      const promises = [];
      for (let i = 0; i < Number(nextId); i++) {
        promises.push(jobEscrow.getJobInfo(i));
      }
      const results = await Promise.all(promises);
      setJobs(results.map((r, i) => ({ jobId: i, ...parseJobInfo(r) })));
    }
    fetchJobs();
  }, [jobEscrow]);

  return jobs;
}
```

### 9.4 Event Subscriptions for Real-Time Updates

The frontend subscribes to key events for live UI updates:

```typescript
// src/hooks/useJobEvents.ts

export function useJobEvents(jobId: number) {
  const { jobEscrow } = useContracts();

  useEffect(() => {
    const filters = [
      jobEscrow.filters.ApplicationSubmitted(jobId),
      jobEscrow.filters.FreelancerSelected(jobId),
      jobEscrow.filters.JobActivated(jobId),
      jobEscrow.filters.MilestoneSubmitted(jobId),
      jobEscrow.filters.MilestoneApproved(jobId),
      jobEscrow.filters.MilestoneAutoApproved(jobId),
      jobEscrow.filters.DisputeRaised(jobId),
      jobEscrow.filters.JobCompleted(jobId),
      jobEscrow.filters.JobCancelled(jobId),
    ];

    const handler = () => {
      // Re-fetch job data on any event
      refetchJobDetail();
    };

    filters.forEach((f) => jobEscrow.on(f, handler));
    return () => {
      filters.forEach((f) => jobEscrow.off(f, handler));
    };
  }, [jobEscrow, jobId]);
}
```

---

## 10. Page-by-Page Specification

### 10.1 Dashboard (`/`)

**Purpose**: Landing page after wallet connection. Shows platform overview.

| Section | Content | Data Source |
|---------|---------|-------------|
| Welcome Banner | "ChainLancer — Decentralized Freelance Escrow" + connect wallet CTA | — |
| Network Status | Current chain, correct/wrong network indicator | `WalletContext` |
| My Active Jobs (if connected) | Cards showing user's active jobs (as client or freelancer) | `useJobList()` filtered by `address` |
| Platform Stats | Total jobs posted, total value escrowed, total completed | `nextJobId`, aggregate from events |
| Faucet Panel (testnet only) | "Mint 10,000 USDC" button + current USDC balance | `useMockUSDC` |

### 10.2 Browse Jobs (`/jobs`)

**Purpose**: Freelancers browse open jobs and apply.

| Section | Content | Data Source |
|---------|---------|-------------|
| Filter Bar | State filter (Open / Applications / All), search by job ID | Client-side filter |
| Job Cards | Grid/list of `JobCard` components showing: job ID, total value, milestone count, review timeout, client reputation badge, application count, time remaining (T_acceptance countdown) | `useJobList()` |
| Sort | By value (high→low), by creation date (newest first) | Client-side sort |

**JobCard** shows:
- Job ID, total value (formatted as `$10,000.00 USDC`)
- Milestone count (e.g., "3 milestones")
- Review timeout (e.g., "7-day review")
- Client reputation: `ReputationBadge` (tier + score)
- Application count (e.g., "5 applicants")
- Status badge (Open / Applications)
- "View Details" button → `/jobs/:jobId`

### 10.3 Post Job (`/jobs/new`)

**Purpose**: Client creates a new job with escrow.

**Form Fields:**

| Field | Type | Validation | Notes |
|-------|------|------------|-------|
| Agreement Text | `<textarea>` (multiline) | Required, min 50 chars | The actual job description / scope of work |
| Review Timeout | `<select>` dropdown | Must be one of {1d, 3d, 7d, 14d, 21d, 30d} | Maps to seconds: 86400, 259200, 604800, etc. |
| Milestones | Dynamic list (add/remove rows) | Min 1, max 20 per row: value + deadline | Each row: `value` (USDC input) + `deadline` (date picker) |
| — Milestone Value | `<input type="number">` | Each ≥ 10% of total | Auto-validates against 10% minimum |
| — Milestone Deadline | `<input type="date">` | Must be in future | Converted to Unix timestamp |

**Submit Flow:**

```
1. Validate form inputs
2. Calculate totalValue = sum of milestone values
3. Calculate behaviorBond = totalValue * bondBps (based on client tier)
4. Display summary: "You will lock $X USDC (escrow) + $Y USDC (behavior bond) = $Z total"
5. User confirms →
6. Check USDC allowance; if insufficient, prompt approve(jobEscrow, totalValue + bond)
7. Generate K_job = generateJobKey()
8. Generate salt = generateSalt()
9. Compute agreementHash = keccak256(salt || agreementText)
10. Encrypt payload = AES-256-GCM(K_job, salt || agreementText)
11. Upload encrypted payload to Pinata → get agreementCID
12. Call postJob(agreementHash, milestoneValues, milestoneDeadlines, reviewTimeout, agreementCID)
13. Wait for tx confirmation
14. Store K_job in localStorage: storeJobKey(walletAddress, newJobId, K_job)
15. Show success → redirect to /jobs/:newJobId
```

### 10.4 Job Detail (`/jobs/:jobId`)

**Purpose**: Central page for all job interactions. Content is **context-aware** based on user role and job state.

#### Layout

```
┌─────────────────────────────────────────────────────────────┐
│  Job #42 — Web App Development            Status: ACTIVE    │
│  Client: 0xABC...123 (Gold ⭐)    Freelancer: 0xDEF...456  │
│  Total Value: $10,000 USDC        Review Timeout: 7 days    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─ Milestone Timeline ──────────────────────────────────┐  │
│  │  MS 1: $2,000 ✅ Approved    |  MS 2: $3,000 🔄 In   │  │
│  │                              |  Review (5d 3h left)   │  │
│  │  MS 3: $5,000 ⏳ Pending     |  Deadline: Apr 15      │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌─ Actions Panel (context-aware) ───────────────────────┐  │
│  │  [Approve Milestone 2]  [Raise Dispute on MS 2]       │  │
│  │  [Request Cancellation]                               │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌─ Applications (if state == Applications) ─────────────┐  │
│  │  Freelancer 0xDEF...456  Score: 850  [Select]         │  │
│  │  Freelancer 0x789...012  Score: 420  [Select]         │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌─ Agreement ───────────────────────────────────────────┐  │
│  │  [View Decrypted Agreement] (if user has K_job)       │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌─ Event Log ───────────────────────────────────────────┐  │
│  │  Mar 20 — Job posted by 0xABC...                      │  │
│  │  Mar 21 — 0xDEF applied                               │  │
│  │  Mar 22 — 0xDEF selected, stake deadline: Mar 25      │  │
│  │  Mar 23 — 0xDEF staked, job active                    │  │
│  │  Mar 25 — MS 1 submitted                              │  │
│  │  Mar 26 — MS 1 approved                               │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

#### Context-Aware Action Buttons

| User Role | Job State | Milestone State | Available Actions |
|-----------|-----------|-----------------|-------------------|
| Client | Open / Applications | — | Cancel Job |
| Client | Applications (no selection) | — | Select Freelancer (from application list) |
| Client | Applications (selected) | — | Cancel Job, Reselect (if T_STAKE expired) |
| Client | Active | Pending | Claim Abandonment (if deadline passed) |
| Client | Active | InReview | Approve Milestone, Raise Dispute |
| Client | Active | — | Request Cancellation (if no MS in review/disputed) |
| Freelancer | Applications (selected, self) | — | Confirm & Stake, Reject Offer |
| Freelancer | Active | Pending | Submit Milestone |
| Freelancer | Active | InReview | Raise Dispute |
| Freelancer | Active | — | Request Cancellation |
| Either | Active (cancel pending) | — | Accept Cancellation (counterparty) |
| Anyone | Active | InReview (timeout expired) | Trigger Auto-Approve |
| Anyone | Open/Applications (T_acceptance expired) | — | Withdraw Expired Job (client only) |

### 10.5 Apply for Job (`/jobs/:jobId/apply`)

**Purpose**: Freelancer submits an application with an optional proposal.

**Form Fields:**

| Field | Type | Validation | Notes |
|-------|------|------------|-------|
| Proposal Text | `<textarea>` | Optional | Encrypted and uploaded to IPFS if provided |

**Submit Flow:**

```
1. If proposal text provided:
   a. Encrypt proposal with a temporary key (or plaintext for proposals — 
      proposals are not secret per the workflow design, so plaintext upload is acceptable)
   b. Upload to Pinata → get proposalCID
   c. Compute proposalHash = keccak256(proposalText)
2. If no proposal: proposalHash = bytes32(0)
3. Call applyForJob(jobId, proposalHash)
4. Wait for tx confirmation
5. Show success toast → redirect to /jobs/:jobId
```

> **Design decision**: Proposals are **not encrypted** in the demo because they are meant to be readable by the client before the job key is shared. The client needs to evaluate proposals without possessing the freelancer's key. This matches the workflow design where proposals are public.

### 10.6 Dispute Detail (`/jobs/:jobId/dispute/:disputeId`)

**Purpose**: Show dispute timeline and evidence. Client/Freelancer can submit evidence.

| Section | Content |
|---------|---------|
| Dispute Header | Dispute ID, milestone under dispute, initiator, current phase |
| Phase Timeline | Visual: Evidence → AwaitingJudge → KeyDistribution → UnderReview → Ruled → Executed |
| Evidence List | Submitted evidence items with timestamps, submitter, CID links |
| Submit Evidence (if in Evidence phase) | File upload + text area → encrypt → IPFS → submitEvidence() |
| Distribute Key (if in KeyDistribution phase) | Encrypt $K_{job}$ for judge via Lit Protocol → distributeKeyToJudge() |
| Countdown | Evidence deadline countdown, key distribution deadline, ruling deadline |
| Status Banner | "Waiting for judge assignment" / "Distribute your key" / "Awaiting ruling" / "Ruling: Freelancer Wins" |

> **Note**: Client and Freelancer both have a "Distribute Key" button during the KeyDistribution phase. The judge views and acts on disputes through the dedicated **Judge Dashboard** (§10.8).

### 10.7 Profile (`/profile/:address`)

**Purpose**: Display user's soulbound reputation.

| Section | Content | Data Source |
|---------|---------|-------------|
| Header | Address, tier badge (New/Bronze/Silver/Gold) | `getClientTier()` or computed from profile |
| Freelancer Stats | Total value completed, jobs completed, disputes lost, reputation score | `getFreelancerProfile()` |
| Client Stats | Total value completed, jobs posted/completed, cancellation rate, auto-approve rate, reputation score | `getClientProfile()` |
| Dual Profile | Show both freelancer and client profiles if the address has activity in both roles | Both profile read hooks |

### 10.8 Judge Dashboard (`/judge`)

**Purpose**: Dedicated interface for judges to view assigned disputes, decrypt evidence, and submit rulings. Only accessible when the connected wallet has `PLATFORM_JUDGE` role.

#### Layout

```
┌─────────────────────────────────────────────────────────────┐
│  ⚖️ Judge Dashboard                     Connected: 0xJUDGE  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─ Assigned Disputes ───────────────────────────────────┐  │
│  │                                                       │  │
│  │  Dispute #3  │ Job #7 MS 2  │ Phase: KeyDistribution  │  │
│  │  Client: 0xABC  Freelancer: 0xDEF                     │  │
│  │  Key Dist Deadline: 2d 5h   │ [View Details]          │  │
│  │                                                       │  │
│  │  Dispute #5  │ Job #12 MS 1 │ Phase: UnderReview      │  │
│  │  Client: 0x123  Freelancer: 0x456                     │  │
│  │  Ruling Deadline: 12d 8h    │ [View Details]          │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌─ Dispute #5 — Review Panel ───────────────────────────┐  │
│  │                                                       │  │
│  │  ┌── Decrypt Keys ────────────────────────────────┐   │  │
│  │  │ Client Key: ✅ Received   [Decrypt K_job]      │   │  │
│  │  │ Freelancer Key: ✅ Received                    │   │  │
│  │  │ K_job Status: 🔓 Decrypted                     │   │  │
│  │  └────────────────────────────────────────────────┘   │  │
│  │                                                       │  │
│  │  ┌── Agreement (Decrypted) ───────────────────────┐   │  │
│  │  │ "Build a React dashboard with real-time..."    │   │  │
│  │  └────────────────────────────────────────────────┘   │  │
│  │                                                       │  │
│  │  ┌── Deliverable (Decrypted) ─────────────────────┐   │  │
│  │  │ "Completed dashboard with charts, filters..."  │   │  │
│  │  └────────────────────────────────────────────────┘   │  │
│  │                                                       │  │
│  │  ┌── Evidence ────────────────────────────────────┐   │  │
│  │  │ Client evidence: "Deliverable missing X..."    │   │  │
│  │  │ Freelancer evidence: "X was not in scope..."   │   │  │
│  │  └────────────────────────────────────────────────┘   │  │
│  │                                                       │  │
│  │  ┌── Submit Ruling ───────────────────────────────┐   │  │
│  │  │ Outcome: [FreelancerWins ▾]                    │   │  │
│  │  │ Freelancer Share: [7500] BPS (75%)             │   │  │
│  │  │ Deposit Slash: [0] BPS (0%)                    │   │  │
│  │  │ Reasoning: [textarea for written reasoning]    │   │  │
│  │  │                                                │   │  │
│  │  │ [Submit Ruling] [Execute Ruling]               │   │  │
│  │  └────────────────────────────────────────────────┘   │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

| Section | Content | Data Source |
|---------|---------|-------------|
| Role Gate | Show "Access Denied" if connected wallet lacks `PLATFORM_JUDGE` role | `hasRole(PLATFORM_JUDGE, address)` |
| Dispute Queue | List of all disputes where `judge == connectedAddress` | `JudgeAssigned` events filtered by address |
| Dispute Detail Pane | Selected dispute details: job ID, milestone, parties, deadlines | `getDisputeDetails()`, `getDisputeDeadlines()` |
| Key Decryption | Retrieve encrypted keys from both parties → decrypt $K_{job}$ via Lit Protocol | `getEncryptedKey()` → `decryptJobKeyAsRecipient()` |
| Decrypted Content | Once $K_{job}$ is available: fetch & decrypt agreement, deliverable, and evidence from IPFS | `fetchFromIPFS()` → `aesDecrypt()` |
| Evidence Timeline | Chronological list of all evidence submissions with decrypted content | `getEvidenceCount()`, `getEvidence()` |
| Ruling Form | Dropdown for outcome (FreelancerWins/ClientWins/Inconclusive), BPS inputs for freelancerShare and depositSlash, textarea for reasoning | Inputs validated per contract rules |
| Submit Ruling | Compute `reasoningHash = keccak256(reasoningText)`, call `submitRuling()` | `useSubmitRuling()` |
| Execute Ruling | After ruling is submitted, call `executeRuling()` to apply funds redistribution | `useExecuteRuling()` |

**Judge Workflow:**

```
1. Judge connects wallet → navigates to /judge
2. System checks hasRole(PLATFORM_JUDGE, address) — if false, shows "Access Denied"
3. Judge sees list of assigned disputes (from JudgeAssigned events)
4. Judge selects a dispute → expands review panel
5. If phase == KeyDistribution: wait for both parties to submit keys
6. If phase == UnderReview:
   a. Judge clicks "Decrypt K_job" → Lit Protocol prompts MetaMask signature
   b. Judge decrypts both encrypted keys → derives K_job
   c. System fetches agreement CID, deliverable CID, evidence CIDs from IPFS
   d. System decrypts all content with K_job → displays in review panel
7. Judge reviews agreement, deliverable, and evidence
8. Judge fills in ruling form:
   - Outcome: FreelancerWins / ClientWins / Inconclusive
   - freelancerShareBps: 0-10000 (validated: >5000 if FreelancerWins, <5000 if ClientWins)
   - depositSlashBps: 0-5000
   - Reasoning text (hashed on-chain, plaintext stored in IPFS for transparency)
9. Judge clicks "Submit Ruling" → MetaMask confirmation
10. Judge clicks "Execute Ruling" → funds redistributed via JobEscrow
```

### 10.9 Admin Dashboard (`/admin`)

**Purpose**: Platform administration interface for role management, judge assignment, and platform monitoring. Only accessible when the connected wallet has `DEFAULT_ADMIN_ROLE` or `PLATFORM_ADMIN` role.

#### Layout

```
┌─────────────────────────────────────────────────────────────┐
│  🛡️ Admin Dashboard                    Connected: 0xADMIN   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─ Platform Statistics ─────────────────────────────────┐  │
│  │  Total Jobs: 42    Active: 8    Completed: 31         │  │
│  │  Total Escrowed: $125,000 USDC                        │  │
│  │  Active Disputes: 3    Resolved: 12                   │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌─ Role Management ────────────────────────────────────┐   │
│  │                                                       │  │
│  │  PLATFORM_JUDGE Holders:                              │  │
│  │    0xJUDGE1...abc  [Revoke]                           │  │
│  │    0xJUDGE2...def  [Revoke]                           │  │
│  │                                                       │  │
│  │  PLATFORM_ADMIN Holders:                              │  │
│  │    0xADMIN...123   [Revoke]                           │  │
│  │                                                       │  │
│  │  Grant New Role:                                      │  │
│  │    Role: [PLATFORM_JUDGE ▾]                           │  │
│  │    Address: [0x________________]                      │  │
│  │    Contract: [Dispute ▾]                              │  │
│  │    [Grant Role]                                       │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌─ Pending Disputes (Awaiting Judge) ──────────────────┐   │
│  │                                                       │  │
│  │  Dispute #7  │ Job #15 MS 3  │ Phase: AwaitingJudge   │  │
│  │  Client: 0xABC  Freelancer: 0xDEF                     │  │
│  │  Evidence Closed: Mar 28                               │  │
│  │  Assign Judge: [0x________] Eph. PubKey: [0x_____]    │  │
│  │  [Assign Judge]                                       │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌─ Contract Controls ──────────────────────────────────┐   │
│  │  JobEscrow:  [Paused: No]  [Pause]                    │  │
│  │  Dispute:    [Paused: No]  [Pause]                    │  │
│  │  Reputation: [Paused: No]  [Pause]                    │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

| Section | Content | Data Source |
|---------|---------|-------------|
| Role Gate | Show "Access Denied" if connected wallet lacks `DEFAULT_ADMIN_ROLE` | `hasRole(DEFAULT_ADMIN_ROLE, address)` |
| Platform Stats | Total jobs posted, active jobs, completed jobs, escrowed value, dispute counts | `nextJobId`, `nextDisputeId`, iterate for aggregate |
| Role Management — View | Table of current role holders per role type | `RoleGranted` / `RoleRevoked` events |
| Role Management — Grant | Form: select role, enter address, select contract → call `grantRole()` | `useGrantRole()` |
| Role Management — Revoke | "Revoke" button per role holder → call `revokeRole()` | `useRevokeRole()` |
| Pending Disputes | List disputes in `AwaitingJudge` phase | Iterate `disputes[0..nextDisputeId]` filtering by phase |
| Judge Assignment | Form per pending dispute: judge address + ephemeral public key → call `assignJudge()` | `useAssignJudge()` |
| Contract Pause/Unpause | Toggle buttons per contract (if Pausable is implemented) | `paused()` read + `pause()` / `unpause()` write |

**Admin Workflow — Assigning a Judge:**

```
1. Admin connects wallet → navigates to /admin
2. System checks hasRole(DEFAULT_ADMIN_ROLE, address) — if false, shows "Access Denied"
3. Admin views "Pending Disputes" section → sees disputes in AwaitingJudge phase
4. Admin enters judge address in the assignment form
5. Admin generates an ephemeral key pair for the dispute (or enters a pre-generated one)
6. Admin clicks "Assign Judge" → calls assignJudge(disputeId, judgeAddr, ephemeralPubKey)
7. Contract grants PLATFORM_JUDGE role to the judge and transitions dispute to KeyDistribution
8. Judge now sees the dispute in their Judge Dashboard
```

### 10.10 Wallet (`/wallet`)

**Purpose**: Manage withdrawable balance and USDC.

| Section | Content |
|---------|---------|
| Withdrawable Balance | Amount available to withdraw (from `withdrawableBalances[address]`) |
| Withdraw Button | Calls `withdraw()` — TransactionButton with lifecycle states |
| USDC Balance | Current wallet USDC balance (`usdc.balanceOf(address)`) |
| USDC Allowance | Current allowance to JobEscrow (`usdc.allowance(address, jobEscrow)`) |
| Approve Button | Approve JobEscrow for max USDC spending |
| Faucet (testnet) | Mint 10,000 USDC to connected wallet |

---

## 11. Local Desktop Deployment

The demo runs entirely on the presenter's laptop. No cloud services are needed beyond Pinata (IPFS) and the EVM testnet.

### 11.1 Prerequisites

| Item | Details |
|------|---------|
| Node.js | v18+ (LTS recommended) |
| npm | v9+ (bundled with Node.js) |
| MetaMask | Browser extension with 4 accounts configured |
| Git | To clone the repository |

### 11.2 One-Command Startup

```bash
# 1. Clone and install
git clone https://github.com/Michael-wzl/ChainLancer.git
cd ChainLancer/frontend
npm install

# 2. Copy and configure environment
cp .env.example .env
# Edit .env with contract addresses and Pinata credentials

# 3. Copy ABIs from compiled contracts
npm run copy-abis

# 4. Start the dev server
npm run dev
# → App available at http://localhost:5173
```

### 11.3 Option A: Using Hardhat Local Network (Recommended for Demo)

For the best demo experience (fast transactions, time manipulation for auto-approve), use a local Hardhat node:

```bash
# Terminal 1: Start Hardhat node
cd ChainLancer
npx hardhat node
# → Local RPC at http://127.0.0.1:8545

# Terminal 2: Deploy contracts + seed data
npx hardhat run scripts/deploy.ts --network localhost
npx hardhat run scripts/seed.ts --network localhost
# → Contract addresses printed to console — copy to frontend/.env

# Terminal 3: Start frontend
cd frontend
npm run dev
```

**MetaMask Configuration for Hardhat:**
1. Add Custom Network: Name = "Hardhat Local", RPC = `http://127.0.0.1:8545`, Chain ID = `31337`, Symbol = `ETH`
2. Import Hardhat's pre-funded accounts (private keys printed when `npx hardhat node` starts)
3. Assign accounts: Account 0 = Admin/Deployer, Account 1 = Client, Account 2 = Freelancer, Account 3 = Judge

**Time Manipulation for Auto-Approve Demo:**

```bash
# Fast-forward time by 7 days (604800 seconds) for auto-approve demo
curl -X POST http://127.0.0.1:8545 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"evm_increaseTime","params":[604800],"id":1}'

curl -X POST http://127.0.0.1:8545 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"evm_mine","params":[],"id":2}'
```

### 11.4 Option B: Using EVM Testnet (Base Sepolia)

If the presenter prefers a live testnet:

1. Deploy contracts via Remix IDE (§3.2) or Hardhat (`npx hardhat run scripts/deploy.ts --network baseSepolia`)
2. Update `frontend/.env` with deployed contract addresses
3. Run `npm run dev` — the frontend connects to Base Sepolia via MetaMask's injected provider
4. Ensure all 4 MetaMask accounts have testnet ETH from the Base Sepolia faucet

### 11.5 Lit Protocol Configuration

Lit Protocol requires no additional setup for the demo — the SDK connects to the **Datil-dev** test network automatically. No API keys or billing accounts are needed for the free test network.

The Lit client initializes lazily on first encryption/decryption operation:

```typescript
// No setup required — the LitNodeClient connects on first use
// The Datil-dev network is free and does not require authentication
```

> **Note**: First-time Lit Protocol operations may take 2-3 seconds as the client connects to the Lit network. Subsequent operations are fast. For the demo, initialize the Lit client on page load to avoid latency during the presentation.

---

## 12. Demo Script — Board Presentation

This section provides the **exact step-by-step demo flow** for the board meeting. Each step maps to a UI action that the presenter performs live.

### 12.1 Pre-Demo Setup (Before the Meeting)

| # | Action | Where |
|---|--------|-------|
| 1 | Start Hardhat node (`npx hardhat node`) | Terminal 1 |
| 2 | Deploy all contracts + seed data (`npx hardhat run scripts/deploy.ts --network localhost`) | Terminal 2 |
| 3 | Role-wiring is handled by deploy script automatically | — |
| 4 | Import 4 Hardhat accounts into MetaMask: Deployer/Admin, Client, Freelancer, Judge | MetaMask |
| 5 | Configure MetaMask custom network: RPC `http://127.0.0.1:8545`, Chain ID `31337` | MetaMask |
| 6 | Copy deployed contract addresses to `frontend/.env` | `.env` |
| 7 | Start frontend (`cd frontend && npm run dev`) | Terminal 3 |
| 8 | Verify the app loads at `http://localhost:5173` and connects to MetaMask | Browser |

### 12.2 Live Demo Flow (15–20 Minutes)

#### Act 1 — Setup (2 min)

| Step | Persona | Action | What the Board Sees |
|------|---------|--------|---------------------|
| 1 | Presenter | Open ChainLancer dApp in browser | Landing page with "Connect Wallet" |
| 2 | Client | Connect MetaMask (Client account) | Dashboard shows connected address, network badge |
| 3 | Client | Click "Mint USDC" on Faucet Panel | USDC balance updates to 10,000 USDC |
| 4 | Client | Click "Approve USDC" for JobEscrow | Toast: "Approval confirmed" |

#### Act 2 — Client Posts a Job (3 min)

| Step | Persona | Action | What the Board Sees |
|------|---------|--------|---------------------|
| 5 | Client | Navigate to "Post Job" | Post Job form appears |
| 6 | Client | Fill in: Agreement text ("Build a React dashboard..."), 7-day review, 2 milestones ($2,000 + $3,000) | Form populated |
| 7 | Client | Click "Post Job" → Confirm in MetaMask | Loading spinner → "Job #0 created!" toast |
| 8 | Client | Redirected to Job Detail page | Job #0 displayed: OPEN state, 2 milestones, $5,000 total, behavior bond shown |

**Talking point**: "The client's funds are now locked in the smart contract. The agreement is encrypted and stored on IPFS — only the job key holder can read it."

#### Act 3 — Freelancer Applies & Gets Selected (3 min)

| Step | Persona | Action | What the Board Sees |
|------|---------|--------|---------------------|
| 9 | Freelancer | Switch MetaMask to Freelancer account | Dashboard updates to freelancer's address |
| 10 | Freelancer | Mint USDC + Approve (for deposit) | Balance updated |
| 11 | Freelancer | Navigate to "Browse Jobs" | Job #0 appears in the list |
| 12 | Freelancer | Click "View Details" → Click "Apply" | Application form → submit → "Applied!" toast |
| 13 | Client | Switch to Client account | Job Detail shows "1 applicant" |
| 14 | Client | Click "Select" on the freelancer | MetaMask confirm → "Freelancer selected!" |
| 15 | Freelancer | Switch to Freelancer account → Job Detail | "You've been selected! Stake within 3 days" banner |
| 16 | Freelancer | Click "Confirm & Stake" | MetaMask confirm → Job transitions to ACTIVE |

**Talking point**: "The freelancer has staked a 5% deposit as skin-in-the-game. Both parties now have funds locked — aligned incentives."

#### Act 4 — Milestone Submission & Approval (4 min)

| Step | Persona | Action | What the Board Sees |
|------|---------|--------|---------------------|
| 17 | Freelancer | Click "Submit Milestone 1" on Job Detail | Upload form: text area for deliverable |
| 18 | Freelancer | Type deliverable content → Click "Submit" | Content encrypted → uploaded to IPFS → tx confirmed |
| 19 | Freelancer | See milestone status change to "In Review" | Countdown timer: "Client has 7 days to review" |
| 20 | Client | Switch to Client account → Job Detail | MS 1 shows "In Review" with "Approve" button |
| 21 | Client | Click "View Deliverable" | Fetches from IPFS → decrypts → displays plaintext |
| 22 | Client | Click "Approve Milestone 1" | MetaMask confirm → MS 1 → Approved, funds released |

**Talking point**: "Funds are released automatically minus a 2% protocol fee. The freelancer can withdraw at any time using the pull-over-push pattern."

#### Act 5 — Auto-Approve Demo (2 min)

| Step | Persona | Action | What the Board Sees |
|------|---------|--------|---------------------|
| 23 | Freelancer | Submit Milestone 2 | MS 2 → In Review, countdown starts |
| 24 | Presenter | (If on local Hardhat) Fast-forward time via console | Timer shows "Expired" |
| 25 | Anyone | Click "Trigger Auto-Approve" | MS 2 → Auto-Approved, funds released, Job → COMPLETED |

**Talking point**: "If the client disappears, the freelancer is protected — funds are auto-released after the review timeout they agreed to upfront."

> **Note for local demo**: If deploying on a live testnet, the auto-approve demo requires waiting the actual timeout. For a board demo, deploy on **Hardhat Network** locally and use `evm_increaseTime` + `evm_mine` to fast-forward. Alternatively, set a very short review timeout (1 day) and prepare this milestone in advance.

#### Act 6 — Reputation & Withdrawal (2 min)

| Step | Persona | Action | What the Board Sees |
|------|---------|--------|---------------------|
| 26 | Freelancer | Navigate to Profile page | Reputation score updated, "1 job completed, $5,000 value" |
| 27 | Client | Navigate to Profile page | Client score updated, "1 job completed" |
| 28 | Freelancer | Navigate to Wallet page | Withdrawable balance shows earned amount |
| 29 | Freelancer | Click "Withdraw" | USDC transferred to wallet, balance updates |

**Talking point**: "Reputation is soulbound — non-transferable, on-chain, and value-weighted. It cannot be gamed without real economic cost."

#### Act 7 — Dispute Flow (5 min)

| Step | Persona | Action | What the Board Sees |
|------|---------|--------|---------------------|
| 30 | — | Post a new job, go through selection + stake | Job #1 is Active |
| 31 | Freelancer | Submit milestone | MS in Review |
| 32 | Client | Click "Raise Dispute" | MetaMask: pay dispute fee → MS → Disputed |
| 33 | Client/Freelancer | Submit evidence on Dispute page | Evidence encrypted & uploaded to IPFS, displayed in timeline |

**Talking point**: "The dispute system ensures neither party can act in bad faith. All evidence is encrypted and stored on IPFS — only the judge can decrypt it after key distribution."

#### Act 8 — Admin Assigns Judge (2 min)

| Step | Persona | Action | What the Board Sees |
|------|---------|--------|---------------------|
| 34 | Admin | Switch MetaMask to Admin account | Admin Dashboard shows pending actions |
| 35 | Admin | Navigate to `/admin` → Role Management tab | Role management panel with address input |
| 36 | Admin | Navigate to `/admin` → Dispute Management tab | Dispute #0 shows "AwaitingJudge" status |
| 37 | Admin | Click "Assign Judge" → enter Judge address → confirm | MetaMask confirm → Dispute transitions to KeyDistribution |

**Talking point**: "The admin has a dedicated dashboard to manage platform roles and assign judges to disputes — no need for direct contract interaction."

#### Act 9 — Judge Reviews & Rules (3 min)

| Step | Persona | Action | What the Board Sees |
|------|---------|--------|---------------------|
| 38 | Client | Switch to Client account → Dispute Detail page | "Key Distribution" phase — "Distribute Key to Judge" button visible |
| 39 | Client | Click "Distribute Key to Judge" | Job key re-encrypted for judge via Lit Protocol → tx confirmed |
| 40 | Judge | Switch MetaMask to Judge account | Judge Dashboard at `/judge` shows assigned dispute |
| 41 | Judge | Click dispute → View evidence | Evidence fetched from IPFS → decrypted with Lit Protocol → displayed |
| 42 | Judge | Select ruling (Client Wins / Freelancer Wins / Compromise) | Ruling options displayed |
| 43 | Judge | Submit ruling with rationale | MetaMask confirm → Dispute → Ruled |
| 44 | — | See funds redistributed per ruling | Wallet balances updated, reputation adjusted |

**Talking point**: "The judge decrypts evidence using Lit Protocol's threshold encryption — the key is distributed securely on-chain. The ruling is recorded immutably, and funds are redistributed automatically by the smart contract."

---

## 13. Environment Variables & Configuration

### 13.1 Frontend `.env` File

```bash
# frontend/.env.example

# ── Network Mode ──
# Set to "local" for Hardhat, or "testnet" for Base Sepolia
VITE_NETWORK_MODE=local

# ── Blockchain (Base Sepolia — used when NETWORK_MODE=testnet) ──
VITE_CHAIN_ID=84532
VITE_RPC_URL=https://sepolia.base.org

# ── Blockchain (Hardhat Local — used when NETWORK_MODE=local) ──
# VITE_CHAIN_ID=31337
# VITE_RPC_URL=http://127.0.0.1:8545

# ── Deployed Contract Addresses ──
# Fill these after deploying via Hardhat
VITE_JOB_ESCROW_ADDRESS=0x...
VITE_DISPUTE_ADDRESS=0x...
VITE_REPUTATION_ADDRESS=0x...
VITE_DATA_AVAILABILITY_ADDRESS=0x...
VITE_MOCK_USDC_ADDRESS=0x...
VITE_PLATFORM_ROLES_ADDRESS=0x...

# ── Pinata (IPFS) ──
VITE_PINATA_JWT=eyJ...                                 # Pinata API JWT token
VITE_PINATA_GATEWAY=your-gateway.mypinata.cloud       # Dedicated Pinata gateway

# ── Lit Protocol ──
# No API key needed — Datil-dev test network is free
# The SDK auto-connects; no configuration required
```

### 13.2 Contract Addresses Config

```typescript
// src/config/contracts.ts

interface NetworkConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  contracts: {
    jobEscrow: string;
    dispute: string;
    reputation: string;
    dataAvailability: string;
    mockUSDC: string;
  };
}

export const networks: Record<number, NetworkConfig> = {
  // Base Sepolia
  84532: {
    chainId: 84532,
    name: "Base Sepolia",
    rpcUrl: "https://sepolia.base.org",
    contracts: {
      jobEscrow:         import.meta.env.VITE_JOB_ESCROW_ADDRESS,
      dispute:           import.meta.env.VITE_DISPUTE_ADDRESS,
      reputation:        import.meta.env.VITE_REPUTATION_ADDRESS,
      dataAvailability:  import.meta.env.VITE_DATA_AVAILABILITY_ADDRESS,
      mockUSDC:          import.meta.env.VITE_MOCK_USDC_ADDRESS,
    },
  },
  // Hardhat Local
  31337: {
    chainId: 31337,
    name: "Hardhat Local",
    rpcUrl: "http://127.0.0.1:8545",
    contracts: {
      jobEscrow:         "0x...",  // Filled after local deploy
      dispute:           "0x...",
      reputation:        "0x...",
      dataAvailability:  "0x...",
      mockUSDC:          "0x...",
    },
  },
};
```

### 13.3 Constants

```typescript
// src/config/constants.ts

export const REVIEW_TIMEOUT_OPTIONS = [
  { label: "1 day",   value: 86400 },
  { label: "3 days",  value: 259200 },
  { label: "7 days",  value: 604800 },
  { label: "14 days", value: 1209600 },
  { label: "21 days", value: 1814400 },
  { label: "30 days", value: 2592000 },
];

export const PROTOCOL_FEE_BPS = 200;           // 2%
export const FREELANCER_DEPOSIT_BPS = 500;     // 5%
export const MIN_MILESTONE_BPS = 1000;         // 10%
export const T_ACCEPTANCE_SECONDS = 14 * 86400; // 14 days
export const T_STAKE_SECONDS = 3 * 86400;      // 3 days

export const USDC_DECIMALS = 6;

export const TIER_LABELS: Record<number, string> = {
  0: "New",
  1: "Bronze",
  2: "Silver",
  3: "Gold",
};

export const BEHAVIOR_BOND_BPS: Record<number, number> = {
  0: 750,   // New: 7.5%
  1: 500,   // Bronze: 5%
  2: 250,   // Silver: 2.5%
  3: 100,   // Gold: 1%
};
```

---

## 14. Testing Strategy (Stage 2)

### 14.1 Unit Tests (Crypto Module)

Test the cryptographic functions in isolation:

| Module | Test Cases |
|--------|-----------|
| `aes.ts` | Encrypt → decrypt round-trip, wrong key fails, different IVs produce different ciphertext |
| `hash.ts` | `computeAgreementHash()` matches ethers.js `keccak256` output |
| `jobKey.ts` | Key is 32 bytes, salt is 32 bytes, two generations are different |
| `keyExchange.ts` | Encrypt for freelancer → decrypt as freelancer round-trip (via Lit Protocol) |

Use **Vitest** (Vite's native test runner) for frontend unit tests:

```json
// frontend/package.json additions
{
  "devDependencies": {
    "vitest": "^2.0.0",
    "@testing-library/react": "^16.0.0",
    "@testing-library/jest-dom": "^6.4.0"
  },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

### 14.2 Integration Tests (Frontend ↔ Contract)

Test key user flows against a local Hardhat node:

| Flow | Steps Tested |
|------|-------------|
| Post Job | Connect wallet → fill form → encrypt → upload to Pinata (mocked) → call `postJob()` → verify on-chain state |
| Apply + Select + Stake | Full sequence → verify job transitions to Active |
| Submit + Approve Milestone | Upload deliverable → submit → approve → verify fund release |
| Withdraw | Verify USDC balance increases after `withdraw()` |

### 14.3 E2E Test Approach

For the demo, **manual testing** is the primary E2E strategy. The demo script (§12) serves as the test plan:

- [ ] Client can post a job with encrypted agreement
- [ ] Freelancer can browse and apply
- [ ] Client can select freelancer (key re-encrypted for freelancer via Lit Protocol)
- [ ] Freelancer can stake and activate job
- [ ] Freelancer can submit milestone with encrypted deliverable
- [ ] Client can view decrypted deliverable
- [ ] Client can approve milestone, funds released
- [ ] Auto-approve works after timeout
- [ ] Job completes, deposits refunded, reputation updated
- [ ] Both parties can withdraw funds
- [ ] Dispute can be raised, evidence submitted (encrypted)
- [ ] Admin can assign judge via Admin Dashboard
- [ ] Client distributes key to judge via Lit Protocol
- [ ] Judge can decrypt evidence and submit ruling via Judge Dashboard
- [ ] Funds redistributed per ruling, reputation adjusted
- [ ] Admin can grant/revoke roles via Admin Dashboard
- [ ] Reputation profiles display correctly

---

## 15. Simplifications & Known Limitations (Demo Scope)

| Area | Demo Simplification | Production Requirement |
|------|--------------------|-----------------------|
| **Key Storage** | localStorage (cleared on browser data clear) | Secure enclave, hardware wallet, or encrypted backup |
| **Job Listing** | Sequential `getJobInfo()` calls (O(n)) | Subgraph / indexer for O(1) queries |
| **Pinata API Key** | Embedded in frontend bundle | Backend proxy with server-side JWT |
| **IPFS Pinning** | Client-side Pinata upload only | Backend pinning service listening to `CIDRegistered` events |
| **Retention Enforcement** | Not implemented | Backend cron job to unpin expired CIDs |
| **Network Support** | Single network (Hardhat local or Base Sepolia) | Multi-network with network switcher |
| **Error Handling** | Basic toast notifications | Detailed error pages, retry logic, tx acceleration |
| **Mobile** | Desktop-first, basic responsive | Full mobile-responsive design |
| **Accessibility** | Not implemented (desktop demo only) | Full WCAG 2.1 AA compliance |
| **Lit Protocol** | Datil-dev free test network | Production Lit network with billing |
| **Auto-Approve Demo** | Requires time manipulation (Hardhat) or pre-prepared state | Natural timeout on live network |

### 15.1 Demo-Only Features (Remove Before Production)

These features exist solely for the demo and must be removed in production:

| Feature | Purpose | Location |
|---------|---------|----------|
| `FaucetPanel` component | Mint test USDC with one click | `components/testnet/FaucetPanel.tsx` |
| MockUSDC integration | Anyone can mint unlimited USDC | `hooks/useMockUSDC.ts` |
| Hardhat time manipulation | Fast-forward time for auto-approve demo | Console commands during presentation |
| Datil-dev Lit network | Free test network without billing | `crypto/litProtocol.ts` — switch to production network |

---

## Appendix A: Remix IDE Role Hash Quick Reference

Pre-computed `bytes32` role hashes for copy-paste into Remix:

```
DEFAULT_ADMIN_ROLE = 0x0000000000000000000000000000000000000000000000000000000000000000
ESCROW_ROLE        = keccak256("ESCROW_ROLE")    → (compute at deploy time)
DISPUTE_ROLE       = keccak256("DISPUTE_ROLE")   → (compute at deploy time)
PLATFORM_ADMIN     = keccak256("PLATFORM_ADMIN") → (compute at deploy time)
PLATFORM_JUDGE     = keccak256("PLATFORM_JUDGE") → (compute at deploy time)
```

The developer should create a helper script (`scripts/remix-config-helper.ts`) that outputs these hashes:

```typescript
import { ethers } from "ethers";

console.log("ESCROW_ROLE:   ", ethers.keccak256(ethers.toUtf8Bytes("ESCROW_ROLE")));
console.log("DISPUTE_ROLE:  ", ethers.keccak256(ethers.toUtf8Bytes("DISPUTE_ROLE")));
console.log("PLATFORM_ADMIN:", ethers.keccak256(ethers.toUtf8Bytes("PLATFORM_ADMIN")));
console.log("PLATFORM_JUDGE:", ethers.keccak256(ethers.toUtf8Bytes("PLATFORM_JUDGE")));
```

## Appendix B: USDC Formatting Utility

```typescript
// src/utils/format.ts

import { USDC_DECIMALS } from "../config/constants";

/** Format raw USDC amount (6 decimals) to human-readable string */
export function formatUSDC(amount: bigint): string {
  const whole = amount / BigInt(10 ** USDC_DECIMALS);
  const fraction = amount % BigInt(10 ** USDC_DECIMALS);
  const fractionStr = fraction.toString().padStart(USDC_DECIMALS, "0").slice(0, 2);
  return `$${whole.toLocaleString()}.${fractionStr}`;
}

/** Parse human-readable USDC string to raw amount */
export function parseUSDC(amount: string): bigint {
  const [whole, fraction = ""] = amount.replace(/[$,]/g, "").split(".");
  const paddedFraction = fraction.padEnd(USDC_DECIMALS, "0").slice(0, USDC_DECIMALS);
  return BigInt(whole) * BigInt(10 ** USDC_DECIMALS) + BigInt(paddedFraction);
}

/** Format Unix timestamp to readable date */
export function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Format duration in seconds to "Xd Yh Zm" */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return "Expired";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
```

## Appendix C: Contract Error Parser

```typescript
// src/utils/errors.ts

/** Map common contract revert strings to user-friendly messages */
const ERROR_MAP: Record<string, string> = {
  "Only client":                      "Only the job client can perform this action.",
  "Only freelancer":                  "Only the assigned freelancer can perform this action.",
  "Job not active":                   "This job is not currently active.",
  "Not in review":                    "This milestone is not currently under review.",
  "Review timeout not expired":       "The review period has not expired yet.",
  "Stake window expired":            "The staking deadline has passed.",
  "Milestone below minimum":          "Each milestone must be at least 10% of the total value.",
  "Invalid review timeout":           "Please select a valid review timeout.",
  "Already applied":                  "You have already applied to this job.",
  "Freelancer has not applied":       "The selected freelancer has not applied to this job.",
  "Not a party":                      "You are not a party to this job.",
  "Nothing to withdraw":              "You have no funds to withdraw.",
  "Already processed":                "These funds have already been processed.",
  "Milestone not pending":            "This milestone is not in a pending state.",
  "Milestone deadline passed":        "The milestone deadline has already passed.",
  "Not selected freelancer":          "You are not the selected freelancer for this job.",
  "Client cannot apply":              "The job client cannot apply to their own job.",
  "Cannot cancel in current state":   "This job cannot be cancelled in its current state.",
  "No pending cancellation":          "There is no pending cancellation request.",
  "Cancellation already pending":     "A cancellation request is already pending.",
};

export function parseContractError(error: unknown): string {
  const message = (error as any)?.reason
    || (error as any)?.data?.message
    || (error as any)?.message
    || "Transaction failed";

  // Check known revert strings
  for (const [key, friendly] of Object.entries(ERROR_MAP)) {
    if (message.includes(key)) return friendly;
  }

  // MetaMask user rejection
  if (message.includes("user rejected") || message.includes("ACTION_REJECTED")) {
    return "Transaction was rejected in your wallet.";
  }

  return message;
}
```
