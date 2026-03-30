# ChainLancer

ChainLancer is a decentralized freelance escrow platform built on Ethereum smart contracts. Clients post milestone-based jobs with funds locked in escrow; freelancers apply, deliver work, and get paid automatically when milestones are approved. A built-in dispute resolution system and on-chain reputation scoring keep both sides accountable.

**Tech stack:** Solidity · Hardhat · React · Vite · Tailwind CSS · ethers.js · IPFS (Pinata)

---

## Prerequisites

| Requirement | Details |
|---|---|
| **Browser** | Google Chrome or Brave (Safari / Firefox are **not** supported because MetaMask injection is required) |
| **Browser extension** | [MetaMask](https://metamask.io/) — install from the Chrome Web Store |
| **Node.js** | v20.x or newer |
| **Package manager** | npm (ships with Node.js) |
| **IPFS service** | A free [Pinata](https://www.pinata.cloud/) account for uploading and retrieving job/milestone files |

---

## Accounts & Services

### Required for local deployment

1. **MetaMask wallet** — installed and unlocked in Chrome / Brave.
2. **Hardhat test accounts** — at least 2 accounts imported into MetaMask from the `npx hardhat node` output (see below).
   - Account #0 → deployer / admin / default client
   - Account #1 → freelancer
   - Account #2 → optional extra tester
3. **Pinata JWT** — sign up at <https://www.pinata.cloud/>, create an API key, and copy the JWT.

### Optional (Base Sepolia testnet)

1. A wallet funded with Base Sepolia ETH (use a faucet).
2. A Base Sepolia RPC endpoint (default: `https://sepolia.base.org`).
3. A Basescan API key if you want to verify contracts on-chain.

---

## Project Structure

```
ChainLancer/
├── contracts/          # Solidity smart contracts
│   ├── access/         #   Role-based access control
│   ├── core/           #   JobEscrow, Dispute, Reputation, DataAvailability
│   ├── interfaces/     #   Contract interfaces
│   ├── libraries/      #   Shared libraries
│   └── mocks/          #   MockUSDC for local testing
├── scripts/            # Deployment & seed scripts
├── test/               # Hardhat tests (unit, integration, security)
├── frontend/           # React + Vite + Tailwind frontend
│   └── src/
├── docs/               # Design & development documentation
├── hardhat.config.ts
├── .env.example        # Root env template (testnet only)
└── frontend/.env.example  # Frontend env template
```

---

## Local Deployment (Step by Step)

### 1. Install dependencies

```bash
# From the repository root
npm install

cd frontend
npm install
cd ..
```

### 2. Configure environment files

#### Root `.env` (only needed for Base Sepolia)

```bash
cp .env.example .env
# Fill in values only if deploying to Base Sepolia
```

#### Frontend `.env`

```bash
cp frontend/.env.example frontend/.env
```

Edit `frontend/.env` and set:

```dotenv
VITE_PINATA_JWT=<your_pinata_jwt>
VITE_PINATA_GATEWAY_URL=https://gateway.pinata.cloud/ipfs
VITE_TARGET_NETWORK=hardhat

# Leave the contract addresses as placeholders for now —
# you will fill them in after deployment (Step 5).
```

### 3. Start the local Hardhat blockchain

```bash
npx hardhat node
```

Keep this terminal **running**. It will print 20 funded test accounts with their private keys.

### 4. Import Hardhat accounts into MetaMask

1. Open MetaMask → click the account icon → **Import Account**.
2. Select **Private Key** and paste a key from the `npx hardhat node` output.
3. Repeat for at least **Account #0** and **Account #1**.

### 5. Add the Hardhat network to MetaMask

| Field | Value |
|---|---|
| Network name | `Hardhat Local` |
| RPC URL | `http://127.0.0.1:8545` |
| Chain ID | `31337` |
| Currency symbol | `ETH` |

> The app can auto-prompt MetaMask to switch, but adding the network manually once is more reliable.

### 6. Deploy contracts

Open a **new terminal** at the project root:

```bash
npm run deploy:local
```

The script prints deployed contract addresses. Copy them into `frontend/.env`:

```dotenv
VITE_MOCK_USDC_ADDRESS=0x...
VITE_JOB_ESCROW_ADDRESS=0x...
VITE_DISPUTE_ADDRESS=0x...
VITE_REPUTATION_ADDRESS=0x...
VITE_DATA_AVAILABILITY_ADDRESS=0x...
```

### 7. (Optional) Seed demo data

```bash
USDC_ADDRESS=<MockUSDC address> \
JOB_ESCROW_ADDRESS=<JobEscrow address> \
npx hardhat run scripts/seed.ts --network localhost
```

This creates sample jobs and funds demo accounts with mock USDC.

### 8. Start the frontend

```bash
cd frontend
npm run dev
```

Open the URL printed in the terminal (usually `http://localhost:5173`) in **Chrome or Brave**.

---

## Using the App

1. Open the app in Chrome / Brave and click **Connect Wallet**.
2. MetaMask will prompt you to switch to the **Hardhat Local** network.
3. Switch between imported Hardhat accounts to simulate different roles (client / freelancer).
4. On the **Wallet** page you can:
   - **Mint** demo USDC (local only)
   - **Approve** the `JobEscrow` contract to spend your USDC
5. Post jobs, apply, deliver milestones, approve work, and raise disputes.

---

## Base Sepolia Deployment

1. Fill in the root `.env` with your deployer key, RPC URL, and Basescan API key.
2. Set `VITE_TARGET_NETWORK=base-sepolia` in `frontend/.env`.
3. Deploy:

```bash
npm run deploy:base-sepolia
```

4. Copy the deployed addresses into `frontend/.env`.
5. Make sure your browser wallet is connected to Base Sepolia and funded with test ETH.

---

## Useful Scripts

### Root (Hardhat)

| Command | Description |
|---|---|
| `npm run compile` | Compile Solidity contracts |
| `npm test` | Run all contract tests |
| `npm run deploy:local` | Deploy to local Hardhat node |
| `npm run deploy:base-sepolia` | Deploy to Base Sepolia testnet |

### Frontend (Vite)

| Command | Description |
|---|---|
| `npm run dev` | Start Vite dev server |
| `npm run build` | Production build |
| `npm run test` | Run frontend unit tests |

---

## Troubleshooting

| Problem | Solution |
|---|---|
| **MetaMask not detected** | Use Chrome or Brave. Confirm the extension is installed and enabled. Refresh the page. |
| **Wrong network** | Switch MetaMask to *Hardhat Local* (chain 31337) for local demos. |
| **Contract calls fail** | Ensure `frontend/.env` has the latest deployed addresses and restart `npm run dev`. Check that the Hardhat node terminal is still running. |
| **IPFS upload fails** | Verify `VITE_PINATA_JWT` is set correctly in `frontend/.env`. |
| **Nonce too high** | In MetaMask → Settings → Advanced → *Clear activity tab data*. This resets the nonce tracker after restarting the Hardhat node. |
