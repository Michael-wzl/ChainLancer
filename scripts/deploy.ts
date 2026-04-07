import { ethers, upgrades } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);

  const treasuryAddress = process.env.TREASURY_ADDRESS || deployer.address;
  const platformAdminAddress =
    process.env.PLATFORM_ADMIN_ADDRESS || deployer.address;

  // Admin transfer delay: 48 hours for production, 0 for local/testnet
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const isLocalOrTestnet = chainId === 31337n || chainId === 84532n;
  const adminTransferDelay = isLocalOrTestnet ? 0 : 48 * 3600; // 0 for local/testnet, 48h for production

  // ── Role constants ──
  const ESCROW_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ESCROW_ROLE"));
  const DISPUTE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("DISPUTE_ROLE"));
  const PLATFORM_ADMIN = ethers.keccak256(ethers.toUtf8Bytes("PLATFORM_ADMIN"));

  // 1. Deploy MockUSDC (testnet only — not upgradeable)
  console.log("\n1. Deploying MockUSDC...");
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();
  await usdc.waitForDeployment();
  const usdcAddress = await usdc.getAddress();
  console.log("   MockUSDC deployed to:", usdcAddress);

  // 2. Deploy DataAvailability (UUPS proxy)
  console.log("\n2. Deploying DataAvailability (UUPS proxy)...");
  const DataAvailability = await ethers.getContractFactory("DataAvailability");
  const dataAvailability = await upgrades.deployProxy(
    DataAvailability,
    [deployer.address, adminTransferDelay],
    { kind: "uups" }
  );
  await dataAvailability.waitForDeployment();
  const dataAvailabilityAddress = await dataAvailability.getAddress();
  console.log("   DataAvailability proxy deployed to:", dataAvailabilityAddress);

  // 3. Deploy Reputation (UUPS proxy)
  console.log("\n3. Deploying Reputation (UUPS proxy)...");
  const Reputation = await ethers.getContractFactory("Reputation");
  const reputation = await upgrades.deployProxy(
    Reputation,
    [deployer.address, adminTransferDelay],
    { kind: "uups" }
  );
  await reputation.waitForDeployment();
  const reputationAddress = await reputation.getAddress();
  console.log("   Reputation proxy deployed to:", reputationAddress);

  // 4. Deploy Dispute (UUPS proxy)
  console.log("\n4. Deploying Dispute (UUPS proxy)...");
  const Dispute = await ethers.getContractFactory("Dispute");
  const dispute = await upgrades.deployProxy(
    Dispute,
    [dataAvailabilityAddress, deployer.address, adminTransferDelay],
    { kind: "uups", unsafeAllow: ["constructor"] }
  );
  await dispute.waitForDeployment();
  const disputeAddress = await dispute.getAddress();
  console.log("   Dispute proxy deployed to:", disputeAddress);

  // 5. Deploy JobEscrowLib (external library) + JobEscrow (UUPS proxy)
  console.log("\n5. Deploying JobEscrowLib + JobEscrow (UUPS proxy)...");
  const JobEscrowLib = await ethers.getContractFactory("JobEscrowLib");
  const jobEscrowLib = await JobEscrowLib.deploy();
  await jobEscrowLib.waitForDeployment();
  const jobEscrowLibAddress = await jobEscrowLib.getAddress();
  console.log("   JobEscrowLib deployed to:", jobEscrowLibAddress);

  const JobEscrow = await ethers.getContractFactory("JobEscrow", {
    libraries: {
      JobEscrowLib: jobEscrowLibAddress,
    },
  });
  const jobEscrow = await upgrades.deployProxy(
    JobEscrow,
    [
      usdcAddress,
      disputeAddress,
      reputationAddress,
      dataAvailabilityAddress,
      treasuryAddress,
      deployer.address,
      adminTransferDelay,
    ],
    { kind: "uups", unsafeAllow: ["constructor"], unsafeAllowLinkedLibraries: true }
  );
  await jobEscrow.waitForDeployment();
  const jobEscrowAddress = await jobEscrow.getAddress();
  console.log("   JobEscrow proxy deployed to:", jobEscrowAddress);

  // 6. Post-deploy configuration: wire cross-references
  console.log("\n6. Configuring cross-references...");

  // Dispute needs JobEscrow address
  console.log("   Setting JobEscrow on Dispute...");
  let tx = await dispute.setJobEscrow(jobEscrowAddress);
  await tx.wait();

  // Grant ESCROW_ROLE to JobEscrow on Reputation
  console.log("   Granting ESCROW_ROLE to JobEscrow on Reputation...");
  tx = await reputation.grantRole(ESCROW_ROLE, jobEscrowAddress);
  await tx.wait();

  // Grant ESCROW_ROLE to JobEscrow on Dispute
  console.log("   Granting ESCROW_ROLE to JobEscrow on Dispute...");
  tx = await dispute.grantRole(ESCROW_ROLE, jobEscrowAddress);
  await tx.wait();

  // Grant DISPUTE_ROLE to Dispute on JobEscrow
  console.log("   Granting DISPUTE_ROLE to Dispute on JobEscrow...");
  tx = await jobEscrow.grantRole(DISPUTE_ROLE, disputeAddress);
  await tx.wait();

  // Grant ESCROW_ROLE to JobEscrow on DataAvailability
  console.log("   Granting ESCROW_ROLE to JobEscrow on DataAvailability...");
  tx = await dataAvailability.grantRole(ESCROW_ROLE, jobEscrowAddress);
  await tx.wait();

  // Grant DISPUTE_ROLE to Dispute on DataAvailability
  console.log("   Granting DISPUTE_ROLE to Dispute on DataAvailability...");
  tx = await dataAvailability.grantRole(DISPUTE_ROLE, disputeAddress);
  await tx.wait();

  // 7. Grant PLATFORM_ADMIN to deployer / admin
  console.log("   Granting PLATFORM_ADMIN on Dispute...");
  tx = await dispute.grantRole(PLATFORM_ADMIN, platformAdminAddress);
  await tx.wait();

  console.log("\n✅ All contracts deployed and configured!");
  console.log("\n── Contract Addresses (proxy addresses) ──");
  console.log("MockUSDC:          ", usdcAddress);
  console.log("DataAvailability:  ", dataAvailabilityAddress);
  console.log("Reputation:        ", reputationAddress);
  console.log("Dispute:           ", disputeAddress);
  console.log("JobEscrow:         ", jobEscrowAddress);
  console.log("Treasury:          ", treasuryAddress);
  console.log("Platform Admin:    ", platformAdminAddress);
  console.log("Admin Transfer Delay:", adminTransferDelay, "seconds");

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
