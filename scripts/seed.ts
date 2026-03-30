import { ethers } from "hardhat";

/**
 * Seed script — populates the testnet with sample data for manual testing.
 *
 * Creates:
 * - 2 sample jobs (one active, one completed)
 * - Freelancer applications
 * - Milestone submissions
 *
 * Usage: npx hardhat run scripts/seed.ts --network baseSepolia
 */
async function main() {
  const [deployer, client, freelancer1] = await ethers.getSigners();
  console.log("Seeding with accounts:");
  console.log("  Deployer (Admin):", deployer.address);
  console.log("  Client:          ", client.address);
  console.log("  Freelancer:      ", freelancer1.address);

  // ── Load deployed contract addresses from environment ──
  const USDC_ADDRESS = process.env.USDC_ADDRESS;
  const JOB_ESCROW_ADDRESS = process.env.JOB_ESCROW_ADDRESS;

  if (!USDC_ADDRESS || !JOB_ESCROW_ADDRESS) {
    console.error("Missing USDC_ADDRESS or JOB_ESCROW_ADDRESS in environment.");
    console.error("Run deploy.ts first and set these env vars.");
    process.exit(1);
  }

  const usdc = await ethers.getContractAt("MockUSDC", USDC_ADDRESS);
  const jobEscrow = await ethers.getContractAt("JobEscrow", JOB_ESCROW_ADDRESS);

  // ── Mint USDC for test accounts ──
  console.log("\n1. Minting USDC for test accounts...");
  const MINT_AMOUNT = ethers.parseUnits("100000", 6); // 100k USDC each
  await usdc.mint(client.address, MINT_AMOUNT);
  await usdc.mint(freelancer1.address, MINT_AMOUNT);
  console.log("   Minted 100,000 USDC each for client and freelancer");

  // ── Approve JobEscrow ──
  console.log("\n2. Approving USDC spending...");
  await usdc.connect(client).approve(JOB_ESCROW_ADDRESS, ethers.MaxUint256);
  await usdc.connect(freelancer1).approve(JOB_ESCROW_ADDRESS, ethers.MaxUint256);
  console.log("   Approved JobEscrow for unlimited USDC spending");

  // ── Create Sample Job 1: Active job ──
  console.log("\n3. Creating sample Job 1 (Web App Development)...");
  const now = (await ethers.provider.getBlock("latest"))!.timestamp;
  const milestoneValues1 = [
    ethers.parseUnits("2000", 6), // Frontend - $2,000
    ethers.parseUnits("3000", 6), // Backend - $3,000
    ethers.parseUnits("5000", 6), // Integration & Deploy - $5,000
  ];
  const milestoneDeadlines1 = [
    now + 30 * 86400,  // 30 days
    now + 60 * 86400,  // 60 days
    now + 90 * 86400,  // 90 days
  ];
  const agreementHash1 = ethers.keccak256(
    ethers.toUtf8Bytes("salt1||Web App Development Agreement")
  );

  const tx1 = await jobEscrow.connect(client).postJob(
    agreementHash1,
    milestoneValues1,
    milestoneDeadlines1,
    7 * 86400, // 7-day review
    "QmSampleAgreementCID1"
  );
  const receipt1 = await tx1.wait();
  console.log("   Job 1 posted! (3 milestones, $10,000 total)");

  // Freelancer applies
  const proposalHash1 = ethers.keccak256(ethers.toUtf8Bytes("proposal-for-web-app"));
  await jobEscrow.connect(freelancer1).applyForJob(0, proposalHash1);
  console.log("   Freelancer applied to Job 1");

  // Client selects freelancer
  const encryptedKey1 = ethers.toUtf8Bytes("encrypted-job-key-1");
  await jobEscrow.connect(client).selectFreelancer(0, freelancer1.address, encryptedKey1);
  console.log("   Client selected freelancer for Job 1");

  // Freelancer stakes
  await jobEscrow.connect(freelancer1).confirmAndStake(0);
  console.log("   Freelancer staked deposit for Job 1 — Job is now ACTIVE");

  // ── Create Sample Job 2: Open job (no applications yet) ──
  console.log("\n4. Creating sample Job 2 (Smart Contract Audit)...");
  const milestoneValues2 = [
    ethers.parseUnits("5000", 6), // Audit Phase 1
    ethers.parseUnits("5000", 6), // Audit Phase 2
  ];
  const milestoneDeadlines2 = [
    now + 45 * 86400,
    now + 90 * 86400,
  ];
  const agreementHash2 = ethers.keccak256(
    ethers.toUtf8Bytes("salt2||Smart Contract Audit Agreement")
  );

  await jobEscrow.connect(client).postJob(
    agreementHash2,
    milestoneValues2,
    milestoneDeadlines2,
    14 * 86400, // 14-day review
    "QmSampleAgreementCID2"
  );
  console.log("   Job 2 posted! (2 milestones, $10,000 total, OPEN)");

  console.log("\n✅ Seeding complete!");
  console.log("\n── Summary ──");
  console.log("Job 0: Web App Development — ACTIVE (3 milestones, $10k)");
  console.log("Job 1: Smart Contract Audit — OPEN (2 milestones, $10k)");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
