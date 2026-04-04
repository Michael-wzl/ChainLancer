import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);

  const treasuryAddress = process.env.TREASURY_ADDRESS || deployer.address;
  const platformAdminAddress =
    process.env.PLATFORM_ADMIN_ADDRESS || deployer.address;

  // ── Role constants ──
  const ESCROW_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ESCROW_ROLE"));
  const DISPUTE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("DISPUTE_ROLE"));
  const PLATFORM_ADMIN = ethers.keccak256(ethers.toUtf8Bytes("PLATFORM_ADMIN"));

  // 1. Deploy MockUSDC (testnet only)
  console.log("\n1. Deploying MockUSDC...");
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();
  await usdc.waitForDeployment();
  const usdcAddress = await usdc.getAddress();
  console.log("   MockUSDC deployed to:", usdcAddress);

  // 2. Deploy DataAvailability (no dependencies)
  console.log("\n2. Deploying DataAvailability...");
  const DataAvailability = await ethers.getContractFactory("DataAvailability");
  const dataAvailability = await DataAvailability.deploy();
  await dataAvailability.waitForDeployment();
  const dataAvailabilityAddress = await dataAvailability.getAddress();
  console.log("   DataAvailability deployed to:", dataAvailabilityAddress);

  // 3. Deploy Reputation (no dependencies)
  console.log("\n3. Deploying Reputation...");
  const Reputation = await ethers.getContractFactory("Reputation");
  const reputation = await Reputation.deploy();
  await reputation.waitForDeployment();
  const reputationAddress = await reputation.getAddress();
  console.log("   Reputation deployed to:", reputationAddress);

  // 4. Deploy Dispute (needs DataAvailability address; JobEscrow set later)
  console.log("\n4. Deploying Dispute...");
  const Dispute = await ethers.getContractFactory("Dispute");
  const dispute = await Dispute.deploy(dataAvailabilityAddress);
  await dispute.waitForDeployment();
  const disputeAddress = await dispute.getAddress();
  console.log("   Dispute deployed to:", disputeAddress);

  // 5. Deploy JobEscrow (needs all addresses)
  console.log("\n5. Deploying JobEscrow...");
  const JobEscrow = await ethers.getContractFactory("JobEscrow");
  const jobEscrow = await JobEscrow.deploy(
    usdcAddress,
    disputeAddress,
    reputationAddress,
    dataAvailabilityAddress,
    treasuryAddress,
  );
  await jobEscrow.waitForDeployment();
  const jobEscrowAddress = await jobEscrow.getAddress();
  console.log("   JobEscrow deployed to:", jobEscrowAddress);

  // 6. Post-deploy configuration: wire cross-references
  console.log("\n6. Configuring cross-references...");

  // Dispute needs JobEscrow address
  console.log("   Setting JobEscrow on Dispute...");
  await dispute.setJobEscrow(jobEscrowAddress);

  // Grant ESCROW_ROLE to JobEscrow on Reputation
  console.log("   Granting ESCROW_ROLE to JobEscrow on Reputation...");
  await reputation.grantRole(ESCROW_ROLE, jobEscrowAddress);

  // Grant ESCROW_ROLE to JobEscrow on Dispute
  console.log("   Granting ESCROW_ROLE to JobEscrow on Dispute...");
  await dispute.grantRole(ESCROW_ROLE, jobEscrowAddress);

  // Grant DISPUTE_ROLE to Dispute on JobEscrow
  console.log("   Granting DISPUTE_ROLE to Dispute on JobEscrow...");
  await jobEscrow.grantRole(DISPUTE_ROLE, disputeAddress);

  // Grant ESCROW_ROLE to JobEscrow on DataAvailability
  console.log("   Granting ESCROW_ROLE to JobEscrow on DataAvailability...");
  await dataAvailability.grantRole(ESCROW_ROLE, jobEscrowAddress);

  // Grant DISPUTE_ROLE to Dispute on DataAvailability
  console.log("   Granting DISPUTE_ROLE to Dispute on DataAvailability...");
  await dataAvailability.grantRole(DISPUTE_ROLE, disputeAddress);

  // 7. Grant PLATFORM_ADMIN to deployer / admin
  console.log("   Granting PLATFORM_ADMIN on Dispute...");
  await dispute.grantRole(PLATFORM_ADMIN, platformAdminAddress);

  console.log("\n✅ All contracts deployed and configured!");
  console.log("\n── Contract Addresses ──");
  console.log("MockUSDC:          ", usdcAddress);
  console.log("DataAvailability:  ", dataAvailabilityAddress);
  console.log("Reputation:        ", reputationAddress);
  console.log("Dispute:           ", disputeAddress);
  console.log("JobEscrow:         ", jobEscrowAddress);
  console.log("Treasury:          ", treasuryAddress);
  console.log("Platform Admin:    ", platformAdminAddress);

  // ── Print in .env style for Vite ──
  console.log("\n── VITE ENV VARIABLES ──");
  console.log(`VITE_MOCK_USDC_ADDRESS=${usdcAddress}`);
  console.log(`VITE_JOB_ESCROW_ADDRESS=${jobEscrowAddress}`);
  console.log(`VITE_DISPUTE_ADDRESS=${disputeAddress}`);
  console.log(`VITE_REPUTATION_ADDRESS=${reputationAddress}`);
  console.log(`VITE_DATA_AVAILABILITY_ADDRESS=${dataAvailabilityAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
