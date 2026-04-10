import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {
  deployFullPlatformFixture,
  createDefaultJob,
  advanceJobToActive,
  usdc,
  ONE_DAY,
  THREE_DAYS,
  SEVEN_DAYS,
  FOURTEEN_DAYS,
} from "../helpers/fixtures";

/**
 * JobEscrow Edge-Case & Logic-Correctness Tests
 *
 * Focus areas:
 *  - Boundary values for milestone sizes, review timeouts, deadlines
 *  - Fund accounting precision across multi-milestone jobs
 *  - State machine correctness under unusual orderings
 *  - Cancellation edge cases (partial completion, multiple requests)
 *  - Idempotency and terminal-state immutability
 */
describe("JobEscrow — Edge Cases & Logic Correctness", function () {
  // ═══════════════════════════════════════════
  //           MILESTONE VALUE BOUNDARIES
  // ═══════════════════════════════════════════

  describe("Milestone value boundaries", function () {
    it("should reject a milestone that is < 10% of total value", async function () {
      const { jobEscrow, client } = await loadFixture(deployFullPlatformFixture);
      const now = (await ethers.provider.getBlock("latest"))!.timestamp;
      // 2 milestones: 89 + 11 = 100, 89 is ok (89%), but if we do 91 + 9 => 9% fails
      const milestoneValues = [usdc(91), usdc(9)];
      const deadlines = [now + 30 * ONE_DAY, now + 60 * ONE_DAY];
      const hash = ethers.keccak256(ethers.toUtf8Bytes("salt-plain"));

      await expect(
        jobEscrow.connect(client).postJob(hash, milestoneValues, deadlines, SEVEN_DAYS, "QmCID")
      ).to.be.revertedWithCustomError(jobEscrow, "MsBelowMinimum");
    });

    it("should accept milestones at exactly 10% boundary", async function () {
      const { jobEscrow, client } = await loadFixture(deployFullPlatformFixture);
      const now = (await ethers.provider.getBlock("latest"))!.timestamp;
      // 10 milestones of equal value = 10% each → boundary
      const milestoneValues = Array(10).fill(usdc(100));
      const deadlines = Array(10)
        .fill(0)
        .map((_, i) => now + (i + 1) * 30 * ONE_DAY);
      const hash = ethers.keccak256(ethers.toUtf8Bytes("salt-plain"));

      await expect(
        jobEscrow.connect(client).postJob(hash, milestoneValues, deadlines, SEVEN_DAYS, "QmCID")
      ).to.emit(jobEscrow, "JobPosted");
    });

    it("should reject posting with 0 total value", async function () {
      const { jobEscrow, client } = await loadFixture(deployFullPlatformFixture);
      const now = (await ethers.provider.getBlock("latest"))!.timestamp;
      const hash = ethers.keccak256(ethers.toUtf8Bytes("salt-plain"));

      await expect(
        jobEscrow.connect(client).postJob(hash, [0n], [now + ONE_DAY], SEVEN_DAYS, "QmCID")
      ).to.be.revertedWithCustomError(jobEscrow, "ZeroTotalValue");
    });

    it("should reject posting more than 20 milestones", async function () {
      const { jobEscrow, client } = await loadFixture(deployFullPlatformFixture);
      const now = (await ethers.provider.getBlock("latest"))!.timestamp;
      const milestoneValues = Array(21).fill(usdc(100));
      const deadlines = Array(21)
        .fill(0)
        .map((_, i) => now + (i + 1) * ONE_DAY);
      const hash = ethers.keccak256(ethers.toUtf8Bytes("salt-plain"));

      await expect(
        jobEscrow.connect(client).postJob(hash, milestoneValues, deadlines, SEVEN_DAYS, "QmCID")
      ).to.be.revertedWithCustomError(jobEscrow, "TooManyMilestones");
    });

    it("should accept exactly 20 milestones if each >= 10%", async function () {
      // This is impossible (20 * 10% = 200%), so 20 milestones each at 5% should fail
      const { jobEscrow, client } = await loadFixture(deployFullPlatformFixture);
      const now = (await ethers.provider.getBlock("latest"))!.timestamp;
      const milestoneValues = Array(20).fill(usdc(50)); // 5% each
      const deadlines = Array(20)
        .fill(0)
        .map((_, i) => now + (i + 1) * ONE_DAY);
      const hash = ethers.keccak256(ethers.toUtf8Bytes("salt-plain"));

      // 20 milestones at 5% each will fail the 10% minimum check
      await expect(
        jobEscrow.connect(client).postJob(hash, milestoneValues, deadlines, SEVEN_DAYS, "QmCID")
      ).to.be.revertedWithCustomError(jobEscrow, "MsBelowMinimum");
    });
  });

  // ═══════════════════════════════════════════
  //       REVIEW TIMEOUT VALIDATION
  // ═══════════════════════════════════════════

  describe("Review timeout validation", function () {
    it("should accept all valid review timeouts", async function () {
      const { jobEscrow, client } = await loadFixture(deployFullPlatformFixture);
      const validTimeouts = [ONE_DAY, 3 * ONE_DAY, 7 * ONE_DAY, 14 * ONE_DAY, 21 * ONE_DAY, 30 * ONE_DAY];

      for (const timeout of validTimeouts) {
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        const hash = ethers.keccak256(ethers.toUtf8Bytes(`salt-${timeout}`));
        await expect(
          jobEscrow
            .connect(client)
            .postJob(hash, [usdc(1000)], [now + 60 * ONE_DAY], timeout, `QmCID-${timeout}`)
        ).to.emit(jobEscrow, "JobPosted");
      }
    });

    it("should reject invalid review timeouts (e.g. 2 days, 5 days, 0)", async function () {
      const { jobEscrow, client } = await loadFixture(deployFullPlatformFixture);
      const invalidTimeouts = [0, 2 * ONE_DAY, 5 * ONE_DAY, 10 * ONE_DAY, 15 * ONE_DAY, 31 * ONE_DAY];

      for (const timeout of invalidTimeouts) {
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        const hash = ethers.keccak256(ethers.toUtf8Bytes(`salt-bad-${timeout}`));
        await expect(
          jobEscrow
            .connect(client)
            .postJob(hash, [usdc(1000)], [now + 60 * ONE_DAY], timeout, `QmBadCID-${timeout}`)
        ).to.be.revertedWithCustomError(jobEscrow, "InvalidTimeout");
      }
    });
  });

  // ═══════════════════════════════════════════
  //        DEADLINE EDGE CASES
  // ═══════════════════════════════════════════

  describe("Deadline edge cases", function () {
    it("should reject a milestone deadline that is in the past", async function () {
      const { jobEscrow, client } = await loadFixture(deployFullPlatformFixture);
      const now = (await ethers.provider.getBlock("latest"))!.timestamp;
      const hash = ethers.keccak256(ethers.toUtf8Bytes("salt-plain"));

      await expect(
        jobEscrow
          .connect(client)
          .postJob(hash, [usdc(1000)], [now - 1], SEVEN_DAYS, "QmCID")
      ).to.be.revertedWithCustomError(jobEscrow, "DeadlineInPast");
    });

    it("should reject milestone submission after deadline has passed", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1 } =
        await loadFixture(deployFullPlatformFixture);

      const { jobId } = await advanceJobToActive(jobEscrow, usdcContract as any, client, freelancer1);
      const milestones = await jobEscrow.getMilestones(jobId);
      const deadline = milestones[0].deadline;

      // Fast forward past the deadline
      await time.increaseTo(Number(deadline) + 1);

      const hash = ethers.keccak256(ethers.toUtf8Bytes("deliverable"));
      await expect(
        jobEscrow.connect(freelancer1).submitMilestone(jobId, 0, hash, "QmDeliverableCID")
      ).to.be.revertedWithCustomError(jobEscrow, "DeadlinePassed");
    });

    it("should allow submission exactly at the deadline timestamp", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1 } =
        await loadFixture(deployFullPlatformFixture);

      const { jobId } = await advanceJobToActive(jobEscrow, usdcContract as any, client, freelancer1);
      const milestones = await jobEscrow.getMilestones(jobId);
      const deadline = milestones[0].deadline;

      // Set next block timestamp to exactly the deadline (without mining an extra block)
      await time.setNextBlockTimestamp(Number(deadline));

      const hash = ethers.keccak256(ethers.toUtf8Bytes("deliverable"));
      await expect(
        jobEscrow.connect(freelancer1).submitMilestone(jobId, 0, hash, "QmDeliverableCID")
      ).to.emit(jobEscrow, "MilestoneSubmitted");
    });
  });

  // ═══════════════════════════════════════════
  //  FUND ACCOUNTING PRECISION (MULTI-MILESTONE)
  // ═══════════════════════════════════════════

  describe("Fund accounting precision", function () {
    it("should account for all funds correctly across multi-milestone completion", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1, treasury } =
        await loadFixture(deployFullPlatformFixture);

      const { jobId, totalValue } = await advanceJobToActive(
        jobEscrow,
        usdcContract,
        client,
        freelancer1
      );

      // Milestone 0: 500 USDC
      const hash0 = ethers.keccak256(ethers.toUtf8Bytes("deliverable0"));
      await jobEscrow.connect(freelancer1).submitMilestone(jobId, 0, hash0, "QmD0");
      await jobEscrow.connect(client).approveMilestone(jobId, 0);

      // Check balances after first milestone
      const freelancerBal1 = await jobEscrow.withdrawableBalances(freelancer1.address);
      const treasuryBal1 = await jobEscrow.withdrawableBalances(treasury.address);
      // 500 USDC - 2% fee = 490 USDC
      expect(freelancerBal1).to.equal(usdc(490));
      // 2% of 500 = 10 USDC
      expect(treasuryBal1).to.equal(usdc(10));

      // Milestone 1: 500 USDC
      const hash1 = ethers.keccak256(ethers.toUtf8Bytes("deliverable1"));
      await jobEscrow.connect(freelancer1).submitMilestone(jobId, 1, hash1, "QmD1");
      await jobEscrow.connect(client).approveMilestone(jobId, 1);

      // After completion: freelancer gets deposit back, client gets bond back
      const freelancerBal2 = await jobEscrow.withdrawableBalances(freelancer1.address);
      const treasuryBal2 = await jobEscrow.withdrawableBalances(treasury.address);
      const clientBal = await jobEscrow.withdrawableBalances(client.address);

      // Total freelancer: 2 * 490 + deposit (75 USDC for New tier) = 1055
      const deposit = (totalValue * 750n) / 10000n; // 7.5% of 1000 = 75
      expect(freelancerBal2).to.equal(usdc(490) * 2n + deposit);

      // Total treasury: 2 * 10 = 20
      expect(treasuryBal2).to.equal(usdc(20));

      // Client gets behavior bond back
      const bond = (totalValue * 750n) / 10000n; // 7.5% of 1000 = 75
      expect(clientBal).to.equal(bond);

      // Verify job state
      const jobInfo = await jobEscrow.getJobInfo(jobId);
      expect(jobInfo.state).to.equal(3); // Completed
    });

    it("should handle odd USDC amounts without losing precision", async function () {
      const { jobEscrow, client, reputation } = await loadFixture(deployFullPlatformFixture);
      const now = (await ethers.provider.getBlock("latest"))!.timestamp;
      // 333.333333 USDC (odd number for 6 decimals)
      const oddAmount = 333333333n; // 333.333333 USDC
      const hash = ethers.keccak256(ethers.toUtf8Bytes("salt-odd"));

      await expect(
        jobEscrow
          .connect(client)
          .postJob(hash, [oddAmount], [now + 60 * ONE_DAY], SEVEN_DAYS, "QmOddCID")
      ).to.emit(jobEscrow, "JobPosted");
    });

    it("should correctly calculate remaining escrow after partial completion", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1 } =
        await loadFixture(deployFullPlatformFixture);

      const { jobId } = await advanceJobToActive(jobEscrow, usdcContract as any, client, freelancer1);

      // Complete only milestone 0
      const hash = ethers.keccak256(ethers.toUtf8Bytes("deliverable0"));
      await jobEscrow.connect(freelancer1).submitMilestone(jobId, 0, hash, "QmD0");
      await jobEscrow.connect(client).approveMilestone(jobId, 0);

      // Request mutual cancellation
      await jobEscrow.connect(client).requestCancellation(jobId);
      await jobEscrow.connect(freelancer1).acceptCancellation(jobId);

      // Client should get back the remaining 500 USDC escrow + bond
      const clientBal = await jobEscrow.withdrawableBalances(client.address);
      const bond = (usdc(1000) * 750n) / 10000n; // 75 USDC
      // Remaining: milestone 1 value (500) + behavior bond (75) = 575
      expect(clientBal).to.equal(usdc(500) + bond);

      // Freelancer should get deposit back
      const freelancerBal = await jobEscrow.withdrawableBalances(freelancer1.address);
      const deposit = (usdc(1000) * 750n) / 10000n; // 7.5% = 75 USDC (New tier)
      // Freelancer gets: milestone 0 payout (490) + deposit refund (75) = 565
      expect(freelancerBal).to.equal(usdc(490) + deposit);
    });
  });

  // ═══════════════════════════════════════════
  //  AUTO-APPROVE STRICT TIMESTAMP COMPARISON
  // ═══════════════════════════════════════════

  describe("Auto-approve strict timestamp", function () {
    it("should reject auto-approve at exactly submittedAt + reviewTimeout (strict >)", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1 } =
        await loadFixture(deployFullPlatformFixture);

      const { jobId } = await advanceJobToActive(jobEscrow, usdcContract as any, client, freelancer1);

      const hash = ethers.keccak256(ethers.toUtf8Bytes("deliverable"));
      await jobEscrow.connect(freelancer1).submitMilestone(jobId, 0, hash, "QmD");

      const ms = await jobEscrow.getMilestoneInfo(jobId, 0);
      const submittedAt = Number(ms.submittedAt);
      const reviewTimeout = Number((await jobEscrow.getJobInfo(jobId)).reviewTimeout);

      // Set next block timestamp to exactly submittedAt + reviewTimeout
      // (without mining an extra block that would push timestamp to +1)
      await time.setNextBlockTimestamp(submittedAt + reviewTimeout);

      await expect(
        jobEscrow.connect(client).triggerAutoApprove(jobId, 0)
      ).to.be.revertedWithCustomError(jobEscrow, "TimeoutNotExpired");
    });

    it("should allow auto-approve at submittedAt + reviewTimeout + 1", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1 } =
        await loadFixture(deployFullPlatformFixture);

      const { jobId } = await advanceJobToActive(jobEscrow, usdcContract as any, client, freelancer1);

      const hash = ethers.keccak256(ethers.toUtf8Bytes("deliverable"));
      await jobEscrow.connect(freelancer1).submitMilestone(jobId, 0, hash, "QmD");

      const ms = await jobEscrow.getMilestoneInfo(jobId, 0);
      const submittedAt = Number(ms.submittedAt);
      const reviewTimeout = Number((await jobEscrow.getJobInfo(jobId)).reviewTimeout);

      await time.increaseTo(submittedAt + reviewTimeout + 1);

      await expect(
        jobEscrow.triggerAutoApprove(jobId, 0) // anyone can trigger
      ).to.emit(jobEscrow, "MilestoneAutoApproved");
    });
  });

  // ═══════════════════════════════════════════
  //   OFFER / SELECTION EDGE CASES
  // ═══════════════════════════════════════════

  describe("Offer and selection edge cases", function () {
    it("should not allow selectFreelancer if one is already selected (use reselect)", async function () {
      const { jobEscrow, client, freelancer1, freelancer2 } =
        await loadFixture(deployFullPlatformFixture);

      const { jobId } = await createDefaultJob(jobEscrow, client);
      const proposalHash = ethers.keccak256(ethers.toUtf8Bytes("proposal"));
      await jobEscrow.connect(freelancer1).applyForJob(jobId, proposalHash, "QmP1");
      await jobEscrow.connect(freelancer2).applyForJob(jobId, proposalHash, "QmP2");

      const encKey = ethers.toUtf8Bytes("key");
      await jobEscrow.connect(client).selectFreelancer(jobId, freelancer1.address, encKey);

      // Try to select another without using reselect
      await expect(
        jobEscrow.connect(client).selectFreelancer(jobId, freelancer2.address, encKey)
      ).to.be.revertedWithCustomError(jobEscrow, "AlreadySelected");
    });

    it("should allow reselect after rejection, without waiting for T_STAKE", async function () {
      const { jobEscrow, client, freelancer1, freelancer2 } =
        await loadFixture(deployFullPlatformFixture);

      const { jobId } = await createDefaultJob(jobEscrow, client);
      const proposalHash = ethers.keccak256(ethers.toUtf8Bytes("proposal"));
      await jobEscrow.connect(freelancer1).applyForJob(jobId, proposalHash, "QmP1");
      await jobEscrow.connect(freelancer2).applyForJob(jobId, proposalHash, "QmP2");

      const encKey = ethers.toUtf8Bytes("key");
      await jobEscrow.connect(client).selectFreelancer(jobId, freelancer1.address, encKey);

      // Freelancer1 rejects
      await jobEscrow.connect(freelancer1).rejectOffer(jobId);

      // Client can immediately select freelancer2 (no T_STAKE wait needed)
      await expect(
        jobEscrow.connect(client).selectFreelancer(jobId, freelancer2.address, encKey)
      ).to.emit(jobEscrow, "FreelancerSelected");
    });

    it("should prevent staking after T_STAKE window expires", async function () {
      const { jobEscrow, client, freelancer1 } = await loadFixture(deployFullPlatformFixture);

      const { jobId } = await createDefaultJob(jobEscrow, client);
      const proposalHash = ethers.keccak256(ethers.toUtf8Bytes("proposal"));
      await jobEscrow.connect(freelancer1).applyForJob(jobId, proposalHash, "QmP");

      const encKey = ethers.toUtf8Bytes("key");
      await jobEscrow.connect(client).selectFreelancer(jobId, freelancer1.address, encKey);

      // Fast-forward past T_STAKE
      await time.increase(THREE_DAYS + 1);

      await expect(
        jobEscrow.connect(freelancer1).confirmAndStake(jobId)
      ).to.be.revertedWithCustomError(jobEscrow, "StakeWindowExpired");
    });

    it("should prevent reselectFreelancer before T_STAKE expiry if no rejection", async function () {
      const { jobEscrow, client, freelancer1, freelancer2 } =
        await loadFixture(deployFullPlatformFixture);

      const { jobId } = await createDefaultJob(jobEscrow, client);
      const proposalHash = ethers.keccak256(ethers.toUtf8Bytes("proposal"));
      await jobEscrow.connect(freelancer1).applyForJob(jobId, proposalHash, "QmP1");
      await jobEscrow.connect(freelancer2).applyForJob(jobId, proposalHash, "QmP2");

      const encKey = ethers.toUtf8Bytes("key");
      await jobEscrow.connect(client).selectFreelancer(jobId, freelancer1.address, encKey);

      // Try reselect before T_STAKE expires
      await expect(
        jobEscrow.connect(client).reselectFreelancer(jobId, freelancer2.address, encKey)
      ).to.be.revertedWithCustomError(jobEscrow, "PrevNotExpired");
    });
  });

  // ═══════════════════════════════════════════
  //  CANCELLATION EDGE CASES
  // ═══════════════════════════════════════════

  describe("Cancellation edge cases", function () {
    it("should not allow requestCancellation if any milestone is InReview", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1 } =
        await loadFixture(deployFullPlatformFixture);

      const { jobId } = await advanceJobToActive(jobEscrow, usdcContract as any, client, freelancer1);

      // Submit milestone 0 (puts it InReview)
      const hash = ethers.keccak256(ethers.toUtf8Bytes("deliverable"));
      await jobEscrow.connect(freelancer1).submitMilestone(jobId, 0, hash, "QmD");

      await expect(
        jobEscrow.connect(client).requestCancellation(jobId)
      ).to.be.revertedWithCustomError(jobEscrow, "MsInReviewOrDisputed");
    });

    it("should not allow duplicate cancellation requests", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1 } =
        await loadFixture(deployFullPlatformFixture);

      const { jobId } = await advanceJobToActive(jobEscrow, usdcContract as any, client, freelancer1);

      await jobEscrow.connect(client).requestCancellation(jobId);

      await expect(
        jobEscrow.connect(freelancer1).requestCancellation(jobId)
      ).to.be.revertedWithCustomError(jobEscrow, "CancelAlreadyPending");
    });

    it("should not allow the requester to accept their own cancellation", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1 } =
        await loadFixture(deployFullPlatformFixture);

      const { jobId } = await advanceJobToActive(jobEscrow, usdcContract as any, client, freelancer1);

      await jobEscrow.connect(client).requestCancellation(jobId);

      await expect(
        jobEscrow.connect(client).acceptCancellation(jobId)
      ).to.be.revertedWithCustomError(jobEscrow, "OnlyCounterparty");
    });

    it("should NOT track cancellation reputation penalty for client when offer has expired (SC-7)", async function () {
      const { jobEscrow, client, freelancer1, reputation } =
        await loadFixture(deployFullPlatformFixture);

      const { jobId } = await createDefaultJob(jobEscrow, client);
      const proposalHash = ethers.keccak256(ethers.toUtf8Bytes("proposal"));
      await jobEscrow.connect(freelancer1).applyForJob(jobId, proposalHash, "QmP");

      const encKey = ethers.toUtf8Bytes("key");
      await jobEscrow.connect(client).selectFreelancer(jobId, freelancer1.address, encKey);

      // Must wait for T_STAKE to expire before cancellation is allowed
      await time.increase(THREE_DAYS + 1);

      // Cancel when freelancer offer has expired → SC-7: no reputation penalty
      await jobEscrow.connect(client).cancelJob(jobId);

      const profile = await reputation.getClientProfile(client.address);
      expect(profile.jobsCancelledAfterSelection).to.equal(0);
    });

    it("should not track cancellation reputation penalty when no freelancer is selected", async function () {
      const { jobEscrow, client, reputation } = await loadFixture(deployFullPlatformFixture);

      const { jobId } = await createDefaultJob(jobEscrow, client);

      // Cancel in Open state (no freelancer selected)
      await jobEscrow.connect(client).cancelJob(jobId);

      const profile = await reputation.getClientProfile(client.address);
      expect(profile.jobsCancelledAfterSelection).to.equal(0);
    });
  });

  // ═══════════════════════════════════════════
  //  WITHDRAWAL OF EXPIRED JOBS
  // ═══════════════════════════════════════════

  describe("Expired job withdrawal", function () {
    it("should allow withdrawal after T_ACCEPTANCE (14 days) in Open state", async function () {
      const { jobEscrow, client } = await loadFixture(deployFullPlatformFixture);

      const { jobId, totalValue } = await createDefaultJob(jobEscrow, client);

      await time.increase(FOURTEEN_DAYS + 1);

      await expect(jobEscrow.connect(client).withdrawExpiredJob(jobId))
        .to.emit(jobEscrow, "JobCancelled");

      // Check funds returned
      const bond = (totalValue * 750n) / 10000n;
      const clientBal = await jobEscrow.withdrawableBalances(client.address);
      expect(clientBal).to.equal(totalValue + bond);
    });

    it("should reject withdrawal before T_ACCEPTANCE", async function () {
      const { jobEscrow, client } = await loadFixture(deployFullPlatformFixture);

      const { jobId } = await createDefaultJob(jobEscrow, client);

      await time.increase(FOURTEEN_DAYS - 100);

      await expect(
        jobEscrow.connect(client).withdrawExpiredJob(jobId)
      ).to.be.revertedWithCustomError(jobEscrow, "NotExpiredYet");
    });

    it("should reject withdrawal for non-client", async function () {
      const { jobEscrow, client, freelancer1 } = await loadFixture(deployFullPlatformFixture);

      const { jobId } = await createDefaultJob(jobEscrow, client);

      await time.increase(FOURTEEN_DAYS + 1);

      await expect(
        jobEscrow.connect(freelancer1).withdrawExpiredJob(jobId)
      ).to.be.revertedWithCustomError(jobEscrow, "OnlyClient");
    });

    it("should reject withdrawal if freelancer already confirmed", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1 } =
        await loadFixture(deployFullPlatformFixture);

      const { jobId } = await advanceJobToActive(jobEscrow, usdcContract as any, client, freelancer1);

      await time.increase(FOURTEEN_DAYS + 1);

      await expect(
        jobEscrow.connect(client).withdrawExpiredJob(jobId)
      ).to.be.revertedWithCustomError(jobEscrow, "InvalidState");
    });
  });

  // ═══════════════════════════════════════════
  //  MULTI-APPLICATION EDGE CASES
  // ═══════════════════════════════════════════

  describe("Multi-application edge cases", function () {
    it("should correctly track multiple applicants", async function () {
      const { jobEscrow, client, freelancer1, freelancer2 } =
        await loadFixture(deployFullPlatformFixture);

      const { jobId } = await createDefaultJob(jobEscrow, client);
      const proposalHash = ethers.keccak256(ethers.toUtf8Bytes("proposal"));

      await jobEscrow.connect(freelancer1).applyForJob(jobId, proposalHash, "QmP1");
      await jobEscrow.connect(freelancer2).applyForJob(jobId, proposalHash, "QmP2");

      const count = await jobEscrow.getApplicationCount(jobId);
      expect(count).to.equal(2);
    });

    it("should prevent the same freelancer from applying twice", async function () {
      const { jobEscrow, client, freelancer1 } = await loadFixture(deployFullPlatformFixture);

      const { jobId } = await createDefaultJob(jobEscrow, client);
      const proposalHash = ethers.keccak256(ethers.toUtf8Bytes("proposal"));

      await jobEscrow.connect(freelancer1).applyForJob(jobId, proposalHash, "QmP1");

      await expect(
        jobEscrow.connect(freelancer1).applyForJob(jobId, proposalHash, "QmP2")
      ).to.be.revertedWithCustomError(jobEscrow, "AlreadyApplied");
    });

    it("should prevent the client from applying to their own job", async function () {
      const { jobEscrow, client } = await loadFixture(deployFullPlatformFixture);

      const { jobId } = await createDefaultJob(jobEscrow, client);
      const proposalHash = ethers.keccak256(ethers.toUtf8Bytes("proposal"));

      await expect(
        jobEscrow.connect(client).applyForJob(jobId, proposalHash, "QmP")
      ).to.be.revertedWithCustomError(jobEscrow, "NotParty");
    });
  });

  // ═══════════════════════════════════════════
  //  STATE TRANSITION IMMUTABILITY
  // ═══════════════════════════════════════════

  describe("Terminal state immutability", function () {
    it("should not allow operations after job is completed", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1 } =
        await loadFixture(deployFullPlatformFixture);

      const { jobId } = await advanceJobToActive(jobEscrow, usdcContract as any, client, freelancer1);

      // Complete all milestones
      for (let i = 0; i < 2; i++) {
        const hash = ethers.keccak256(ethers.toUtf8Bytes(`deliverable${i}`));
        await jobEscrow.connect(freelancer1).submitMilestone(jobId, i, hash, `QmD${i}`);
        await jobEscrow.connect(client).approveMilestone(jobId, i);
      }

      // Verify completed
      const jobInfo = await jobEscrow.getJobInfo(jobId);
      expect(jobInfo.state).to.equal(3); // Completed

      // Try various operations on completed job
      await expect(
        jobEscrow.connect(client).cancelJob(jobId)
      ).to.be.revertedWithCustomError(jobEscrow, "InvalidState");

      await expect(
        jobEscrow.connect(client).requestCancellation(jobId)
      ).to.be.revertedWithCustomError(jobEscrow, "InvalidState");
    });

    it("should not allow operations after job is cancelled", async function () {
      const { jobEscrow, client, freelancer1 } = await loadFixture(deployFullPlatformFixture);

      const { jobId } = await createDefaultJob(jobEscrow, client);
      await jobEscrow.connect(client).cancelJob(jobId);

      // Try to apply
      const proposalHash = ethers.keccak256(ethers.toUtf8Bytes("proposal"));
      await expect(
        jobEscrow.connect(freelancer1).applyForJob(jobId, proposalHash, "QmP")
      ).to.be.revertedWithCustomError(jobEscrow, "InvalidState");
    });

    it("should not allow operations after job is abandoned", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1 } =
        await loadFixture(deployFullPlatformFixture);

      const { jobId } = await advanceJobToActive(jobEscrow, usdcContract as any, client, freelancer1);

      // Fast forward past milestone deadline
      const milestones = await jobEscrow.getMilestones(jobId);
      await time.increaseTo(Number(milestones[0].deadline) + 1);

      await jobEscrow.connect(client).claimAbandonment(jobId, 0);

      // Verify abandoned
      const jobInfo = await jobEscrow.getJobInfo(jobId);
      expect(jobInfo.state).to.equal(5); // Abandoned

      // Try to submit milestone
      const hash = ethers.keccak256(ethers.toUtf8Bytes("deliverable"));
      await expect(
        jobEscrow.connect(freelancer1).submitMilestone(jobId, 0, hash, "QmD")
      ).to.be.revertedWithCustomError(jobEscrow, "InvalidState");
    });
  });

  // ═══════════════════════════════════════════
  //  ENCRYPTION KEY REGISTRATION
  // ═══════════════════════════════════════════

  describe("Encryption key registration", function () {
    it("should register a valid 33-byte compressed public key", async function () {
      const { jobEscrow, freelancer1 } = await loadFixture(deployFullPlatformFixture);

      const fakeKey = ethers.hexlify(ethers.randomBytes(33));

      await expect(jobEscrow.connect(freelancer1).registerEncryptionKey(fakeKey))
        .to.emit(jobEscrow, "PublicKeyRegistered")
        .withArgs(freelancer1.address, fakeKey);
    });

    it("should reject invalid key length (not 33 bytes)", async function () {
      const { jobEscrow, freelancer1 } = await loadFixture(deployFullPlatformFixture);

      const badKey = ethers.hexlify(ethers.randomBytes(32)); // 32 bytes, not 33

      await expect(
        jobEscrow.connect(freelancer1).registerEncryptionKey(badKey)
      ).to.be.revertedWithCustomError(jobEscrow, "InvalidPubkeyLen");
    });
  });

  // ═══════════════════════════════════════════
  //  EMPTY CID HANDLING
  // ═══════════════════════════════════════════

  describe("Empty CID handling", function () {
    it("should allow postJob with an empty agreement CID", async function () {
      const { jobEscrow, client } = await loadFixture(deployFullPlatformFixture);
      const now = (await ethers.provider.getBlock("latest"))!.timestamp;
      const hash = ethers.keccak256(ethers.toUtf8Bytes("salt-plain"));

      // Empty CID should not call dataAvailability.registerCID
      await expect(
        jobEscrow
          .connect(client)
          .postJob(hash, [usdc(1000)], [now + 60 * ONE_DAY], SEVEN_DAYS, "")
      ).to.emit(jobEscrow, "JobPosted");
    });

    it("should allow submitMilestone with an empty deliverable CID", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1 } =
        await loadFixture(deployFullPlatformFixture);

      const { jobId } = await advanceJobToActive(jobEscrow, usdcContract as any, client, freelancer1);

      const hash = ethers.keccak256(ethers.toUtf8Bytes("deliverable"));
      await expect(
        jobEscrow.connect(freelancer1).submitMilestone(jobId, 0, hash, "")
      ).to.emit(jobEscrow, "MilestoneSubmitted");
    });
  });

  // ═══════════════════════════════════════════
  //  PAUSE MECHANISM
  // ═══════════════════════════════════════════

  describe("Pause mechanism", function () {
    it("should block postJob when paused", async function () {
      const { jobEscrow, client, deployer } = await loadFixture(deployFullPlatformFixture);
      const now = (await ethers.provider.getBlock("latest"))!.timestamp;
      const hash = ethers.keccak256(ethers.toUtf8Bytes("salt-plain"));

      await jobEscrow.connect(deployer).pause();

      await expect(
        jobEscrow
          .connect(client)
          .postJob(hash, [usdc(1000)], [now + 60 * ONE_DAY], SEVEN_DAYS, "QmCID")
      ).to.be.revertedWithCustomError(jobEscrow, "EnforcedPause");
    });

    it("should block applyForJob when paused", async function () {
      const { jobEscrow, client, freelancer1, deployer } =
        await loadFixture(deployFullPlatformFixture);

      const { jobId } = await createDefaultJob(jobEscrow, client);

      await jobEscrow.connect(deployer).pause();

      const proposalHash = ethers.keccak256(ethers.toUtf8Bytes("proposal"));
      await expect(
        jobEscrow.connect(freelancer1).applyForJob(jobId, proposalHash, "QmP")
      ).to.be.revertedWithCustomError(jobEscrow, "EnforcedPause");
    });

    it("should still allow approveMilestone when paused (not guarded by whenNotPaused)", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1, deployer } =
        await loadFixture(deployFullPlatformFixture);

      const { jobId } = await advanceJobToActive(jobEscrow, usdcContract as any, client, freelancer1);

      const hash = ethers.keccak256(ethers.toUtf8Bytes("deliverable"));
      await jobEscrow.connect(freelancer1).submitMilestone(jobId, 0, hash, "QmD");

      // Pause the contract
      await jobEscrow.connect(deployer).pause();

      // approveMilestone should still work (funds must be releasable even when paused)
      await expect(
        jobEscrow.connect(client).approveMilestone(jobId, 0)
      ).to.emit(jobEscrow, "MilestoneApproved");
    });

    it("should still allow withdraw when paused", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1, deployer } =
        await loadFixture(deployFullPlatformFixture);

      const { jobId } = await advanceJobToActive(jobEscrow, usdcContract as any, client, freelancer1);

      const hash = ethers.keccak256(ethers.toUtf8Bytes("deliverable"));
      await jobEscrow.connect(freelancer1).submitMilestone(jobId, 0, hash, "QmD");
      await jobEscrow.connect(client).approveMilestone(jobId, 0);

      await jobEscrow.connect(deployer).pause();

      // Withdraw should still work
      await expect(
        jobEscrow.connect(freelancer1).withdraw()
      ).to.emit(jobEscrow, "FundsWithdrawn");
    });

    it("should allow unpause and resume normal operations", async function () {
      const { jobEscrow, client, deployer } = await loadFixture(deployFullPlatformFixture);

      await jobEscrow.connect(deployer).pause();
      await jobEscrow.connect(deployer).unpause();

      const now = (await ethers.provider.getBlock("latest"))!.timestamp;
      const hash = ethers.keccak256(ethers.toUtf8Bytes("salt-plain"));

      await expect(
        jobEscrow
          .connect(client)
          .postJob(hash, [usdc(1000)], [now + 60 * ONE_DAY], SEVEN_DAYS, "QmCID")
      ).to.emit(jobEscrow, "JobPosted");
    });
  });

  // ═══════════════════════════════════════════
  //  SC-5: _DISPUTE ZERO-ADDRESS IN INITIALIZE
  // ═══════════════════════════════════════════

  describe("SC-5: _dispute zero-address in initialize()", function () {
    it("should revert when _dispute is zero address", async function () {
      const [deployer, , , , , treasury] = await ethers.getSigners();

      const MockUSDC = await ethers.getContractFactory("MockUSDC");
      const usdc_token = await MockUSDC.deploy();

      const DataAvailability = await ethers.getContractFactory("DataAvailability");
      const da = await upgrades.deployProxy(DataAvailability, [deployer.address, 0], { kind: "uups" });
      await da.waitForDeployment();

      const ReputationFactory = await ethers.getContractFactory("Reputation");
      const rep = await upgrades.deployProxy(ReputationFactory, [deployer.address, 0], { kind: "uups" });
      await rep.waitForDeployment();

      const JobEscrowLib = await ethers.getContractFactory("JobEscrowLib");
      const lib = await JobEscrowLib.deploy();
      await lib.waitForDeployment();

      const JobEscrowFactory = await ethers.getContractFactory("JobEscrow", {
        libraries: { JobEscrowLib: await lib.getAddress() },
      });

      await expect(
        upgrades.deployProxy(
          JobEscrowFactory,
          [
            await usdc_token.getAddress(),
            ethers.ZeroAddress,  // _dispute = zero address
            await rep.getAddress(),
            await da.getAddress(),
            treasury.address,
            deployer.address,
            0,
          ],
          { kind: "uups", unsafeAllow: ["constructor"], unsafeAllowLinkedLibraries: true }
        )
      ).to.be.revertedWithCustomError(JobEscrowFactory, "ZeroAddress");
    });
  });
});
