import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { MockUSDC, DataAvailability, Reputation, Dispute, JobEscrow } from "../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

/**
 * Shared deployment fixture used by all tests.
 * Deploys all contracts via UUPS proxies, wires cross-references, and returns
 * ready-to-use contract instances + signers.
 */
export async function deployFullPlatformFixture() {
  const [deployer, client, freelancer1, freelancer2, judge, treasury, platformAdmin] =
    await ethers.getSigners();

  // ── Role hashes ──
  const ESCROW_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ESCROW_ROLE"));
  const DISPUTE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("DISPUTE_ROLE"));
  const PLATFORM_ADMIN = ethers.keccak256(ethers.toUtf8Bytes("PLATFORM_ADMIN"));

  // Admin transfer delay: 0 for tests (no need to wait)
  const adminTransferDelay = 0;

  // 1. MockUSDC (not upgradeable)
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();

  // 2. DataAvailability (UUPS proxy)
  const DataAvailability = await ethers.getContractFactory("DataAvailability");
  const dataAvailability = (await upgrades.deployProxy(
    DataAvailability,
    [deployer.address, adminTransferDelay],
    { kind: "uups" }
  )) as unknown as DataAvailability;
  await dataAvailability.waitForDeployment();

  // 3. Reputation (UUPS proxy)
  const ReputationFactory = await ethers.getContractFactory("Reputation");
  const reputation = (await upgrades.deployProxy(
    ReputationFactory,
    [deployer.address, adminTransferDelay],
    { kind: "uups" }
  )) as unknown as Reputation;
  await reputation.waitForDeployment();

  // 4. Dispute (UUPS proxy)
  const DisputeFactory = await ethers.getContractFactory("Dispute");
  const dispute = (await upgrades.deployProxy(
    DisputeFactory,
    [await dataAvailability.getAddress(), deployer.address, adminTransferDelay],
    { kind: "uups", unsafeAllow: ["constructor"] }
  )) as unknown as Dispute;
  await dispute.waitForDeployment();

  // 5. JobEscrow (UUPS proxy) — requires linking JobEscrowLib
  const JobEscrowLib = await ethers.getContractFactory("JobEscrowLib");
  const jobEscrowLib = await JobEscrowLib.deploy();
  await jobEscrowLib.waitForDeployment();

  const JobEscrowFactory = await ethers.getContractFactory("JobEscrow", {
    libraries: {
      JobEscrowLib: await jobEscrowLib.getAddress(),
    },
  });
  const jobEscrow = (await upgrades.deployProxy(
    JobEscrowFactory,
    [
      await usdc.getAddress(),
      await dispute.getAddress(),
      await reputation.getAddress(),
      await dataAvailability.getAddress(),
      treasury.address,
      deployer.address,
      adminTransferDelay,
    ],
    { kind: "uups", unsafeAllow: ["constructor"], unsafeAllowLinkedLibraries: true }
  )) as unknown as JobEscrow;
  await jobEscrow.waitForDeployment();

  // 6. Wire cross-references
  await dispute.setJobEscrow(await jobEscrow.getAddress());
  await reputation.grantRole(ESCROW_ROLE, await jobEscrow.getAddress());
  await dispute.grantRole(ESCROW_ROLE, await jobEscrow.getAddress());
  await jobEscrow.grantRole(DISPUTE_ROLE, await dispute.getAddress());
  await dataAvailability.grantRole(ESCROW_ROLE, await jobEscrow.getAddress());
  await dataAvailability.grantRole(DISPUTE_ROLE, await dispute.getAddress());
  await dispute.grantRole(PLATFORM_ADMIN, platformAdmin.address);

  // 7. Mint USDC for testing
  const MINT_AMOUNT = ethers.parseUnits("1000000", 6); // 1M USDC
  await usdc.mint(client.address, MINT_AMOUNT);
  await usdc.mint(freelancer1.address, MINT_AMOUNT);
  await usdc.mint(freelancer2.address, MINT_AMOUNT);

  // 8. Approve JobEscrow for USDC transfers
  await usdc.connect(client).approve(await jobEscrow.getAddress(), ethers.MaxUint256);
  await usdc.connect(freelancer1).approve(await jobEscrow.getAddress(), ethers.MaxUint256);
  await usdc.connect(freelancer2).approve(await jobEscrow.getAddress(), ethers.MaxUint256);

  return {
    usdc,
    dataAvailability,
    reputation,
    dispute,
    jobEscrow,
    deployer,
    client,
    freelancer1,
    freelancer2,
    judge,
    treasury,
    platformAdmin,
    ESCROW_ROLE,
    DISPUTE_ROLE,
    PLATFORM_ADMIN,
  };
}

// ── Helper constants ──
export const ONE_DAY = 86400;
export const THREE_DAYS = 3 * ONE_DAY;
export const SEVEN_DAYS = 7 * ONE_DAY;
export const FOURTEEN_DAYS = 14 * ONE_DAY;

/** Parse USDC amount (6 decimals) */
export function usdc(amount: number): bigint {
  return ethers.parseUnits(amount.toString(), 6);
}

/** Create a default job: 2 milestones, 7-day review, total 1000 USDC */
export async function createDefaultJob(
  jobEscrow: JobEscrow,
  client: SignerWithAddress,
  reviewTimeout: number = SEVEN_DAYS
) {
  const totalValue = usdc(1000);
  const milestoneValues = [usdc(500), usdc(500)];
  const now = (await ethers.provider.getBlock("latest"))!.timestamp;
  const milestoneDeadlines = [now + 30 * ONE_DAY, now + 60 * ONE_DAY];
  const agreementHash = ethers.keccak256(ethers.toUtf8Bytes("test-agreement-salt-plaintext"));
  const agreementCID = "QmTestAgreementCID123";

  const tx = await jobEscrow
    .connect(client)
    .postJob(agreementHash, milestoneValues, milestoneDeadlines, reviewTimeout, agreementCID);
  const receipt = await tx.wait();

  // Extract jobId from event
  const event = receipt?.logs.find((log: any) => {
    try {
      return jobEscrow.interface.parseLog({ topics: log.topics as string[], data: log.data })?.name === "JobPosted";
    } catch { return false; }
  });
  const parsed = jobEscrow.interface.parseLog({ topics: event!.topics as string[], data: event!.data });
  const jobId = parsed!.args.jobId;

  return { jobId, totalValue, milestoneValues, milestoneDeadlines, agreementHash };
}

/** Advance a job to Active state: post → apply → select → stake */
export async function advanceJobToActive(
  jobEscrow: JobEscrow,
  usdc_contract: MockUSDC,
  client: SignerWithAddress,
  freelancer: SignerWithAddress,
  reviewTimeout: number = SEVEN_DAYS
) {
  const { jobId, totalValue, milestoneValues, milestoneDeadlines, agreementHash } =
    await createDefaultJob(jobEscrow, client, reviewTimeout);

  // Apply
  const proposalHash = ethers.keccak256(ethers.toUtf8Bytes("proposal"));
  await jobEscrow.connect(freelancer).applyForJob(jobId, proposalHash, "QmTestProposalCID");

  // Select
  const encryptedKey = ethers.toUtf8Bytes("encrypted-job-key");
  await jobEscrow.connect(client).selectFreelancer(jobId, freelancer.address, encryptedKey);

  // Stake
  await jobEscrow.connect(freelancer).confirmAndStake(jobId);

  return { jobId, totalValue, milestoneValues, milestoneDeadlines, agreementHash };
}
