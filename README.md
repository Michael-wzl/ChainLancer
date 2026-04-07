# [ChainLancer](https://www.cyng268.app)

Also named GigSecure (website display name), ChainLancer (project name) is a decentralized freelance escrow platform built on Ethereum smart contracts. Clients post milestone-based jobs with funds locked in escrow; freelancers apply, deliver work, and get paid automatically when milestones are approved. A built-in dispute resolution system and on-chain reputation scoring keep both sides accountable.

For the full design rationale and architecture, see the [WorkFlow Documentation](docs/WorkflowDesign.md).

For the market analysis on why we need a decentralized freelance platform, see the [Market Analysis Report](docs/MarketAnalysis.md).

**Tech stack:** Solidity 0.8.24 · Hardhat · OpenZeppelin (UUPS upgradeable) · React 18 · Vite · Tailwind CSS · ethers.js v6 · Redux Toolkit · IPFS (Pinata)

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
  - [1. Clone the Repository](#1-clone-the-repository)
  - [2. Install Dependencies](#2-install-dependencies)
- [Smart Contracts](#smart-contracts)
  - [Compile](#compile)
- [Local Development (Hardhat)](#local-development-hardhat)
  - [1. Start a Local Blockchain](#1-start-a-local-blockchain)
  - [2. Deploy Contracts Locally](#2-deploy-contracts-locally)
  - [3. Configure `frontend/.env`](#3-configure-frontendenv)
  - [4. Configure MetaMask](#4-configure-metamask)
  - [5. Start the Frontend](#5-start-the-frontend)
  - [6. Clearing Up](#6-clearing-up)
- [Base Sepolia Testnet Deployment](#base-sepolia-testnet-deployment)
  - [1. Get Base Sepolia Test ETH](#1-get-base-sepolia-test-eth)
  - [2. Export Your Deployer Private Key](#2-export-your-deployer-private-key)
  - [3. Get a BaseScan API Key](#3-get-a-basescan-api-key)
  - [4. Configure Root .env](#4-configure-root-env)
  - [5. Compile Contracts](#5-compile-contracts)
  - [6. Deploy Contracts](#6-deploy-contracts)
  - [7. Verify Contracts on BaseScan](#7-verify-contracts-on-basescan)
- [Upgrading Contracts (UUPS)](#upgrading-contracts-uups)
- [Testing](#testing)
  - [Smart Contract Tests](#smart-contract-tests)
  - [Frontend Tests](#frontend-tests)
- [Frontend Development](#frontend-development)
  - [Development Server](#development-server)
  - [Production Build](#production-build)
- [Using the App](#using-the-app)
- [CI/CD (Azure Static Web Apps)](#cicd-azure-static-web-apps)
  - [1. Get the Azure Deployment Token](#1-get-the-azure-deployment-token)
  - [2. Add GitHub Secrets](#2-add-github-secrets)
  - [3. Push to GitHub](#3-push-to-github)
  - [4. Monitor the Deployment](#4-monitor-the-deployment)
- [Post-Deployment Verification](#post-deployment-verification)
- [Post-Deployment Configuration](#post-deployment-configuration)
- [Command Reference](#command-reference)
- [Troubleshooting Tips](#troubleshooting-tips)

---

## Prerequisites

| Requirement | Details |
| --- | --- |
| **Node.js** | v20.x or newer |
| **npm** | Ships with Node.js |
| **Browser** | Google Chrome (MetaMask injection required — Safari / Firefox not supported) |
| **MetaMask** | [Install from the Chrome Web Store](https://metamask.io/) |
| **Pinata account** | Free tier at <https://www.pinata.cloud/> — needed for IPFS uploads |
| **Git** | Any recent version |

---

## Project Structure

```text
ChainLancer/
├── contracts/                # Solidity smart contracts
│   ├── access/               #   PlatformRoles (role-based access control)
│   ├── core/                 #   JobEscrow, Dispute, Reputation, DataAvailability
│   ├── interfaces/           #   IJobEscrow, IDispute, IReputation, IDataAvailability
│   ├── libraries/            #   JobEscrowLib, DisputeFeeLib, ReputationLib, TimeoutLib
│   └── mocks/                #   MockUSDC (ERC-20 test token)
├── scripts/
│   ├── deploy.ts             # Deploy all contracts (local + testnet)
│   ├── seed.ts               # Populate demo data for manual testing
│   ├── upgrade.ts            # UUPS proxy upgrade template
│   └── verify.ts             # Verify contract source on BaseScan
├── test/
│   ├── unit/                 # Per-contract unit + edge-case tests
│   ├── integration/          # Multi-contract workflow tests
│   ├── security/             # Access control, reentrancy, race conditions
│   ├── comprehensive/        # Full security & workflow compliance suites
│   └── helpers/              # Shared test fixtures
├── frontend/
│   └── src/
│       ├── abis/             # Contract ABI JSON files
│       ├── components/       # React components (admin, job, dispute, wallet, …)
│       ├── config/           # Network & contract configuration
│       ├── contexts/         # React context providers
│       ├── crypto/           # Client-side encryption utilities
│       ├── hooks/            # Custom React hooks
│       ├── ipfs/             # Pinata IPFS integration
│       ├── pages/            # Route-level page components
│       ├── styles/           # Global CSS / Tailwind styles
│       └── utils/            # Helpers and formatters
├── docs/                     # Design documentation
├── hardhat.config.ts         # Hardhat configuration
├── .env.example              # Root env template
└── frontend/.env.example     # Frontend env template
```

---

## Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/Michael-wzl/ChainLancer.git
cd ChainLancer
```

### 2. Install Dependencies

```bash
# Root — Hardhat, Solidity tooling, OpenZeppelin
npm install

# Frontend — React, Vite, Tailwind, ethers.js
cd frontend
npm install
cd ..
```

---

## Smart Contracts

### Compile

```bash
npm run compile
```

This compiles all Solidity contracts and generates TypeChain typings in `typechain-types/`.

---

## Local Development (Hardhat)

### 1. Start a Local Blockchain

```bash
npx hardhat node
```

Keep this terminal **running**. It prints 20 funded test accounts with private keys. You'll need at least two:

- **Account #0** → Deployer / Admin / Client
- **Account #1** → Freelancer

### 2. Deploy Contracts Locally

Open a **new terminal**:

```bash
npm run deploy:local
```

The script deploys all 5 contracts, wires cross-contract references, and grants roles automatically. At the end it prints:

```text
── VITE ENV VARIABLES ──
VITE_MOCK_USDC_ADDRESS=0x...
VITE_JOB_ESCROW_ADDRESS=0x...
VITE_DISPUTE_ADDRESS=0x...
VITE_REPUTATION_ADDRESS=0x...
VITE_DATA_AVAILABILITY_ADDRESS=0x...
```

**Copy these values into `frontend/.env`** (see next step).

### 3. Configure `frontend/.env`

Create `frontend/.env` by copying the example template:

```bash
cp frontend/.env.example frontend/.env
```

Then fill in the following values:

#### Pinata JWT (required for IPFS uploads)

1. Sign up or log in at <https://www.pinata.cloud/>.
2. Go to **API Keys** → click **+ New Key**.
3. Enable **Admin** access (or at minimum `pinFileToIPFS` and `pinJSONToIPFS`), give it a name (e.g. `ChainLancer`), and click **Create Key**.
4. Copy the **JWT** value (a long `eyJ...` string) — you will only see it once.
5. Paste it into `frontend/.env`:

```dotenv
VITE_PINATA_JWT=eyJhbGciOiJIUzI1NiIs...
VITE_PINATA_GATEWAY_URL=https://gateway.pinata.cloud/ipfs
```

#### Contract addresses & network

Paste the 5 contract addresses from the deploy output (step 2) and set the target network:

```dotenv
VITE_TARGET_NETWORK=hardhat
VITE_TEST_MODE=true
VITE_MOCK_USDC_ADDRESS=0x...
VITE_JOB_ESCROW_ADDRESS=0x...
VITE_DISPUTE_ADDRESS=0x...
VITE_REPUTATION_ADDRESS=0x...
VITE_DATA_AVAILABILITY_ADDRESS=0x...
```

> ⚠️ **Never commit `frontend/.env` to Git.** It is already gitignored.

### 4. Configure MetaMask

#### Import test accounts

1. MetaMask → Account → Three dots → **Import Wallet** → **Private Key**.
2. Paste a private key from the `npx hardhat node` output.
3. Repeat for at least Account #0 and Account #1.

#### Add the Hardhat network

| Field | Value |
| --- | --- |
| Network name | `Hardhat Local` |
| RPC URL | `http://127.0.0.1:8545` |
| Chain ID | `31337` |
| Currency symbol | `ETH` |

### 5. Start the Frontend

```bash
cd frontend
npm run dev
```

Open `http://localhost:5173` in **Chrome**.

### 6. Clearing Up

Always remember to clear temporary data after finishing local testing:

1. Clear browser local data through [Chrome settings](chrome://settings/content/all)
2. Clear all IPFS uploads on Pinata dashboard
3. Stop the Hardhat node (`Ctrl + C` in the terminal) and the frontend server (`Ctrl + C` in the frontend terminal)

---

## Base Sepolia Testnet Deployment

### 1. Get Base Sepolia Test ETH

Deploying contracts requires gas fees, so you need Base Sepolia test ETH in your wallet first.

1. Open MetaMask and switch to the **Base Sepolia** network. If it's not in your network list, add it manually:
   - Network name: `Base Sepolia`
   - RPC URL: `https://sepolia.base.org`
   - Chain ID: `84532`
   - Currency symbol: `ETH`
2. Copy your wallet address.
3. Go to the [Superchain Faucet](https://app.optimism.io/faucet) to claim test ETH (requires GitHub account verification). Make sure you claim **Base Sepolia** ETH, not Sepolia ETH. If you claimed the wrong one, you may have to wait 24 hours for the next claim.
4. Paste your wallet address and claim. Funds typically arrive within 1–2 minutes.

### 2. Export Your Deployer Private Key

1. Open MetaMask → click the `⋮` next to the account → **Account details** → **Show private key**.
2. Enter your MetaMask password and copy the private key (format: `0xabcdef1234...`, 64 hex characters).
3. ⚠️ **Keep this private key safe. Never commit it to Git.**

### 3. Get a BaseScan API Key

A BaseScan API key is needed to verify (publish) your contract source code on-chain.

1. Go to <https://basescan.org> and register or log in.
2. After logging in, click your username (top-right) → **My Account** → **API Keys**.
3. Click **Add** → enter any name (e.g. `ChainLancer`) → confirm.
4. Copy the generated API Key Token.

### 4. Configure Root `.env`

Create a `.env` file in the project root (already gitignored — will not be committed):

```dotenv
DEPLOYER_PRIVATE_KEY=0xYourPrivateKey
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
BASESCAN_API_KEY=YourBaseScanApiKey
```

> **⚠️ Never commit your private key to Git.** The `.env` file is gitignored.

### 5. Compile Contracts

```bash
npm install
npm run compile
```

Make sure there are no errors and all contracts compile successfully before proceeding.

### 6. Deploy Contracts

```bash
npm run deploy:base-sepolia
```

The script deploys all 5 contracts in order and automatically configures cross-contract role authorizations. Each on-chain transaction requires block confirmation, so the entire process takes approximately **1–5 minutes**. Note that each contract's bytescode cannot exceed the 24KB limit, so we use a linked library (`JobEscrowLib`) for the largest contract. (We suggest verifying the size before deploying.)

**Example terminal output on success:**

```text
Deploying contracts with account: 0xYourAddress

1. Deploying MockUSDC...
   MockUSDC deployed to: 0xAAAA...

2. Deploying DataAvailability...
   DataAvailability deployed to: 0xBBBB...

3. Deploying Reputation...
   Reputation deployed to: 0xCCCC...

4. Deploying Dispute...
   Dispute deployed to: 0xDDDD...

5. Deploying JobEscrow...
   JobEscrow deployed to: 0xEEEE...

6. Configuring cross-references...
   ...

✅ All contracts deployed and configured!

── VITE ENV VARIABLES ──
VITE_MOCK_USDC_ADDRESS=0xAAAA...
VITE_JOB_ESCROW_ADDRESS=0xEEEE...
VITE_DISPUTE_ADDRESS=0xDDDD...
VITE_REPUTATION_ADDRESS=0xCCCC...
VITE_DATA_AVAILABILITY_ADDRESS=0xBBBB...
```

⚠️ **Record all addresses from the terminal output immediately.** You will need the 5 addresses from the `── VITE ENV VARIABLES ──` block in multiple subsequent steps.

Create or update `frontend/.env` with the printed addresses and the following settings:

```dotenv
VITE_TARGET_NETWORK=base-sepolia
VITE_MOCK_USDC_ADDRESS=0xAAAA...
VITE_JOB_ESCROW_ADDRESS=0xEEEE...
VITE_DISPUTE_ADDRESS=0xDDDD...
VITE_REPUTATION_ADDRESS=0xCCCC...
VITE_DATA_AVAILABILITY_ADDRESS=0xBBBB...
```

Also add your **Pinata JWT** if you haven't already (required for IPFS uploads):

1. Sign up or log in at <https://www.pinata.cloud/>.
2. Go to **API Keys** → click **+ New Key**.
3. Enable **Admin** access (or at minimum `pinFileToIPFS` and `pinJSONToIPFS`), give it a name (e.g. `ChainLancer`), and click **Create Key**.
4. Copy the **JWT** value (a long `eyJ...` string) — you will only see it once.
5. Add it to `frontend/.env`:

```dotenv
VITE_PINATA_JWT=eyJhbGciOiJIUzI1NiIs...
VITE_PINATA_GATEWAY_URL=https://gateway.pinata.cloud/ipfs
```

> ⚠️ **Never commit `frontend/.env` to Git.** It is already gitignored.

### 7. Verify Contracts on BaseScan

After deploying, add the contract addresses to the root `.env`:

```dotenv
USDC_ADDRESS=0xAAAA...
DATA_AVAILABILITY_ADDRESS=0xBBBB...
REPUTATION_ADDRESS=0xCCCC...
DISPUTE_ADDRESS=0xDDDD...
JOB_ESCROW_ADDRESS=0xEEEE...
```

Then run:

```bash
npm run verify:base-sepolia
```

Each contract shows `✅ Verified` on success. "Already Verified" is also normal.

After verification, you can view the full source code for each contract on BaseScan:  
<https://sepolia.basescan.org/address/0xContractAddress>

---

## Upgrading Contracts (UUPS)

All core contracts (DataAvailability, Reputation, Dispute, JobEscrow) are deployed behind UUPS proxies and can be upgraded without changing their addresses.

```bash
PROXY_ADDRESS=0xProxyAddress \
CONTRACT_NAME=DataAvailability \
npx hardhat run scripts/upgrade.ts --network <network>
```

For **JobEscrow**, the script automatically deploys a new `JobEscrowLib` library if `JOB_ESCROW_LIB_ADDRESS` is not set:

```bash
PROXY_ADDRESS=0xProxyAddress \
CONTRACT_NAME=JobEscrow \
npx hardhat run scripts/upgrade.ts --network <network>
```

> The caller must hold `DEFAULT_ADMIN_ROLE` on the proxy contract.

---

## Testing

### Smart Contract Tests

All contract tests are written with Hardhat + Chai + ethers.js and live under `test/`.

```bash
# Run all tests
npm test

# Run a specific test file
npx hardhat test test/unit/JobEscrow.test.ts

# Run with gas reporting
REPORT_GAS=true npm test
```

**Test suites:**

| Directory | Contents |
| --- | --- |
| `test/unit/` | Per-contract tests: JobEscrow, Dispute, Reputation, DataAvailability (+ edge cases) |
| `test/integration/` | Full workflow tests (FullFlow, AdvancedFlow) — end-to-end job lifecycle |
| `test/security/` | Access control, reentrancy, race conditions, enhanced security |
| `test/comprehensive/` | Full security & workflow compliance suites |
| `test/helpers/` | Shared fixture for deploying & configuring all contracts in tests |

### Frontend Tests

Frontend tests use **Vitest** + **React Testing Library** + **jsdom**.

```bash
cd frontend

# Run all frontend tests
npm test

# Run in watch mode
npm run test:watch

# Run with coverage report
npm run test:coverage
```

---

## Frontend Development

### Development Server

```bash
cd frontend
npm run dev
```

- Runs on `http://localhost:5173` with hot module replacement.
- Path alias `@/` maps to `src/`.

### Production Build

```bash
cd frontend
npm run build
```

Output goes to `frontend/dist/`. Preview locally:

```bash
npm run preview
```

---

## Using the App

1. Open the app in **Chrome** and click **Connect Wallet**.
2. MetaMask will prompt you to switch to the correct network (Hardhat Local or Base Sepolia).
3. Switch between imported accounts to simulate different roles:

   | Role | Actions |
   | --- | --- |
   | **Client** | Post jobs, review milestones, approve/reject deliverables, raise disputes |
   | **Freelancer** | Browse & apply for jobs, submit milestone deliverables, stake deposits |
   | **Judge** | Vote on disputes (requires `PLATFORM_ADMIN` role grant) |
   | **Admin** | Manage roles, platform settings (`/admin` page) |

4. On the **Wallet** page:

   - **Mint** demo USDC (local/testnet only)
   - **Approve** the JobEscrow contract to spend your USDC

5. **Typical workflow:**

   - Client posts a job with milestones and funds escrow →
   - Freelancer applies → Client selects freelancer →
   - Freelancer stakes deposit and confirms →
   - Freelancer submits deliverable for each milestone →
   - Client approves → funds released automatically →
   - Either party can raise a dispute at any point

---

## CI/CD (Azure Static Web Apps)

The frontend is deployed to **Azure Static Web Apps** via GitHub Actions. Pushing to `main` triggers an automatic build and deploy.

### 1. Get the Azure Deployment Token

1. Log in to the [Azure Portal](https://portal.azure.com).
2. Navigate to **Static Web Apps** → find the app for `cyng268.app`.
3. Click **Overview** in the left menu → click **Manage deployment token**.
4. Copy the token (a long string starting with `xxxxxxxx-xxxx-...`).

### 2. Add GitHub Secrets

Go to the [GitHub Secrets settings page](https://github.com/Michael-wzl/ChainLancer/settings/secrets/actions), click **New repository secret**, and add the following **8 secrets**:

| Secret | Value |
| --- | --- |
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | The deployment token from step 1 |
| `VITE_PINATA_JWT` | Your Pinata JWT — obtain it from <https://app.pinata.cloud/developers/api-keys> (**+ New Key** → Admin → Create Key → copy the JWT). This is the same value in `frontend/.env`. |
| `VITE_PINATA_GATEWAY_URL` | `https://gateway.pinata.cloud/ipfs` |
| `VITE_MOCK_USDC_ADDRESS` | Deployed MockUSDC address |
| `VITE_JOB_ESCROW_ADDRESS` | Deployed JobEscrow address |
| `VITE_DISPUTE_ADDRESS` | Deployed Dispute address |
| `VITE_REPUTATION_ADDRESS` | Deployed Reputation address |
| `VITE_DATA_AVAILABILITY_ADDRESS` | Deployed DataAvailability address |

> If `AZURE_STATIC_WEB_APPS_API_TOKEN` already exists (set during a previous deployment), click **Update** and confirm it matches the latest Azure token.

### 3. Push to GitHub

Before committing, make sure no `.env` files are staged:

```bash
git status
```

If you see `.env` or `frontend/.env` in the staging area, unstage them immediately:

```bash
git reset HEAD .env
git reset HEAD frontend/.env
```

Then commit and push.

GitHub Actions will automatically trigger the build and deploy pipeline.

### 4. Monitor the Deployment

1. Go to the [GitHub Actions page](https://github.com/Michael-wzl/ChainLancer/actions).
2. Find the latest **"Deploy Azure Static Web App"** workflow run and click into it.
3. Check the **"Build and Deploy Job"** step logs and wait for the green ✅.
4. The entire process typically takes **2–5 minutes**.

---

## Post-Deployment Verification

### Verify the Frontend

1. Open <https://www.cyng268.app>.
2. Confirm the ChainLancer Dashboard loads normally with no blank page or errors.
3. Open browser DevTools → **Console** panel and confirm there are no CSP violation errors (red errors containing `Content-Security-Policy`).

### Verify Wallet Connection & Network

1. Open MetaMask and switch to the **Base Sepolia** network.
2. Click "Connect Wallet" and authorize the connection.
3. The navbar should display a green **"Base Sepolia"** badge in the top-right corner.
4. If connected on the wrong network, a red **"Switch to Base Sepolia"** button should appear. Clicking it triggers a MetaMask network-switch confirmation.

### Verify Testnet Faucet (Mint MockUSDC)

1. After connecting your wallet, navigate to the **Dashboard** or **Wallet** page.
2. A **"Testnet Faucet"** panel (purple gradient card) should appear at the bottom.
3. Enter an amount (e.g. `10000`) and click **Mint**.
4. Confirm the transaction in MetaMask.
5. Wait for the transaction to be mined (~5–15 seconds). Your USDC balance should increase.

### Verify TimeTravelPanel Is Disabled

1. The ⏳ floating button should **not** appear in the bottom-right corner of the page.
2. Open DevTools → **Network** panel, refresh the page, and confirm no `TimeTravelPanel-*.js` chunk is loaded.

### Verify Contract Source Code on BaseScan

1. Open <https://sepolia.basescan.org>.
2. Search for any contract address (e.g. the JobEscrow address).
3. Go to the contract page → click the **Contract** tab.
4. A green ✅ **"Verified"** badge should be displayed, and the full Solidity source code should be viewable.

---

## Post-Deployment Configuration

### Assign Judge / Admin Roles to Other Wallets

1. Log in to <https://www.cyng268.app/admin> with the deployer wallet.
2. Switch to the **"Role Management"** tab.
3. Enter the target wallet address and role name, click **Grant**, and confirm the transaction in MetaMask.

### Switch Local Frontend Between Networks

To connect locally to **Base Sepolia** for debugging, update `frontend/.env`:

```dotenv
VITE_PINATA_JWT=<your_pinata_jwt>
VITE_PINATA_GATEWAY_URL=https://gateway.pinata.cloud/ipfs
VITE_TARGET_NETWORK=base-sepolia
# VITE_TEST_MODE=true  ← must be commented out or removed
VITE_MOCK_USDC_ADDRESS=0xAAAA...
VITE_JOB_ESCROW_ADDRESS=0xEEEE...
VITE_DISPUTE_ADDRESS=0xDDDD...
VITE_REPUTATION_ADDRESS=0xCCCC...
VITE_DATA_AVAILABILITY_ADDRESS=0xBBBB...
```

To switch back to **local Hardhat** development (for tests, time-travel, etc.), restore:

```dotenv
VITE_TARGET_NETWORK=hardhat
VITE_TEST_MODE=true
VITE_MOCK_USDC_ADDRESS=0x5FbDB2315678afecb367f032d93F642f64180aa3
VITE_JOB_ESCROW_ADDRESS=0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9
VITE_DISPUTE_ADDRESS=0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9
VITE_REPUTATION_ADDRESS=0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0
VITE_DATA_AVAILABILITY_ADDRESS=0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512
```

---

## Command Reference

### Root (Hardhat)

| Command | Description |
| --- | --- |
| `npm run compile` | Compile Solidity contracts and generate TypeChain types |
| `npm test` | Run all smart contract tests |
| `npm run deploy:local` | Deploy all contracts to a local Hardhat node |
| `npm run deploy:base-sepolia` | Deploy all contracts to Base Sepolia testnet |
| `npm run verify:base-sepolia` | Verify contract source code on BaseScan |

### Frontend (Vite)

| Command | Description |
| --- | --- |
| `npm run dev` | Start Vite dev server (port 5173) |
| `npm run build` | TypeScript check + production build |
| `npm run preview` | Preview the production build locally |
| `npm test` | Run frontend unit tests (Vitest) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with V8 coverage report |

---

## Troubleshooting Tips

| Problem | Solution |
| --- | --- |
| **MetaMask not detected** | Use Chrome. Confirm the extension is installed and enabled. Refresh the page. |
| **Wrong network** | Switch MetaMask to *Hardhat Local* (chain 31337) for local, or *Base Sepolia* (chain 84532) for testnet. |
| **Contract calls fail after restarting Hardhat node** | Re-run `npm run deploy:local`, update the addresses in `frontend/.env`, and restart the frontend. |
| **Nonce too high** | MetaMask → Settings → Advanced → *Clear activity tab data*. This resets the nonce tracker. |
| **IPFS upload fails** | Verify `VITE_PINATA_JWT` is set correctly in `frontend/.env`. |
| **Frontend blank page** | Check that all 5 contract addresses are set in `frontend/.env`. Open DevTools → Console for errors. |
| **`npm run compile` fails** | Delete `artifacts/` and `cache/`, then retry. Ensure Node.js ≥ v20. |
| **Tests timeout** | Increase Hardhat timeout in test config, or run a specific test file instead of the full suite. |

Note that most problems can be resolved by clearing [browser local data](chrome://settings/content/all) and restarting the development environment.

---
