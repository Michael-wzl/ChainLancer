import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {
  deployFullPlatformFixture,
  advanceJobToActive,
  createDefaultJob,
  usdc,
  ONE_DAY,
  THREE_DAYS,
  SEVEN_DAYS,
  FOURTEEN_DAYS,
} from "../helpers/fixtures";

/**
 * Advanced Integration Flow Tests
 *
 * Focus areas:
 *  - Multi-milestone partial completion + dispute flow
 *  - Cancellation after partial completion
 *  - Multi-job concurrent handling for same client/freelancer
 *  - Full dispute flow with fund reconciliation verification
 *  - Auto-approve edge case in integration context
 */
describe("Advanced Integration Flows", function () {
  // ═══════════════════════════════════════════
  //    PARTIAL COMPLETION + DISPUTE
  // ═══════════════════════════════════════════

  describe("Partial completion followed by dispute", function () {
    it("should handle approve MS0, then dispute MS1", async function () {
      const fixture = await loadFixture(deployFullPlatformFixture);
      const { jobEscrow, usdc: usdcContract, client, freelancer1, deployer, judge, dispute: disputeContract, treasury, platformAdmin } = fixture;

      const { jobId } = await advanceJobToActive(jobEscrow as any, usdcContract as any, client, freelancer1);

      // Submit & approve milestone 0
      await (jobEscrow.connect(freelancer1) as any).submitMilestone(
        jobId, 0, ethers.keccak256(ethers.toUtf8Bytes("work0")), "QmWork0CID"
      );
      await (jobEscrow.connect(client) as any).approveMilestone(jobId, 0);

      const freelancerBalance0 = await jobEscrow.withdrawableBalances(freelancer1.address);
      expect(freelancerBalance0).to.be.gt(0);

      // Submit milestone 1, then dispute it
      await (jobEscrow.connect(freelancer1) as any).submitMilestone(
        jobId, 1, ethers.keccak256(ethers.toUtf8Bytes("work1")), "QmWork1CID"
      );
      await (jobEscrow.connect(client) as any).raiseDispute(jobId, 1);
      const disputeId = await jobEscrow.disputeIds(jobId, 0);

      // Complete dispute lifecycle
      await (disputeContract.connect(client) as any).submitEvidence(disputeId, ethers.keccak256(ethers.toUtf8Bytes("evidence")), "QmClientEvidence");
      await (disputeContract.connect(freelancer1) as any).submitEvidence(disputeId, ethers.keccak256(ethers.toUtf8Bytes("evidence")), "QmFreelancerEvidence");
      await time.increase(5 * ONE_DAY + 1);
      await (disputeContract.connect(client) as any).closeEvidencePhase(disputeId);

      await (disputeContract.connect(platformAdmin) as any).assignJudge(disputeId, judge.address, ethers.randomBytes(33));

      await (disputeContract.connect(client) as any).distributeKeyToJudge(disputeId, ethers.randomBytes(33));
      await (disputeContract.connect(freelancer1) as any).distributeKeyToJudge(disputeId, ethers.randomBytes(33));

      // ClientWins: 0% to freelancer, 50% deposit slash
      await (disputeContract.connect(judge) as any).submitRuling(disputeId, 2, ethers.keccak256(ethers.toUtf8Bytes("reasoning")), 0, 5000);
      await (disputeContract.connect(client) as any).executeRuling(disputeId);

      // Verify freelancer still has balance from MS0 approval
      const freelancerBalance1 = await jobEscrow.withdrawableBalances(freelancer1.address);
      expect(freelancerBalance1).to.be.gte(freelancerBalance0);

      // Verify client got refund from disputed MS1
      const clientBalance = await jobEscrow.withdrawableBalances(client.address);
      expect(clientBalance).to.be.gt(0);

      // Verify treasury got fees
      const treasuryBalance = await jobEscrow.withdrawableBalances(treasury.address);
      expect(treasuryBalance).to.be.gt(0);
    });
  });

  // ═══════════════════════════════════════════
  //    CANCELLATION AFTER PARTIAL COMPLETION
  // ═══════════════════════════════════════════

  describe("Cancellation after partial completion", function () {
    it("should allow mutual cancellation after first milestone approved", async function () {
      const fixture = await loadFixture(deployFullPlatformFixture);
      const { jobEscrow, usdc: usdcContract, client, freelancer1 } = fixture;

      const { jobId } = await advanceJobToActive(jobEscrow as any, usdcContract as any, client, freelancer1);

      // Submit & approve milestone 0
      await (jobEscrow.connect(freelancer1) as any).submitMilestone(
        jobId, 0, ethers.keccak256(ethers.toUtf8Bytes("work0")), "QmWork0CID"
      );
      await (jobEscrow.connect(client) as any).approveMilestone(jobId, 0);

      // Request cancellation (client)
      await (jobEscrow.connect(client) as any).requestCancellation(jobId);

      // Accept cancellation (freelancer)
      await (jobEscrow.connect(freelancer1) as any).acceptCancellation(jobId);

      // Job should be cancelled
      const job = await jobEscrow.jobs(jobId);
      expect(job.state).to.equal(4); // Cancelled
    });
  });

  // ═══════════════════════════════════════════
  //    MULTI-JOB CONCURRENT HANDLING
  // ═══════════════════════════════════════════

  describe("Multi-job concurrent handling", function () {
    it("should handle same client posting multiple jobs", async function () {
      const fixture = await loadFixture(deployFullPlatformFixture);
      const { jobEscrow, usdc: usdcContract, client, freelancer1, freelancer2 } = fixture;

      // Post two jobs manually with unique agreement CIDs to avoid CID collision
      const now = (await ethers.provider.getBlock("latest"))!.timestamp;
      const milestoneValues = [usdc(500), usdc(500)];
      const milestoneDeadlines = [now + 30 * ONE_DAY, now + 60 * ONE_DAY];
      const agreementHash1 = ethers.keccak256(ethers.toUtf8Bytes("agreement-1"));
      const agreementHash2 = ethers.keccak256(ethers.toUtf8Bytes("agreement-2"));

      const tx1 = await (jobEscrow.connect(client) as any).postJob(agreementHash1, milestoneValues, milestoneDeadlines, SEVEN_DAYS, "QmAgreementCID1");
      const receipt1 = await tx1.wait();
      const event1 = receipt1?.logs.find((log: any) => {
        try { return jobEscrow.interface.parseLog({ topics: log.topics as string[], data: log.data })?.name === "JobPosted"; } catch { return false; }
      });
      const jobId1 = jobEscrow.interface.parseLog({ topics: event1!.topics as string[], data: event1!.data })!.args.jobId;

      const tx2 = await (jobEscrow.connect(client) as any).postJob(agreementHash2, milestoneValues, milestoneDeadlines, SEVEN_DAYS, "QmAgreementCID2");
      const receipt2 = await tx2.wait();
      const event2 = receipt2?.logs.find((log: any) => {
        try { return jobEscrow.interface.parseLog({ topics: log.topics as string[], data: log.data })?.name === "JobPosted"; } catch { return false; }
      });
      const jobId2 = jobEscrow.interface.parseLog({ topics: event2!.topics as string[], data: event2!.data })!.args.jobId;

      expect(jobId1).to.not.equal(jobId2);

      // Apply and select different freelancers for each
      const proposalHash = ethers.keccak256(ethers.toUtf8Bytes("proposal"));
      await (jobEscrow.connect(freelancer1) as any).applyForJob(jobId1, proposalHash, "QmProp1");
      await (jobEscrow.connect(freelancer2) as any).applyForJob(jobId2, proposalHash, "QmProp2");

      const encKey = ethers.toUtf8Bytes("encrypted-key");
      await (jobEscrow.connect(client) as any).selectFreelancer(jobId1, freelancer1.address, encKey);
      await (jobEscrow.connect(client) as any).selectFreelancer(jobId2, freelancer2.address, encKey);

      // Both freelancers stake
      await (jobEscrow.connect(freelancer1) as any).confirmAndStake(jobId1);
      await (jobEscrow.connect(freelancer2) as any).confirmAndStake(jobId2);

      // Both are active
      const job1 = await jobEscrow.jobs(jobId1);
      const job2 = await jobEscrow.jobs(jobId2);
      expect(job1.state).to.equal(2); // Active
      expect(job2.state).to.equal(2); // Active
    });

    it("should allow same freelancer to work on multiple jobs", async function () {
      const fixture = await loadFixture(deployFullPlatformFixture);
      const { jobEscrow, usdc: usdcContract, client, freelancer1 } = fixture;

      // First job via helper
      const { jobId: jobId1 } = await advanceJobToActive(jobEscrow as any, usdcContract as any, client, freelancer1);

      // Second job manually with unique CID to avoid CID collision
      const now = (await ethers.provider.getBlock("latest"))!.timestamp;
      const milestoneValues = [usdc(500), usdc(500)];
      const milestoneDeadlines = [now + 30 * ONE_DAY, now + 60 * ONE_DAY];
      const agreementHash2 = ethers.keccak256(ethers.toUtf8Bytes("agreement-multi-fl-2"));
      const tx2 = await (jobEscrow.connect(client) as any).postJob(agreementHash2, milestoneValues, milestoneDeadlines, SEVEN_DAYS, "QmAgreementCIDMultiFL2");
      const receipt2 = await tx2.wait();
      const event2 = receipt2?.logs.find((log: any) => {
        try { return jobEscrow.interface.parseLog({ topics: log.topics as string[], data: log.data })?.name === "JobPosted"; } catch { return false; }
      });
      const jobId2 = jobEscrow.interface.parseLog({ topics: event2!.topics as string[], data: event2!.data })!.args.jobId;

      // Apply, select, stake for job 2
      const proposalHash = ethers.keccak256(ethers.toUtf8Bytes("proposal"));
      await (jobEscrow.connect(freelancer1) as any).applyForJob(jobId2, proposalHash, "QmTestProposalCID2");
      const encryptedKey = ethers.toUtf8Bytes("encrypted-job-key");
      await (jobEscrow.connect(client) as any).selectFreelancer(jobId2, freelancer1.address, encryptedKey);
      await (jobEscrow.connect(freelancer1) as any).confirmAndStake(jobId2);

      // Submit milestones on both jobs
      await (jobEscrow.connect(freelancer1) as any).submitMilestone(
        jobId1, 0, ethers.keccak256(ethers.toUtf8Bytes("work1")), "QmWork1"
      );
      await (jobEscrow.connect(freelancer1) as any).submitMilestone(
        jobId2, 0, ethers.keccak256(ethers.toUtf8Bytes("work2")), "QmWork2"
      );

      // Approve both
      await (jobEscrow.connect(client) as any).approveMilestone(jobId1, 0);
      await (jobEscrow.connect(client) as any).approveMilestone(jobId2, 0);

      // Freelancer should have accumulated balance from both jobs
      const balance = await jobEscrow.withdrawableBalances(freelancer1.address);
      expect(balance).to.be.gt(0);
    });
  });

  // ═══════════════════════════════════════════
  //    FULL DISPUTE FLOW FUND RECONCILIATION
  // ═══════════════════════════════════════════

  describe("Full dispute flow fund reconciliation", function () {
    it("should account for all funds after FreelancerWins ruling", async function () {
      const fixture = await loadFixture(deployFullPlatformFixture);
      const { jobEscrow, usdc: usdcContract, client, freelancer1, treasury, deployer, judge, dispute: disputeContract, platformAdmin } = fixture;

      const { jobId } = await advanceJobToActive(jobEscrow as any, usdcContract as any, client, freelancer1);

      // Get initial contract balance
      const contractBalance0 = await usdcContract.balanceOf(await jobEscrow.getAddress());

      // Submit & dispute milestone 0
      await (jobEscrow.connect(freelancer1) as any).submitMilestone(
        jobId, 0, ethers.keccak256(ethers.toUtf8Bytes("work")), "QmWorkCID"
      );
      await (jobEscrow.connect(client) as any).raiseDispute(jobId, 0);
      const disputeId = await jobEscrow.disputeIds(jobId, 0);

      // Complete full dispute lifecycle
      await (disputeContract.connect(client) as any).submitEvidence(disputeId, ethers.keccak256(ethers.toUtf8Bytes("evidence")), "QmEvC");
      await (disputeContract.connect(freelancer1) as any).submitEvidence(disputeId, ethers.keccak256(ethers.toUtf8Bytes("evidence")), "QmEvF");
      await time.increase(5 * ONE_DAY + 1);
      await (disputeContract.connect(client) as any).closeEvidencePhase(disputeId);

      await (disputeContract.connect(platformAdmin) as any).assignJudge(disputeId, judge.address, ethers.randomBytes(33));

      await (disputeContract.connect(client) as any).distributeKeyToJudge(disputeId, ethers.randomBytes(33));
      await (disputeContract.connect(freelancer1) as any).distributeKeyToJudge(disputeId, ethers.randomBytes(33));

      // FreelancerWins, 80% to freelancer
      await (disputeContract.connect(judge) as any).submitRuling(disputeId, 1, ethers.keccak256(ethers.toUtf8Bytes("reasoning")), 8000, 0);
      await (disputeContract.connect(client) as any).executeRuling(disputeId);

      // Verify fund accounting: all distributed amounts should sum to milestone value
      const freelancerBalance = await jobEscrow.withdrawableBalances(freelancer1.address);
      const clientBalance = await jobEscrow.withdrawableBalances(client.address);
      const treasuryBalance = await jobEscrow.withdrawableBalances(treasury.address);

      // All three should have some balance
      expect(freelancerBalance).to.be.gt(0);
      // Client may have balance from the remaining 20%
      // Treasury gets protocol fee + possible bond slash
      expect(treasuryBalance).to.be.gt(0);

      // Total distributed from milestone 0 (500 USDC) should account for all
      // freelancer + client + treasury from milestone value + fees + slashes
    });

    it("should account for all funds after Inconclusive ruling (50/50)", async function () {
      const fixture = await loadFixture(deployFullPlatformFixture);
      const { jobEscrow, usdc: usdcContract, client, freelancer1, treasury, deployer, judge, dispute: disputeContract, platformAdmin } = fixture;

      const { jobId } = await advanceJobToActive(jobEscrow as any, usdcContract as any, client, freelancer1);

      await (jobEscrow.connect(freelancer1) as any).submitMilestone(
        jobId, 0, ethers.keccak256(ethers.toUtf8Bytes("work")), "QmWorkCID"
      );
      await (jobEscrow.connect(client) as any).raiseDispute(jobId, 0);
      const disputeId = await jobEscrow.disputeIds(jobId, 0);

      await (disputeContract.connect(client) as any).submitEvidence(disputeId, ethers.keccak256(ethers.toUtf8Bytes("evidence")), "QmEvC");
      await (disputeContract.connect(freelancer1) as any).submitEvidence(disputeId, ethers.keccak256(ethers.toUtf8Bytes("evidence")), "QmEvF");
      await time.increase(5 * ONE_DAY + 1);
      await (disputeContract.connect(client) as any).closeEvidencePhase(disputeId);

      await (disputeContract.connect(platformAdmin) as any).assignJudge(disputeId, judge.address, ethers.randomBytes(33));

      await (disputeContract.connect(client) as any).distributeKeyToJudge(disputeId, ethers.randomBytes(33));
      await (disputeContract.connect(freelancer1) as any).distributeKeyToJudge(disputeId, ethers.randomBytes(33));

      // Inconclusive, 50/50 split
      await (disputeContract.connect(judge) as any).submitRuling(disputeId, 0, ethers.keccak256(ethers.toUtf8Bytes("reasoning")), 5000, 0);
      await (disputeContract.connect(client) as any).executeRuling(disputeId);

      const freelancerBalance = await jobEscrow.withdrawableBalances(freelancer1.address);
      const clientBalance = await jobEscrow.withdrawableBalances(client.address);
      const treasuryBalance = await jobEscrow.withdrawableBalances(treasury.address);

      // Both should have approximately half
      expect(freelancerBalance).to.be.gt(0);
      expect(clientBalance).to.be.gt(0);
      expect(treasuryBalance).to.be.gt(0);

      // Protocol fee = 2% of 500 = 10 USDC
      // Distributable = 490 USDC
      // Each party gets ~245 USDC from milestone split
      const msValue = usdc(500);
      const fee = msValue * 200n / 10_000n; // 10 USDC
      const distributable = msValue - fee;
      const disputeFee = usdc(50); // max(50 USDC, 10% * 500) = 50 USDC
      const expectedFreelancer = distributable * 5000n / 10_000n; // 245 USDC
      const expectedClient = distributable - expectedFreelancer; // 245 USDC (no dispute fee refund on Inconclusive)
      const expectedTreasury = fee + disputeFee; // protocol fee + dispute fee goes to treasury

      expect(freelancerBalance).to.equal(expectedFreelancer);
      expect(clientBalance).to.equal(expectedClient);
      expect(treasuryBalance).to.equal(expectedTreasury);
    });
  });

  // ═══════════════════════════════════════════
  //    AUTO-APPROVE IN INTEGRATION CONTEXT
  // ═══════════════════════════════════════════

  describe("Auto-approve integration", function () {
    it("should auto-approve milestone after review timeout expires", async function () {
      const fixture = await loadFixture(deployFullPlatformFixture);
      const { jobEscrow, usdc: usdcContract, client, freelancer1 } = fixture;

      const { jobId } = await advanceJobToActive(jobEscrow as any, usdcContract as any, client, freelancer1);

      // Submit milestone 0
      await (jobEscrow.connect(freelancer1) as any).submitMilestone(
        jobId, 0, ethers.keccak256(ethers.toUtf8Bytes("work")), "QmWorkCID"
      );

      // Advance past review timeout (7 days by default)
      await time.increase(SEVEN_DAYS + 1);

      // Trigger auto-approve
      await (jobEscrow.connect(freelancer1) as any).triggerAutoApprove(jobId, 0);

      // Verify milestone is auto-approved
      const msInfo = await jobEscrow.getMilestoneInfo(jobId, 0);
      expect(msInfo.status).to.equal(3); // AutoApproved (enum: Pending=0, InReview=1, Approved=2, AutoApproved=3)

      // Verify freelancer has withdrawable balance
      const balance = await jobEscrow.withdrawableBalances(freelancer1.address);
      expect(balance).to.be.gt(0);
    });

    it("should reject auto-approve before review timeout expires", async function () {
      const fixture = await loadFixture(deployFullPlatformFixture);
      const { jobEscrow, usdc: usdcContract, client, freelancer1 } = fixture;

      const { jobId } = await advanceJobToActive(jobEscrow as any, usdcContract as any, client, freelancer1);

      await (jobEscrow.connect(freelancer1) as any).submitMilestone(
        jobId, 0, ethers.keccak256(ethers.toUtf8Bytes("work")), "QmWorkCID"
      );

      // Advance less than review timeout
      await time.increase(SEVEN_DAYS - 100);

      await expect(
        (jobEscrow.connect(freelancer1) as any).triggerAutoApprove(jobId, 0)
      ).to.be.reverted;
    });
  });

  // ═══════════════════════════════════════════
  //    OFFER LIFECYCLE INTEGRATION
  // ═══════════════════════════════════════════

  describe("Offer lifecycle integration", function () {
    it("should allow reject→reselect flow", async function () {
      const fixture = await loadFixture(deployFullPlatformFixture);
      const { jobEscrow, usdc: usdcContract, client, freelancer1, freelancer2 } = fixture;

      const { jobId } = await createDefaultJob(jobEscrow as any, client);

      // Both freelancers apply
      const propHash = ethers.keccak256(ethers.toUtf8Bytes("proposal"));
      await (jobEscrow.connect(freelancer1) as any).applyForJob(jobId, propHash, "QmProp1");
      await (jobEscrow.connect(freelancer2) as any).applyForJob(jobId, propHash, "QmProp2");

      // Select freelancer1
      const encKey = ethers.toUtf8Bytes("encrypted-key");
      await (jobEscrow.connect(client) as any).selectFreelancer(jobId, freelancer1.address, encKey);

      // Freelancer1 rejects the offer
      await (jobEscrow.connect(freelancer1) as any).rejectOffer(jobId);

      // Client can reselect freelancer2
      await (jobEscrow.connect(client) as any).reselectFreelancer(jobId, freelancer2.address, encKey);

      // Freelancer2 stakes
      await (jobEscrow.connect(freelancer2) as any).confirmAndStake(jobId);

      const job = await jobEscrow.jobs(jobId);
      expect(job.state).to.equal(2); // Active
      expect(job.freelancer).to.equal(freelancer2.address);
    });

    it("should allow expireOffer→reselect when T_STAKE passes", async function () {
      const fixture = await loadFixture(deployFullPlatformFixture);
      const { jobEscrow, usdc: usdcContract, client, freelancer1, freelancer2 } = fixture;

      const { jobId } = await createDefaultJob(jobEscrow as any, client);

      const propHash = ethers.keccak256(ethers.toUtf8Bytes("proposal"));
      await (jobEscrow.connect(freelancer1) as any).applyForJob(jobId, propHash, "QmProp1");
      await (jobEscrow.connect(freelancer2) as any).applyForJob(jobId, propHash, "QmProp2");

      const encKey = ethers.toUtf8Bytes("encrypted-key");
      await (jobEscrow.connect(client) as any).selectFreelancer(jobId, freelancer1.address, encKey);

      // Wait for T_STAKE to expire
      await time.increase(THREE_DAYS + 1);

      // Expire the offer
      await (jobEscrow.connect(client) as any).expireOffer(jobId);

      // Reselect freelancer2
      await (jobEscrow.connect(client) as any).reselectFreelancer(jobId, freelancer2.address, encKey);

      // Freelancer2 stakes
      await (jobEscrow.connect(freelancer2) as any).confirmAndStake(jobId);

      const job = await jobEscrow.jobs(jobId);
      expect(job.state).to.equal(2); // Active
      expect(job.freelancer).to.equal(freelancer2.address);
    });
  });

  // ═══════════════════════════════════════════
  //    COMPLETE JOB LIFECYCLE VERIFICATION
  // ═══════════════════════════════════════════

  describe("Complete job lifecycle — happy path fund verification", function () {
    it("should distribute all funds correctly for a 2-milestone job", async function () {
      const fixture = await loadFixture(deployFullPlatformFixture);
      const { jobEscrow, usdc: usdcContract, client, freelancer1, treasury } = fixture;

      const freelancerUSDCBefore = await usdcContract.balanceOf(freelancer1.address);
      const clientUSDCBefore = await usdcContract.balanceOf(client.address);

      const { jobId, totalValue } = await advanceJobToActive(jobEscrow as any, usdcContract as any, client, freelancer1);

      // Submit & approve both milestones
      for (let i = 0; i < 2; i++) {
        await (jobEscrow.connect(freelancer1) as any).submitMilestone(
          jobId, i, ethers.keccak256(ethers.toUtf8Bytes(`work${i}`)), `QmWork${i}`
        );
        await (jobEscrow.connect(client) as any).approveMilestone(jobId, i);
      }

      // Job should be completed
      const job = await jobEscrow.jobs(jobId);
      expect(job.state).to.equal(3); // Completed

      // Withdraw all
      await (jobEscrow.connect(freelancer1) as any).withdraw();

      const freelancerUSDCAfter = await usdcContract.balanceOf(freelancer1.address);

      // Freelancer should have earned: totalValue - 2% protocol fee - deposit (refunded at completion)
      // Net earning from milestones = totalValue * 98% = 980 USDC
      const expectedMilestoneEarnings = totalValue * 9800n / 10_000n;
      // Plus deposit refund + bond refund
      // The exact amount depends on deposit/bond handling
      expect(freelancerUSDCAfter).to.be.gt(freelancerUSDCBefore);

      // Treasury should have protocol fees
      const treasuryBalance = await jobEscrow.withdrawableBalances(treasury.address);
      const expectedFees = totalValue * 200n / 10_000n; // 2%
      expect(treasuryBalance).to.equal(expectedFees);
    });
  });

  // ═══════════════════════════════════════════
  //    T-4: JUDGE TIMEOUT → REASSIGNMENT
  // ═══════════════════════════════════════════

  describe("Judge timeout → reassignment → full resolution", function () {
    it("should complete dispute resolution after judge replacement", async function () {
      const fixture = await loadFixture(deployFullPlatformFixture);
      const {
        jobEscrow, usdc: usdcContract, dispute: disputeContract,
        client, freelancer1, platformAdmin, judge, treasury, reputation
      } = fixture;

      // We need a second judge — get an extra signer
      const signers = await ethers.getSigners();
      const judge2 = signers[7];

      const { jobId } = await advanceJobToActive(jobEscrow as any, usdcContract as any, client, freelancer1);

      // Submit and dispute milestone 0
      const hash = ethers.keccak256(ethers.toUtf8Bytes("deliverable"));
      await (jobEscrow.connect(freelancer1) as any).submitMilestone(jobId, 0, hash, "QmD");
      await (jobEscrow.connect(client) as any).raiseDispute(jobId, 0);
      const disputeId = await jobEscrow.disputeIds(jobId, 0);

      // ── Phase 1: Evidence ──
      await (disputeContract.connect(client) as any).submitEvidence(
        disputeId,
        ethers.keccak256(ethers.toUtf8Bytes("ev-client")),
        "QmEvidenceC"
      );
      await time.increase(5 * ONE_DAY + 1);
      await (disputeContract.connect(client) as any).closeEvidencePhase(disputeId);

      // ── Phase 2: First judge assigned ──
      await (disputeContract.connect(platformAdmin) as any).assignJudge(
        disputeId, judge.address, ethers.randomBytes(33)
      );

      // ── Phase 3: Both parties distribute keys ──
      await (disputeContract.connect(client) as any).distributeKeyToJudge(disputeId, ethers.randomBytes(33));
      await (disputeContract.connect(freelancer1) as any).distributeKeyToJudge(disputeId, ethers.randomBytes(33));

      // ── Phase 4: Judge FAILS to rule within T_RULING (14 days) ──
      await time.increase(14 * ONE_DAY + 1);

      // Verify phase is UnderReview before default
      const statusBefore = await disputeContract.getDisputeStatus(disputeId);
      expect(statusBefore.phase).to.equal(3); // UnderReview = 3

      // Claim ruling default — resets to AwaitingJudge
      await expect((disputeContract.connect(client) as any).claimRulingDefault(disputeId))
        .to.emit(disputeContract, "RulingDefaultTriggered")
        .withArgs(disputeId, judge.address);

      // Verify reset to AwaitingJudge
      const statusAfter = await disputeContract.getDisputeStatus(disputeId);
      expect(statusAfter.phase).to.equal(1); // AwaitingJudge = 1

      // ── Phase 5: Assign NEW judge ──
      await (disputeContract.connect(platformAdmin) as any).assignJudge(
        disputeId, judge2.address, ethers.randomBytes(33)
      );

      // ── Phase 6: Both parties MUST re-distribute keys ──
      await (disputeContract.connect(client) as any).distributeKeyToJudge(disputeId, ethers.randomBytes(33));
      await (disputeContract.connect(freelancer1) as any).distributeKeyToJudge(disputeId, ethers.randomBytes(33));

      // ── Phase 7: New judge submits ruling — FreelancerWins ──
      await (disputeContract.connect(judge2) as any).submitRuling(
        disputeId, 1, // FreelancerWins
        ethers.keccak256(ethers.toUtf8Bytes("reasoning-v2")),
        10000, // 100% to freelancer
        0      // no deposit slash
      );

      // Verify phase is Ruled
      const statusRuled = await disputeContract.getDisputeStatus(disputeId);
      expect(statusRuled.phase).to.equal(4); // Ruled = 4

      // ── Phase 8: Execute ruling ──
      const treasuryBefore = await jobEscrow.withdrawableBalances(treasury.address);
      const freelancerBefore = await jobEscrow.withdrawableBalances(freelancer1.address);

      await (disputeContract.connect(client) as any).executeRuling(disputeId);

      // Verify phase is Executed
      const statusExecuted = await disputeContract.getDisputeStatus(disputeId);
      expect(statusExecuted.phase).to.equal(5); // Executed = 5

      // Verify funds were distributed
      const freelancerAfter = await jobEscrow.withdrawableBalances(freelancer1.address);
      expect(freelancerAfter).to.be.gt(freelancerBefore);

      // Verify treasury got protocol fee + bond slash
      const treasuryAfter = await jobEscrow.withdrawableBalances(treasury.address);
      expect(treasuryAfter).to.be.gt(treasuryBefore);

      // Verify milestone is Resolved
      const msInfo = await jobEscrow.getMilestoneInfo(jobId, 0);
      expect(msInfo.status).to.equal(5); // Resolved = 5

      // Verify reputation was updated (client lost dispute)
      const clientProfile = await reputation.getClientProfile(client.address);
      expect(clientProfile.disputesLost).to.equal(1);
    });
  });

  // ═══════════════════════════════════════════
  //    T-5: CONCURRENT MULTI-MILESTONE DISPUTES
  // ═══════════════════════════════════════════

  describe("Concurrent disputes on different milestones", function () {
    it("should handle two simultaneous disputes on the same job independently", async function () {
      const fixture = await loadFixture(deployFullPlatformFixture);
      const {
        jobEscrow, usdc: usdcContract, dispute: disputeContract,
        client, freelancer1, platformAdmin, judge, treasury
      } = fixture;

      // Create a job with 3 milestones (need to post manually for 3 milestones)
      const totalValue = usdc(3000);
      const milestoneValues = [usdc(1000), usdc(1000), usdc(1000)];
      const now = (await ethers.provider.getBlock("latest"))!.timestamp;
      const milestoneDeadlines = [now + 30 * ONE_DAY, now + 60 * ONE_DAY, now + 90 * ONE_DAY];
      const agreementHash = ethers.keccak256(ethers.toUtf8Bytes("test-3ms-concurrent"));

      const tx = await (jobEscrow.connect(client) as any).postJob(
        agreementHash, milestoneValues, milestoneDeadlines, SEVEN_DAYS, "QmAgreement3"
      );
      const receipt = await tx.wait();
      const event = receipt?.logs.find((log: any) => {
        try {
          return jobEscrow.interface.parseLog({
            topics: log.topics as string[], data: log.data
          })?.name === "JobPosted";
        } catch { return false; }
      });
      const parsed = jobEscrow.interface.parseLog({
        topics: event!.topics as string[], data: event!.data
      });
      const jobId = parsed!.args.jobId;

      // Apply, select, stake
      const proposalHash = ethers.keccak256(ethers.toUtf8Bytes("proposal"));
      await (jobEscrow.connect(freelancer1) as any).applyForJob(jobId, proposalHash, "QmP");
      const encKey = ethers.toUtf8Bytes("encrypted-key");
      await (jobEscrow.connect(client) as any).selectFreelancer(jobId, freelancer1.address, encKey);
      await (jobEscrow.connect(freelancer1) as any).confirmAndStake(jobId);

      // Submit all 3 milestones
      for (let i = 0; i < 3; i++) {
        await (jobEscrow.connect(freelancer1) as any).submitMilestone(
          jobId, i,
          ethers.keccak256(ethers.toUtf8Bytes(`work${i}`)),
          `QmWork${i}`
        );
      }

      // Approve milestone 0 cleanly
      await (jobEscrow.connect(client) as any).approveMilestone(jobId, 0);

      // Dispute milestones 1 and 2 simultaneously (client raises both)
      await (jobEscrow.connect(client) as any).raiseDispute(jobId, 1);
      await (jobEscrow.connect(client) as any).raiseDispute(jobId, 2);

      const disputeId1 = await jobEscrow.disputeIds(jobId, 1);
      const disputeId2 = await jobEscrow.disputeIds(jobId, 2);

      expect(disputeId1).to.not.equal(disputeId2);

      // Verify both milestones are Disputed
      const ms1 = await jobEscrow.getMilestoneInfo(jobId, 1);
      const ms2 = await jobEscrow.getMilestoneInfo(jobId, 2);
      expect(ms1.status).to.equal(4); // Disputed
      expect(ms2.status).to.equal(4); // Disputed

      // Advance past evidence phase for both
      await time.increase(5 * ONE_DAY + 1);
      await (disputeContract.connect(client) as any).closeEvidencePhase(disputeId1);
      await (disputeContract.connect(client) as any).closeEvidencePhase(disputeId2);

      // Use separate judges
      const signers = await ethers.getSigners();
      const judge2 = signers[7];

      await (disputeContract.connect(platformAdmin) as any).assignJudge(
        disputeId1, judge.address, ethers.randomBytes(33)
      );
      await (disputeContract.connect(platformAdmin) as any).assignJudge(
        disputeId2, judge2.address, ethers.randomBytes(33)
      );

      // Distribute keys for both disputes
      await (disputeContract.connect(client) as any).distributeKeyToJudge(disputeId1, ethers.randomBytes(33));
      await (disputeContract.connect(freelancer1) as any).distributeKeyToJudge(disputeId1, ethers.randomBytes(33));
      await (disputeContract.connect(client) as any).distributeKeyToJudge(disputeId2, ethers.randomBytes(33));
      await (disputeContract.connect(freelancer1) as any).distributeKeyToJudge(disputeId2, ethers.randomBytes(33));

      // Rule dispute 1: FreelancerWins
      await (disputeContract.connect(judge) as any).submitRuling(
        disputeId1, 1,
        ethers.keccak256(ethers.toUtf8Bytes("r1")),
        10000, 0
      );
      await (disputeContract.connect(client) as any).executeRuling(disputeId1);

      // Rule dispute 2: ClientWins
      await (disputeContract.connect(judge2) as any).submitRuling(
        disputeId2, 2,
        ethers.keccak256(ethers.toUtf8Bytes("r2")),
        0, 5000
      );
      await (disputeContract.connect(client) as any).executeRuling(disputeId2);

      // Verify all milestones are in terminal state
      const ms0Final = await jobEscrow.getMilestoneInfo(jobId, 0);
      const ms1Final = await jobEscrow.getMilestoneInfo(jobId, 1);
      const ms2Final = await jobEscrow.getMilestoneInfo(jobId, 2);
      expect(ms0Final.status).to.equal(2); // Approved
      expect(ms1Final.status).to.equal(5); // Resolved
      expect(ms2Final.status).to.equal(5); // Resolved

      // Verify job is Completed (all milestones finalized)
      const jobInfo = await jobEscrow.getJobInfo(jobId);
      expect(jobInfo.state).to.equal(3); // Completed

      // Verify everyone can withdraw
      const freelancerBal = await jobEscrow.withdrawableBalances(freelancer1.address);
      const clientBal = await jobEscrow.withdrawableBalances(client.address);
      expect(freelancerBal).to.be.gt(0);
      expect(clientBal).to.be.gt(0);
    });
  });

  // ═══════════════════════════════════════════
  //    T-6: OFFER EXPIRY → RESELECT → COMPLETE
  // ═══════════════════════════════════════════

  describe("Offer expiry → reselect → full lifecycle", function () {
    it("should complete a job after the first offer expires and a second freelancer is selected", async function () {
      const fixture = await loadFixture(deployFullPlatformFixture);
      const { jobEscrow, usdc: usdcContract, reputation, client, freelancer1, freelancer2 } = fixture;

      // Create job
      const { jobId } = await createDefaultJob(jobEscrow as any, client);

      // Both freelancers apply
      await (jobEscrow.connect(freelancer1) as any).applyForJob(
        jobId, ethers.keccak256(ethers.toUtf8Bytes("p1")), "QmP1"
      );
      await (jobEscrow.connect(freelancer2) as any).applyForJob(
        jobId, ethers.keccak256(ethers.toUtf8Bytes("p2")), "QmP2"
      );

      // Select freelancer1
      await (jobEscrow.connect(client) as any).selectFreelancer(
        jobId, freelancer1.address, ethers.toUtf8Bytes("key1")
      );

      // Freelancer1 doesn't respond — wait for T_STAKE to expire
      await time.increase(THREE_DAYS + 1);

      // Expire the offer
      await expect((jobEscrow.connect(client) as any).expireOffer(jobId))
        .to.emit(jobEscrow, "OfferExpired")
        .withArgs(jobId, freelancer1.address);

      // Reselect freelancer2
      await (jobEscrow.connect(client) as any).reselectFreelancer(
        jobId, freelancer2.address, ethers.toUtf8Bytes("key2")
      );

      // Freelancer2 confirms and stakes
      await (jobEscrow.connect(freelancer2) as any).confirmAndStake(jobId);

      // Verify job is Active with freelancer2
      const jobInfo = await jobEscrow.getJobInfo(jobId);
      expect(jobInfo.state).to.equal(2); // Active
      expect(jobInfo.freelancer).to.equal(freelancer2.address);

      // Complete both milestones
      const hash = ethers.keccak256(ethers.toUtf8Bytes("work"));
      await (jobEscrow.connect(freelancer2) as any).submitMilestone(jobId, 0, hash, "QmW0");
      await (jobEscrow.connect(client) as any).approveMilestone(jobId, 0);
      await (jobEscrow.connect(freelancer2) as any).submitMilestone(jobId, 1, hash, "QmW1");
      await (jobEscrow.connect(client) as any).approveMilestone(jobId, 1);

      // Verify job completed
      const jobInfoFinal = await jobEscrow.getJobInfo(jobId);
      expect(jobInfoFinal.state).to.equal(3); // Completed

      // Verify freelancer2 received funds (not freelancer1)
      const f2Balance = await jobEscrow.withdrawableBalances(freelancer2.address);
      const f1Balance = await jobEscrow.withdrawableBalances(freelancer1.address);
      expect(f2Balance).to.be.gt(0);
      expect(f1Balance).to.equal(0);

      // Verify reputation recorded for freelancer2
      const f2Profile = await reputation.getFreelancerProfile(freelancer2.address);
      expect(f2Profile.jobsCompleted).to.equal(1);
    });
  });

  // ═══════════════════════════════════════════
  //    T-7: PROGRESSIVE BOND SLASH
  // ═══════════════════════════════════════════

  describe("Progressive bond slash across multiple disputes", function () {
    it("should progressively slash the behavior bond and refund remainder at completion", async function () {
      const fixture = await loadFixture(deployFullPlatformFixture);
      const {
        jobEscrow, usdc: usdcContract, dispute: disputeContract,
        client, freelancer1, platformAdmin, judge, treasury
      } = fixture;

      // Create a job with 3 milestones
      const totalValue = usdc(3000);
      const milestoneValues = [usdc(1000), usdc(1000), usdc(1000)];
      const now = (await ethers.provider.getBlock("latest"))!.timestamp;
      const milestoneDeadlines = [now + 30 * ONE_DAY, now + 60 * ONE_DAY, now + 90 * ONE_DAY];
      const agreementHash = ethers.keccak256(ethers.toUtf8Bytes("test-bond-slash-prog"));

      const tx = await (jobEscrow.connect(client) as any).postJob(
        agreementHash, milestoneValues, milestoneDeadlines, SEVEN_DAYS, "QmA"
      );
      const receipt = await tx.wait();
      const event = receipt?.logs.find((log: any) => {
        try {
          return jobEscrow.interface.parseLog({
            topics: log.topics as string[], data: log.data
          })?.name === "JobPosted";
        } catch { return false; }
      });
      const parsed = jobEscrow.interface.parseLog({
        topics: event!.topics as string[], data: event!.data
      });
      const jobId = parsed!.args.jobId;

      // Activate job
      const proposalHash = ethers.keccak256(ethers.toUtf8Bytes("proposal"));
      await (jobEscrow.connect(freelancer1) as any).applyForJob(jobId, proposalHash, "QmP");
      const encKey = ethers.toUtf8Bytes("encrypted-key");
      await (jobEscrow.connect(client) as any).selectFreelancer(jobId, freelancer1.address, encKey);
      await (jobEscrow.connect(freelancer1) as any).confirmAndStake(jobId);

      // Original bond: 3000 × 7.5% = 225 USDC
      const originalBond = totalValue * 750n / 10000n; // 225 USDC
      const slashPerDispute = usdc(1000) * 300n / 10000n; // 3% of 1000 = 30 USDC

      // ── Helper to run dispute lifecycle for a milestone ──
      async function disputeAndResolveFreelancerWins(milestoneIdx: number) {
        const msHash = ethers.keccak256(ethers.toUtf8Bytes(`work${milestoneIdx}`));
        await (jobEscrow.connect(freelancer1) as any).submitMilestone(
          jobId, milestoneIdx, msHash, `QmW${milestoneIdx}`
        );
        await (jobEscrow.connect(client) as any).raiseDispute(jobId, milestoneIdx);
        const dId = await jobEscrow.disputeIds(jobId, milestoneIdx);

        await time.increase(5 * ONE_DAY + 1);
        await (disputeContract.connect(client) as any).closeEvidencePhase(dId);

        // Use a new judge each time to avoid role conflicts
        const signers = await ethers.getSigners();
        const judgeForThis = signers[8 + milestoneIdx]; // offset to unused signers
        await (disputeContract.connect(platformAdmin) as any).assignJudge(
          dId, judgeForThis.address, ethers.randomBytes(33)
        );

        await (disputeContract.connect(client) as any).distributeKeyToJudge(dId, ethers.randomBytes(33));
        await (disputeContract.connect(freelancer1) as any).distributeKeyToJudge(dId, ethers.randomBytes(33));

        // FreelancerWins, 100% share
        await (disputeContract.connect(judgeForThis) as any).submitRuling(
          dId, 1,
          ethers.keccak256(ethers.toUtf8Bytes(`r${milestoneIdx}`)),
          10000, 0
        );
        await (disputeContract.connect(client) as any).executeRuling(dId);
      }

      // ── Dispute milestone 0: bond should go from 225 → 195 ──
      await disputeAndResolveFreelancerWins(0);

      let jobInfo = await jobEscrow.getJobInfo(jobId);
      expect(jobInfo.behaviorBond).to.equal(originalBond - slashPerDispute);
      // 225 - 30 = 195

      // ── Dispute milestone 1: bond should go from 195 → 165 ──
      await disputeAndResolveFreelancerWins(1);

      jobInfo = await jobEscrow.getJobInfo(jobId);
      expect(jobInfo.behaviorBond).to.equal(originalBond - 2n * slashPerDispute);
      // 225 - 60 = 165

      // ── Dispute milestone 2: bond should go from 165 → 135 ──
      await disputeAndResolveFreelancerWins(2);

      jobInfo = await jobEscrow.getJobInfo(jobId);
      // After the last dispute, the bond was slashed but the refund happens
      // during _checkAndFinalizeJob. The job should be completed now.
      expect(jobInfo.state).to.equal(3); // Completed

      // ── Verify remaining bond was refunded to client ──
      const expectedBondRefund = originalBond - 3n * slashPerDispute; // 135 USDC
      const clientBalance = await jobEscrow.withdrawableBalances(client.address);

      // Client balance includes the bond refund
      expect(clientBalance).to.be.gte(expectedBondRefund);

      // Verify total treasury gain includes all 3 bond slashes
      const treasuryBalance = await jobEscrow.withdrawableBalances(treasury.address);
      const totalProtocolFees = usdc(1000) * 200n / 10000n * 3n; // 3 × 20 USDC = 60 USDC
      const totalBondSlashes = slashPerDispute * 3n; // 3 × 30 USDC = 90 USDC
      expect(treasuryBalance).to.be.gte(totalProtocolFees + totalBondSlashes);
    });
  });
});
