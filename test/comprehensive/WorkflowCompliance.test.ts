/**
 * WorkflowCompliance.test.ts
 *
 * Comprehensive tests that verify smart contract behavior against the
 * WorkflowDesign.md specification. These tests focus on logic correctness
 * and ensuring the contracts match the original design intent.
 *
 * Tests are organized by specification section:
 *  §2 — Happy Path (No Dispute)
 *  §3 — Dispute Path (Centralized Resolution)
 *  §2.4 — Timeout Design
 *  §2.5 — State Transition Safety Rules
 *  §2.6 — Cancellation Rules
 */

import { expect } from "chai";
import { ethers } from "hardhat";
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

// ═══════════════════════════════════════════════════════════════
// §2 — Happy Path (No Dispute)
// ═══════════════════════════════════════════════════════════════

describe("§2 Happy Path — Full Job Lifecycle", function () {
  describe("§2.2 Step 1 — postJob()", function () {
    it("should lock 100% of job value + behavior bond in escrow", async function () {
      const { jobEscrow, usdc: usdcContract, client } = await loadFixture(deployFullPlatformFixture);

      const balBefore = await usdcContract.balanceOf(client.address);
      const { jobId, totalValue } = await createDefaultJob(jobEscrow, client);

      const job = await jobEscrow.getJobInfo(jobId);
      const behaviorBond = job.behaviorBond;

      const balAfter = await usdcContract.balanceOf(client.address);
      expect(balBefore - balAfter).to.equal(totalValue + behaviorBond);

      // Contract should hold the funds
      const escrowBal = await usdcContract.balanceOf(await jobEscrow.getAddress());
      expect(escrowBal).to.be.gte(totalValue + behaviorBond);
    });

    it("should enforce review timeout from allowed set {1d, 3d, 7d, 14d, 21d, 30d}", async function () {
      const { jobEscrow, usdc: usdcContract, client } = await loadFixture(deployFullPlatformFixture);

      // Valid timeouts — use unique CIDs to avoid DataAvailability "CID already registered"
      const validTimeouts = [ONE_DAY, THREE_DAYS, SEVEN_DAYS, FOURTEEN_DAYS, 21 * ONE_DAY, 30 * ONE_DAY];
      for (let i = 0; i < validTimeouts.length; i++) {
        const timeout = validTimeouts[i];
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        const tx = await jobEscrow.connect(client).postJob(
          ethers.keccak256(ethers.toUtf8Bytes(`test-timeout-${i}`)),
          [usdc(500), usdc(500)],
          [now + 30 * ONE_DAY, now + 60 * ONE_DAY],
          timeout,
          `QmUniqueTimeout${i}`
        );
        const receipt = await tx.wait();
        const event = receipt?.logs.find((log: any) => {
          try { return jobEscrow.interface.parseLog({ topics: log.topics as string[], data: log.data })?.name === "JobPosted"; } catch { return false; }
        });
        const parsed = jobEscrow.interface.parseLog({ topics: event!.topics as string[], data: event!.data });
        const jobId = parsed!.args.jobId;
        const job = await jobEscrow.getJobInfo(jobId);
        expect(job.reviewTimeout).to.equal(timeout);
      }

      // Invalid timeout (e.g. 2 days)
      const now = (await ethers.provider.getBlock("latest"))!.timestamp;
      await expect(
        jobEscrow.connect(client).postJob(
          ethers.keccak256(ethers.toUtf8Bytes("test-invalid")),
          [usdc(1000)],
          [now + 30 * ONE_DAY],
          2 * ONE_DAY,
          "QmInvalidTimeout"
        )
      ).to.be.revertedWithCustomError(jobEscrow, "InvalidTimeout");
    });

    it("should store agreementHash on-chain and register CID via DataAvailability", async function () {
      const { jobEscrow, dataAvailability, client } = await loadFixture(deployFullPlatformFixture);

      const { jobId, agreementHash } = await createDefaultJob(jobEscrow, client);
      const job = await jobEscrow.jobs(jobId);
      expect(job.agreementHash).to.equal(agreementHash);

      // Check CID was registered
      const cidHashes = await dataAvailability.getJobCIDs(jobId);
      expect(cidHashes.length).to.be.gte(1);
    });

    it("should be immutable — reviewTimeout cannot be changed after posting", async function () {
      const { jobEscrow, client } = await loadFixture(deployFullPlatformFixture);
      const { jobId } = await createDefaultJob(jobEscrow, client, SEVEN_DAYS);

      // There should be no function to change reviewTimeout
      // Verify the timeout is stored correctly
      const job = await jobEscrow.getJobInfo(jobId);
      expect(job.reviewTimeout).to.equal(SEVEN_DAYS);

      // The contract doesn't expose a setter for reviewTimeout — this is correct by design
    });

    it("should calculate graduated behavior bond based on client reputation tier", async function () {
      const { jobEscrow, client } = await loadFixture(deployFullPlatformFixture);

      const { jobId, totalValue } = await createDefaultJob(jobEscrow, client);
      const job = await jobEscrow.getJobInfo(jobId);

      // New client should have 7.5% bond
      const expectedBond = (totalValue * 750n) / 10000n;
      expect(job.behaviorBond).to.equal(expectedBond);
    });

    it("should require each milestone to be at least 10% of total value", async function () {
      const { jobEscrow, client } = await loadFixture(deployFullPlatformFixture);
      const now = (await ethers.provider.getBlock("latest"))!.timestamp;

      // 11 milestones of equal value: each is ~9.09% — should fail
      const milestoneValues = Array(11).fill(usdc(100));
      const milestoneDeadlines = Array(11).fill(now + 30 * ONE_DAY);

      await expect(
        jobEscrow.connect(client).postJob(
          ethers.keccak256(ethers.toUtf8Bytes("test")),
          milestoneValues,
          milestoneDeadlines,
          SEVEN_DAYS,
          "QmTest"
        )
      ).to.be.revertedWithCustomError(jobEscrow, "MsBelowMinimum");
    });
  });

  describe("§2.2 Step 2 — applyForJob()", function () {
    it("should allow freelancers to apply without any deposit", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1 } = await loadFixture(deployFullPlatformFixture);
      const { jobId } = await createDefaultJob(jobEscrow, client);

      const balBefore = await usdcContract.balanceOf(freelancer1.address);
      await jobEscrow.connect(freelancer1).applyForJob(jobId, ethers.ZeroHash, "QmProp1");
      const balAfter = await usdcContract.balanceOf(freelancer1.address);

      // No funds should be transferred
      expect(balBefore).to.equal(balAfter);
    });

    it("should prevent client from applying to their own job", async function () {
      const { jobEscrow, client } = await loadFixture(deployFullPlatformFixture);
      const { jobId } = await createDefaultJob(jobEscrow, client);

      await expect(
        jobEscrow.connect(client).applyForJob(jobId, ethers.ZeroHash, "QmProp1")
      ).to.be.revertedWithCustomError(jobEscrow, "NotParty");
    });

    it("should prevent duplicate applications from the same freelancer", async function () {
      const { jobEscrow, client, freelancer1 } = await loadFixture(deployFullPlatformFixture);
      const { jobId } = await createDefaultJob(jobEscrow, client);

      await jobEscrow.connect(freelancer1).applyForJob(jobId, ethers.ZeroHash, "QmProp1");
      await expect(
        jobEscrow.connect(freelancer1).applyForJob(jobId, ethers.ZeroHash, "QmProp2")
      ).to.be.revertedWithCustomError(jobEscrow, "AlreadyApplied");
    });

    it("should transition job from Open to Applications on first application", async function () {
      const { jobEscrow, client, freelancer1 } = await loadFixture(deployFullPlatformFixture);
      const { jobId } = await createDefaultJob(jobEscrow, client);

      const jobBefore = await jobEscrow.getJobInfo(jobId);
      expect(jobBefore.state).to.equal(0); // Open

      await jobEscrow.connect(freelancer1).applyForJob(jobId, ethers.ZeroHash, "QmProp1");

      const jobAfter = await jobEscrow.getJobInfo(jobId);
      expect(jobAfter.state).to.equal(1); // Applications
    });
  });

  describe("§2.2 Step 3 — selectFreelancer()", function () {
    it("should only allow client to select a freelancer who has applied", async function () {
      const { jobEscrow, client, freelancer1, freelancer2 } = await loadFixture(deployFullPlatformFixture);
      const { jobId } = await createDefaultJob(jobEscrow, client);

      await jobEscrow.connect(freelancer1).applyForJob(jobId, ethers.ZeroHash, "QmProp1");

      // Try to select freelancer2 who hasn't applied
      await expect(
        jobEscrow.connect(client).selectFreelancer(jobId, freelancer2.address, ethers.toUtf8Bytes("key"))
      ).to.be.revertedWithCustomError(jobEscrow, "NotApplicant");
    });

    it("should start the T_STAKE timer (3 days) on selection", async function () {
      const { jobEscrow, client, freelancer1 } = await loadFixture(deployFullPlatformFixture);
      const { jobId } = await createDefaultJob(jobEscrow, client);

      await jobEscrow.connect(freelancer1).applyForJob(jobId, ethers.ZeroHash, "QmProp1");
      await jobEscrow.connect(client).selectFreelancer(jobId, freelancer1.address, ethers.toUtf8Bytes("key"));

      const job = await jobEscrow.jobs(jobId);
      expect(job.selectedAt).to.be.gt(0);
    });
  });

  describe("§2.2 Step 4a — confirmAndStake()", function () {
    it("should require 5% deposit from freelancer", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1 } = await loadFixture(deployFullPlatformFixture);
      const { jobId, totalValue } = await createDefaultJob(jobEscrow, client);

      await jobEscrow.connect(freelancer1).applyForJob(jobId, ethers.ZeroHash, "QmProp1");
      await jobEscrow.connect(client).selectFreelancer(jobId, freelancer1.address, ethers.toUtf8Bytes("key"));

      const balBefore = await usdcContract.balanceOf(freelancer1.address);
      await jobEscrow.connect(freelancer1).confirmAndStake(jobId);
      const balAfter = await usdcContract.balanceOf(freelancer1.address);

      // New tier freelancer: 7.5% deposit (graduated)
      const expectedDeposit = (totalValue * 750n) / 10000n;
      expect(balBefore - balAfter).to.equal(expectedDeposit);
    });

    it("should transition job to Active state", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1 } = await loadFixture(deployFullPlatformFixture);
      const { jobId } = await advanceJobToActive(jobEscrow, usdcContract, client, freelancer1);

      const job = await jobEscrow.getJobInfo(jobId);
      expect(job.state).to.equal(2); // Active
    });

    it("should fail if T_STAKE (3 days) has expired", async function () {
      const { jobEscrow, client, freelancer1 } = await loadFixture(deployFullPlatformFixture);
      const { jobId } = await createDefaultJob(jobEscrow, client);

      await jobEscrow.connect(freelancer1).applyForJob(jobId, ethers.ZeroHash, "QmProp1");
      await jobEscrow.connect(client).selectFreelancer(jobId, freelancer1.address, ethers.toUtf8Bytes("key"));

      // Advance time past T_STAKE
      await time.increase(THREE_DAYS + 1);

      await expect(
        jobEscrow.connect(freelancer1).confirmAndStake(jobId)
      ).to.be.revertedWithCustomError(jobEscrow, "StakeWindowExpired");
    });
  });

  describe("§2.2 Step 4b — rejectOffer()", function () {
    it("should allow selected freelancer to explicitly reject", async function () {
      const { jobEscrow, client, freelancer1 } = await loadFixture(deployFullPlatformFixture);
      const { jobId } = await createDefaultJob(jobEscrow, client);

      await jobEscrow.connect(freelancer1).applyForJob(jobId, ethers.ZeroHash, "QmProp1");
      await jobEscrow.connect(client).selectFreelancer(jobId, freelancer1.address, ethers.toUtf8Bytes("key"));

      await jobEscrow.connect(freelancer1).rejectOffer(jobId);

      const job = await jobEscrow.getJobInfo(jobId);
      expect(job.freelancer).to.equal(ethers.ZeroAddress);
    });

    it("should allow client to immediately select another applicant after rejection", async function () {
      const { jobEscrow, client, freelancer1, freelancer2 } = await loadFixture(deployFullPlatformFixture);
      const { jobId } = await createDefaultJob(jobEscrow, client);

      await jobEscrow.connect(freelancer1).applyForJob(jobId, ethers.ZeroHash, "QmProp1");
      await jobEscrow.connect(freelancer2).applyForJob(jobId, ethers.ZeroHash, "QmProp2");
      await jobEscrow.connect(client).selectFreelancer(jobId, freelancer1.address, ethers.toUtf8Bytes("key"));

      // Freelancer1 rejects
      await jobEscrow.connect(freelancer1).rejectOffer(jobId);

      // Client can immediately select freelancer2 without waiting
      await jobEscrow.connect(client).selectFreelancer(jobId, freelancer2.address, ethers.toUtf8Bytes("key2"));
      const job = await jobEscrow.getJobInfo(jobId);
      expect(job.freelancer).to.equal(freelancer2.address);
    });

    it("should incur no reputation penalty for rejecting an offer", async function () {
      const { jobEscrow, reputation, client, freelancer1 } = await loadFixture(deployFullPlatformFixture);
      const { jobId } = await createDefaultJob(jobEscrow, client);

      await jobEscrow.connect(freelancer1).applyForJob(jobId, ethers.ZeroHash, "QmProp1");
      await jobEscrow.connect(client).selectFreelancer(jobId, freelancer1.address, ethers.toUtf8Bytes("key"));

      const repBefore = await reputation.getFreelancerProfile(freelancer1.address);
      await jobEscrow.connect(freelancer1).rejectOffer(jobId);
      const repAfter = await reputation.getFreelancerProfile(freelancer1.address);

      // No reputation change
      expect(repBefore.reputationScore).to.equal(repAfter.reputationScore);
      expect(repBefore.cancellations).to.equal(repAfter.cancellations);
    });
  });

  describe("§2.2 Step 4c — expireOffer()", function () {
    it("should allow anyone to expire an offer after T_STAKE", async function () {
      const { jobEscrow, client, freelancer1, freelancer2 } = await loadFixture(deployFullPlatformFixture);
      const { jobId } = await createDefaultJob(jobEscrow, client);

      await jobEscrow.connect(freelancer1).applyForJob(jobId, ethers.ZeroHash, "QmProp1");
      await jobEscrow.connect(client).selectFreelancer(jobId, freelancer1.address, ethers.toUtf8Bytes("key"));

      await time.increase(THREE_DAYS + 1);

      // Anyone can call expireOffer()
      await jobEscrow.connect(freelancer2).expireOffer(jobId);

      const job = await jobEscrow.getJobInfo(jobId);
      expect(job.freelancer).to.equal(ethers.ZeroAddress);
    });

    it("should revert if called before T_STAKE expires", async function () {
      const { jobEscrow, client, freelancer1, freelancer2 } = await loadFixture(deployFullPlatformFixture);
      const { jobId } = await createDefaultJob(jobEscrow, client);

      await jobEscrow.connect(freelancer1).applyForJob(jobId, ethers.ZeroHash, "QmProp1");
      await jobEscrow.connect(client).selectFreelancer(jobId, freelancer1.address, ethers.toUtf8Bytes("key"));

      await expect(
        jobEscrow.connect(freelancer2).expireOffer(jobId)
      ).to.be.revertedWithCustomError(jobEscrow, "OfferNotExpired");
    });
  });

  describe("§2.2 Steps 5-7 — Milestone Submission, Approval, and Fund Release", function () {
    it("should release milestone funds minus 2% protocol fee on approval", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1, treasury } =
        await loadFixture(deployFullPlatformFixture);
      const { jobId, milestoneValues } = await advanceJobToActive(jobEscrow, usdcContract, client, freelancer1);

      // Submit milestone 0
      await jobEscrow.connect(freelancer1).submitMilestone(
        jobId, 0, ethers.keccak256(ethers.toUtf8Bytes("deliverable")), "QmDeliverable"
      );

      // Approve milestone 0
      await jobEscrow.connect(client).approveMilestone(jobId, 0);

      // Check freelancer withdrawable balance
      const freelancerBal = await jobEscrow.withdrawableBalances(freelancer1.address);
      const msValue = milestoneValues[0];
      const expectedFee = (msValue * 200n) / 10000n;
      const expectedPayout = msValue - expectedFee;
      expect(freelancerBal).to.equal(expectedPayout);

      // Check treasury gets protocol fee
      const treasuryBal = await jobEscrow.withdrawableBalances(treasury.address);
      expect(treasuryBal).to.equal(expectedFee);
    });

    it("should auto-approve milestone after review timeout expires (strict >)", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1 } =
        await loadFixture(deployFullPlatformFixture);
      const { jobId } = await advanceJobToActive(jobEscrow, usdcContract, client, freelancer1, SEVEN_DAYS);

      await jobEscrow.connect(freelancer1).submitMilestone(
        jobId, 0, ethers.keccak256(ethers.toUtf8Bytes("deliverable")), "QmDeliverable"
      );

      const ms = await jobEscrow.getMilestoneInfo(jobId, 0);
      const submittedAt = Number(ms.submittedAt);
      const reviewTimeout = SEVEN_DAYS;

      // BUG CHECK: Per spec §2.5 rule 4, contract should use strict > (not >=)
      // The contract code reads: require(block.timestamp > ms.submittedAt + job.reviewTimeout)
      // So at exactly submittedAt + reviewTimeout, auto-approve should REVERT.
      // We use setNextBlockTimestamp to precisely control block.timestamp.
      await time.setNextBlockTimestamp(submittedAt + reviewTimeout);
      await expect(
        jobEscrow.triggerAutoApprove(jobId, 0)
      ).to.be.revertedWithCustomError(jobEscrow, "TimeoutNotExpired");

      // At submittedAt + reviewTimeout + 1, it should succeed
      await time.setNextBlockTimestamp(submittedAt + reviewTimeout + 1);
      await jobEscrow.triggerAutoApprove(jobId, 0);

      const msAfter = await jobEscrow.getMilestoneInfo(jobId, 0);
      expect(msAfter.status).to.equal(3); // AutoApproved
    });

    it("should allow anyone to trigger auto-approve after timeout", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1, deployer } =
        await loadFixture(deployFullPlatformFixture);
      const { jobId } = await advanceJobToActive(jobEscrow, usdcContract, client, freelancer1, ONE_DAY);

      await jobEscrow.connect(freelancer1).submitMilestone(
        jobId, 0, ethers.keccak256(ethers.toUtf8Bytes("deliverable")), "QmDeliverable"
      );

      await time.increase(ONE_DAY + 1);

      // Random third party can trigger
      await jobEscrow.connect(deployer).triggerAutoApprove(jobId, 0);
      const ms = await jobEscrow.getMilestoneInfo(jobId, 0);
      expect(ms.status).to.equal(3);
    });
  });

  describe("§2.2 Step 8 — Final release", function () {
    it("should refund freelancer deposit and client behavior bond after all milestones complete", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1 } =
        await loadFixture(deployFullPlatformFixture);
      const { jobId } = await advanceJobToActive(jobEscrow, usdcContract, client, freelancer1);

      // Complete both milestones
      for (let i = 0; i < 2; i++) {
        await jobEscrow.connect(freelancer1).submitMilestone(
          jobId, i, ethers.keccak256(ethers.toUtf8Bytes(`deliverable-${i}`)), `QmDel${i}`
        );
        await jobEscrow.connect(client).approveMilestone(jobId, i);
      }

      const job = await jobEscrow.getJobInfo(jobId);
      expect(job.state).to.equal(3); // Completed

      // Freelancer should have deposit in withdrawable balance
      const freelancerBal = await jobEscrow.withdrawableBalances(freelancer1.address);
      const totalValue = usdc(1000);
      const deposit = (totalValue * 750n) / 10000n; // 7.5% for New tier
      const totalMsPayout = totalValue - (totalValue * 200n) / 10000n;
      expect(freelancerBal).to.equal(totalMsPayout + deposit);

      // Client should have behavior bond back
      const clientBal = await jobEscrow.withdrawableBalances(client.address);
      const bond = (totalValue * 750n) / 10000n;
      expect(clientBal).to.equal(bond);
    });

    it("should update reputation for both parties after completion", async function () {
      const { jobEscrow, reputation, usdc: usdcContract, client, freelancer1 } =
        await loadFixture(deployFullPlatformFixture);
      const { jobId } = await advanceJobToActive(jobEscrow, usdcContract, client, freelancer1);

      // Complete all milestones
      for (let i = 0; i < 2; i++) {
        await jobEscrow.connect(freelancer1).submitMilestone(
          jobId, i, ethers.keccak256(ethers.toUtf8Bytes(`deliverable-${i}`)), `QmDel${i}`
        );
        await jobEscrow.connect(client).approveMilestone(jobId, i);
      }

      // Client reputation should update
      const clientProfile = await reputation.getClientProfile(client.address);
      expect(clientProfile.jobsCompleted).to.equal(1);
      expect(clientProfile.totalValueCompleted).to.equal(usdc(1000));

      // Freelancer reputation should update
      const freelancerProfile = await reputation.getFreelancerProfile(freelancer1.address);
      expect(freelancerProfile.jobsCompleted).to.equal(1);
      expect(freelancerProfile.totalValueCompleted).to.equal(usdc(1000));
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// §2.5 — State Transition Safety Rules
// ═══════════════════════════════════════════════════════════════

describe("§2.5 State Transition Safety Rules", function () {
  describe("Rule 1: Mutual exclusion via state preconditions", function () {
    it("should prevent approve after auto-approve (double approval)", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1 } =
        await loadFixture(deployFullPlatformFixture);
      const { jobId } = await advanceJobToActive(jobEscrow, usdcContract, client, freelancer1, ONE_DAY);

      await jobEscrow.connect(freelancer1).submitMilestone(
        jobId, 0, ethers.keccak256(ethers.toUtf8Bytes("deliverable")), "QmDel"
      );

      await time.increase(ONE_DAY + 1);
      await jobEscrow.triggerAutoApprove(jobId, 0);

      // Client trying to approve again should fail
      await expect(
        jobEscrow.connect(client).approveMilestone(jobId, 0)
      ).to.be.revertedWithCustomError(jobEscrow, "NotInReview");
    });
  });

  describe("Rule 2: Dispute freezes funds and pauses auto-approve timer", function () {
    it("should prevent auto-approve when milestone is disputed", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1 } =
        await loadFixture(deployFullPlatformFixture);
      const { jobId } = await advanceJobToActive(jobEscrow, usdcContract, client, freelancer1, SEVEN_DAYS);

      await jobEscrow.connect(freelancer1).submitMilestone(
        jobId, 0, ethers.keccak256(ethers.toUtf8Bytes("deliverable")), "QmDel"
      );

      // Raise dispute
      await jobEscrow.connect(client).raiseDispute(jobId, 0);

      // Even after review timeout, auto-approve should fail because status is Disputed
      await time.increase(SEVEN_DAYS + 1);
      await expect(
        jobEscrow.triggerAutoApprove(jobId, 0)
      ).to.be.revertedWithCustomError(jobEscrow, "NotInReview");
    });

    it("should prevent dispute on already approved milestone (per spec: irreversible)", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1 } =
        await loadFixture(deployFullPlatformFixture);
      const { jobId } = await advanceJobToActive(jobEscrow, usdcContract, client, freelancer1);

      await jobEscrow.connect(freelancer1).submitMilestone(
        jobId, 0, ethers.keccak256(ethers.toUtf8Bytes("deliverable")), "QmDel"
      );
      await jobEscrow.connect(client).approveMilestone(jobId, 0);

      // Cannot dispute an approved milestone
      await expect(
        jobEscrow.connect(client).raiseDispute(jobId, 0)
      ).to.be.revertedWithCustomError(jobEscrow, "NotInReview");
    });

    it("should only allow dispute when milestone.status == InReview", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1 } =
        await loadFixture(deployFullPlatformFixture);
      const { jobId } = await advanceJobToActive(jobEscrow, usdcContract, client, freelancer1);

      // Milestone 0 is still Pending — cannot dispute
      await expect(
        jobEscrow.connect(client).raiseDispute(jobId, 0)
      ).to.be.revertedWithCustomError(jobEscrow, "NotInReview");
    });
  });

  describe("Rule 3: Idempotent terminal operations", function () {
    it("should prevent double release of funds on same milestone", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1 } =
        await loadFixture(deployFullPlatformFixture);
      const { jobId } = await advanceJobToActive(jobEscrow, usdcContract, client, freelancer1);

      await jobEscrow.connect(freelancer1).submitMilestone(
        jobId, 0, ethers.keccak256(ethers.toUtf8Bytes("deliverable")), "QmDel"
      );
      await jobEscrow.connect(client).approveMilestone(jobId, 0);

      // Second approval attempt should fail (status already changed)
      await expect(
        jobEscrow.connect(client).approveMilestone(jobId, 0)
      ).to.be.revertedWithCustomError(jobEscrow, "NotInReview");
    });
  });

  describe("Rule 4: Strict timestamp comparisons (> not >=)", function () {
    it("should NOT auto-approve at exactly submittedAt + T_review", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1 } =
        await loadFixture(deployFullPlatformFixture);
      const { jobId } = await advanceJobToActive(jobEscrow, usdcContract, client, freelancer1, ONE_DAY);

      await jobEscrow.connect(freelancer1).submitMilestone(
        jobId, 0, ethers.keccak256(ethers.toUtf8Bytes("deliverable")), "QmDel"
      );

      const ms = await jobEscrow.getMilestoneInfo(jobId, 0);
      const exactBoundary = Number(ms.submittedAt) + ONE_DAY;

      // Set the NEXT block timestamp to exactly the boundary.
      // time.setNextBlockTimestamp only sets the timestamp for the very next block
      // that gets mined, and triggerAutoApprove will mine that block.
      // So block.timestamp == exactBoundary, and the check (block.timestamp > exactBoundary) is false.
      await time.setNextBlockTimestamp(exactBoundary);

      await expect(
        jobEscrow.triggerAutoApprove(jobId, 0)
      ).to.be.revertedWithCustomError(jobEscrow, "TimeoutNotExpired");
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// §2.6 — Cancellation Rules
// ═══════════════════════════════════════════════════════════════

describe("§2.6 Cancellation Rules", function () {
  describe("OPEN state — client cancel with no applicants", function () {
    it("should return 100% funds and behavior bond, no reputation impact", async function () {
      const { jobEscrow, reputation, client } = await loadFixture(deployFullPlatformFixture);
      const { jobId, totalValue } = await createDefaultJob(jobEscrow, client);

      const job = await jobEscrow.getJobInfo(jobId);

      await jobEscrow.connect(client).cancelJob(jobId);

      const clientBal = await jobEscrow.withdrawableBalances(client.address);
      expect(clientBal).to.equal(totalValue + job.behaviorBond);

      const jobAfter = await jobEscrow.getJobInfo(jobId);
      expect(jobAfter.state).to.equal(4); // Cancelled
    });
  });

  describe("APPLICATIONS state — client cancel before freelancer selected", function () {
    it("should return 100% funds, behavior bond, no reputation impact when no freelancer selected", async function () {
      const { jobEscrow, client, freelancer1 } = await loadFixture(deployFullPlatformFixture);
      const { jobId, totalValue } = await createDefaultJob(jobEscrow, client);

      await jobEscrow.connect(freelancer1).applyForJob(jobId, ethers.ZeroHash, "QmProp1");

      // Cancel without selecting anyone — per spec, no reputation penalty
      // BUG CHECK: Does cancelJob only charge reputation when freelancer != address(0)?
      await jobEscrow.connect(client).cancelJob(jobId);

      const jobAfter = await jobEscrow.getJobInfo(jobId);
      expect(jobAfter.state).to.equal(4);

      const clientBal = await jobEscrow.withdrawableBalances(client.address);
      const bond = (totalValue * 750n) / 10000n;
      expect(clientBal).to.equal(totalValue + bond);
    });
  });

  describe("APPLICATIONS state — client cancel after freelancer selected", function () {
    it("should charge client minor reputation penalty when cancelling after selection", async function () {
      const { jobEscrow, reputation, client, freelancer1 } = await loadFixture(deployFullPlatformFixture);
      const { jobId } = await createDefaultJob(jobEscrow, client);

      await jobEscrow.connect(freelancer1).applyForJob(jobId, ethers.ZeroHash, "QmProp1");
      await jobEscrow.connect(client).selectFreelancer(jobId, freelancer1.address, ethers.toUtf8Bytes("key"));

      // Must wait for T_STAKE to expire before cancellation is allowed
      await time.increase(THREE_DAYS + 1);

      // Now cancel — should incur reputation penalty
      await jobEscrow.connect(client).cancelJob(jobId);

      const clientProfile = await reputation.getClientProfile(client.address);
      expect(clientProfile.jobsCancelledAfterSelection).to.equal(1);
    });
  });

  describe("ACTIVE state — mutual cancellation", function () {
    it("should require counterparty consent for active job cancellation", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1 } =
        await loadFixture(deployFullPlatformFixture);
      const { jobId } = await advanceJobToActive(jobEscrow, usdcContract, client, freelancer1);

      // Client requests cancellation
      await jobEscrow.connect(client).requestCancellation(jobId);

      // Client cannot accept their own request
      await expect(
        jobEscrow.connect(client).acceptCancellation(jobId)
      ).to.be.revertedWithCustomError(jobEscrow, "OnlyCounterparty");

      // Freelancer accepts
      await jobEscrow.connect(freelancer1).acceptCancellation(jobId);

      const job = await jobEscrow.getJobInfo(jobId);
      expect(job.state).to.equal(4); // Cancelled
    });

    it("should refund remaining escrow to client and deposit to freelancer", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1 } =
        await loadFixture(deployFullPlatformFixture);
      const { jobId, totalValue } = await advanceJobToActive(jobEscrow, usdcContract, client, freelancer1);

      await jobEscrow.connect(client).requestCancellation(jobId);
      await jobEscrow.connect(freelancer1).acceptCancellation(jobId);

      // All remaining escrow goes to client
      const clientBal = await jobEscrow.withdrawableBalances(client.address);
      const bond = (totalValue * 750n) / 10000n;
      expect(clientBal).to.equal(totalValue + bond);

      // Freelancer gets deposit back (7.5% for New tier)
      const deposit = (totalValue * 750n) / 10000n;
      const freelancerBal = await jobEscrow.withdrawableBalances(freelancer1.address);
      expect(freelancerBal).to.equal(deposit);
    });

    it("should handle partial completion gracefully", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1 } =
        await loadFixture(deployFullPlatformFixture);
      const { jobId, totalValue, milestoneValues } = await advanceJobToActive(
        jobEscrow, usdcContract, client, freelancer1
      );

      // Complete milestone 0
      await jobEscrow.connect(freelancer1).submitMilestone(
        jobId, 0, ethers.keccak256(ethers.toUtf8Bytes("deliverable")), "QmDel"
      );
      await jobEscrow.connect(client).approveMilestone(jobId, 0);

      // Now mutually cancel for remaining milestones
      await jobEscrow.connect(freelancer1).requestCancellation(jobId);
      await jobEscrow.connect(client).acceptCancellation(jobId);

      // Client gets remaining milestone value + bond
      const clientBal = await jobEscrow.withdrawableBalances(client.address);
      const bond = (totalValue * 750n) / 10000n;
      expect(clientBal).to.equal(milestoneValues[1] + bond);

      // Freelancer keeps approved milestone funds + gets deposit back
      const deposit = (totalValue * 750n) / 10000n; // 7.5% for New tier
      const msValue = milestoneValues[0];
      const fee = (msValue * 200n) / 10000n;
      const payout = msValue - fee;
      const freelancerBal = await jobEscrow.withdrawableBalances(freelancer1.address);
      expect(freelancerBal).to.equal(payout + deposit);
    });
  });

  describe("ACTIVE state — unilateral cancellation forbidden", function () {
    it("should NOT allow client to unilaterally cancel an active job", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1 } =
        await loadFixture(deployFullPlatformFixture);
      const { jobId } = await advanceJobToActive(jobEscrow, usdcContract, client, freelancer1);

      // cancelJob should fail for active jobs
      await expect(
        jobEscrow.connect(client).cancelJob(jobId)
      ).to.be.revertedWithCustomError(jobEscrow, "InvalidState");
    });
  });

  describe("IN_REVIEW / DISPUTED state — cancellation blocked", function () {
    it("should block cancellation request while milestone is in review", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1 } =
        await loadFixture(deployFullPlatformFixture);
      const { jobId } = await advanceJobToActive(jobEscrow, usdcContract, client, freelancer1);

      await jobEscrow.connect(freelancer1).submitMilestone(
        jobId, 0, ethers.keccak256(ethers.toUtf8Bytes("deliverable")), "QmDel"
      );

      await expect(
        jobEscrow.connect(client).requestCancellation(jobId)
      ).to.be.revertedWithCustomError(jobEscrow, "MsInReviewOrDisputed");
    });

    it("should block cancellation request while milestone is disputed", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1 } =
        await loadFixture(deployFullPlatformFixture);
      const { jobId } = await advanceJobToActive(jobEscrow, usdcContract, client, freelancer1);

      await jobEscrow.connect(freelancer1).submitMilestone(
        jobId, 0, ethers.keccak256(ethers.toUtf8Bytes("deliverable")), "QmDel"
      );
      await jobEscrow.connect(client).raiseDispute(jobId, 0);

      await expect(
        jobEscrow.connect(client).requestCancellation(jobId)
      ).to.be.revertedWithCustomError(jobEscrow, "MsInReviewOrDisputed");
    });
  });

  describe("T_ACCEPTANCE auto-cancellation", function () {
    it("should allow client to withdraw after 14 days with no confirmed freelancer", async function () {
      const { jobEscrow, client } = await loadFixture(deployFullPlatformFixture);
      const { jobId } = await createDefaultJob(jobEscrow, client);

      // Cannot withdraw before T_ACCEPTANCE
      await expect(
        jobEscrow.connect(client).withdrawExpiredJob(jobId)
      ).to.be.revertedWithCustomError(jobEscrow, "NotExpiredYet");

      // Advance past T_ACCEPTANCE
      await time.increase(FOURTEEN_DAYS + 1);

      await jobEscrow.connect(client).withdrawExpiredJob(jobId);

      const job = await jobEscrow.getJobInfo(jobId);
      expect(job.state).to.equal(4); // Cancelled
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// §3 — Dispute Path
// ═══════════════════════════════════════════════════════════════

describe("§3 Dispute Path — Centralized Resolution", function () {
  describe("§3.3 Step 1 — raiseDispute()", function () {
    it("should only allow client or freelancer to raise dispute", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1, deployer } =
        await loadFixture(deployFullPlatformFixture);
      const { jobId } = await advanceJobToActive(jobEscrow, usdcContract, client, freelancer1);

      await jobEscrow.connect(freelancer1).submitMilestone(
        jobId, 0, ethers.keccak256(ethers.toUtf8Bytes("deliverable")), "QmDel"
      );

      await expect(
        jobEscrow.connect(deployer).raiseDispute(jobId, 0)
      ).to.be.revertedWithCustomError(jobEscrow, "NotParty");
    });

    it("should charge dispute fee: max(50 USDC, 10% * milestoneValue)", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1 } =
        await loadFixture(deployFullPlatformFixture);
      const { jobId, milestoneValues } = await advanceJobToActive(
        jobEscrow, usdcContract, client, freelancer1
      );

      await jobEscrow.connect(freelancer1).submitMilestone(
        jobId, 0, ethers.keccak256(ethers.toUtf8Bytes("deliverable")), "QmDel"
      );

      const balBefore = await usdcContract.balanceOf(client.address);
      await jobEscrow.connect(client).raiseDispute(jobId, 0);
      const balAfter = await usdcContract.balanceOf(client.address);

      const msValue = milestoneValues[0]; // 500 USDC
      const proportional = (msValue * 1000n) / 10000n; // 10% = 50 USDC
      const expectedFee = proportional > 50_000_000n ? proportional : 50_000_000n; // max(50, 50) = 50 USDC

      expect(balBefore - balAfter).to.equal(expectedFee);
    });

    it("should freeze milestone funds and change status to Disputed", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1 } =
        await loadFixture(deployFullPlatformFixture);
      const { jobId } = await advanceJobToActive(jobEscrow, usdcContract, client, freelancer1);

      await jobEscrow.connect(freelancer1).submitMilestone(
        jobId, 0, ethers.keccak256(ethers.toUtf8Bytes("deliverable")), "QmDel"
      );

      await jobEscrow.connect(client).raiseDispute(jobId, 0);

      const ms = await jobEscrow.getMilestoneInfo(jobId, 0);
      expect(ms.status).to.equal(4); // Disputed
    });
  });

  describe("§3.3 Step 2 — submitEvidence()", function () {
    it("should only allow client and freelancer to submit evidence", async function () {
      const { jobEscrow, dispute, usdc: usdcContract, client, freelancer1, deployer } =
        await loadFixture(deployFullPlatformFixture);
      const { jobId } = await advanceJobToActive(jobEscrow, usdcContract, client, freelancer1);

      await jobEscrow.connect(freelancer1).submitMilestone(
        jobId, 0, ethers.keccak256(ethers.toUtf8Bytes("deliverable")), "QmDel"
      );
      await jobEscrow.connect(client).raiseDispute(jobId, 0);

      const disputeId = await jobEscrow.disputeIds(jobId, 0);

      // Third party cannot submit evidence
      await expect(
        dispute.connect(deployer).submitEvidence(
          disputeId, ethers.keccak256(ethers.toUtf8Bytes("evidence")), "QmEvidence"
        )
      ).to.be.revertedWith("Not a party to this dispute");
    });

    it("should enforce 5-day evidence window", async function () {
      const { jobEscrow, dispute, usdc: usdcContract, client, freelancer1 } =
        await loadFixture(deployFullPlatformFixture);
      const { jobId } = await advanceJobToActive(jobEscrow, usdcContract, client, freelancer1);

      await jobEscrow.connect(freelancer1).submitMilestone(
        jobId, 0, ethers.keccak256(ethers.toUtf8Bytes("deliverable")), "QmDel"
      );
      await jobEscrow.connect(client).raiseDispute(jobId, 0);

      const disputeId = await jobEscrow.disputeIds(jobId, 0);

      // Advance past 5-day window
      await time.increase(5 * ONE_DAY + 1);

      await expect(
        dispute.connect(client).submitEvidence(
          disputeId, ethers.keccak256(ethers.toUtf8Bytes("late-evidence")), "QmLateEvidence"
        )
      ).to.be.revertedWith("Evidence window closed");
    });
  });

  describe("§3.3 Step 4 — Key distribution", function () {
    it("should enforce 2-day key distribution deadline", async function () {
      const { jobEscrow, dispute, usdc: usdcContract, client, freelancer1, platformAdmin, judge } =
        await loadFixture(deployFullPlatformFixture);
      const { jobId } = await advanceJobToActive(jobEscrow, usdcContract, client, freelancer1);

      await jobEscrow.connect(freelancer1).submitMilestone(
        jobId, 0, ethers.keccak256(ethers.toUtf8Bytes("deliverable")), "QmDel"
      );
      await jobEscrow.connect(client).raiseDispute(jobId, 0);

      const disputeId = await jobEscrow.disputeIds(jobId, 0);

      // Close evidence phase
      await time.increase(5 * ONE_DAY + 1);
      await dispute.connect(client).closeEvidencePhase(disputeId);

      // Assign judge
      const ephemeralKey = ethers.hexlify(ethers.randomBytes(33));
      await dispute.connect(platformAdmin).assignJudge(disputeId, judge.address, ephemeralKey);

      // Advance past key distribution deadline
      await time.increase(2 * ONE_DAY + 1);

      await expect(
        dispute.connect(client).distributeKeyToJudge(disputeId, ethers.randomBytes(32))
      ).to.be.revertedWith("Key distribution deadline passed");
    });

    it("should trigger default ruling against non-cooperating party", async function () {
      const { jobEscrow, dispute, usdc: usdcContract, client, freelancer1, platformAdmin, judge } =
        await loadFixture(deployFullPlatformFixture);
      const { jobId } = await advanceJobToActive(jobEscrow, usdcContract, client, freelancer1);

      await jobEscrow.connect(freelancer1).submitMilestone(
        jobId, 0, ethers.keccak256(ethers.toUtf8Bytes("deliverable")), "QmDel"
      );
      await jobEscrow.connect(client).raiseDispute(jobId, 0);

      const disputeId = await jobEscrow.disputeIds(jobId, 0);
      await time.increase(5 * ONE_DAY + 1);
      await dispute.connect(client).closeEvidencePhase(disputeId);

      const ephemeralKey = ethers.hexlify(ethers.randomBytes(33));
      await dispute.connect(platformAdmin).assignJudge(disputeId, judge.address, ephemeralKey);

      // Only freelancer submits key
      await dispute.connect(freelancer1).distributeKeyToJudge(disputeId, ethers.randomBytes(32));

      // Key distribution deadline passes without client submitting
      await time.increase(2 * ONE_DAY + 1);

      // Claim key default — client didn't cooperate, so FreelancerWins
      await dispute.claimKeyDefault(disputeId);

      const dStatus = await dispute.getDisputeStatus(disputeId);
      expect(dStatus.phase).to.equal(4); // Ruled
      expect(dStatus.ruling).to.equal(1); // FreelancerWins
    });
  });

  describe("§3.3 Step 6-7 — Ruling and Execution", function () {
    it("should execute dispute ruling and redistribute funds atomically", async function () {
      const { jobEscrow, dispute, usdc: usdcContract, client, freelancer1, platformAdmin, judge, treasury } =
        await loadFixture(deployFullPlatformFixture);
      const { jobId, milestoneValues } = await advanceJobToActive(
        jobEscrow, usdcContract, client, freelancer1
      );

      await jobEscrow.connect(freelancer1).submitMilestone(
        jobId, 0, ethers.keccak256(ethers.toUtf8Bytes("deliverable")), "QmDel"
      );
      await jobEscrow.connect(client).raiseDispute(jobId, 0);

      const disputeId = await jobEscrow.disputeIds(jobId, 0);

      // Go through dispute lifecycle
      await time.increase(5 * ONE_DAY + 1);
      await dispute.connect(client).closeEvidencePhase(disputeId);

      const ephemeralKey = ethers.hexlify(ethers.randomBytes(33));
      await dispute.connect(platformAdmin).assignJudge(disputeId, judge.address, ephemeralKey);

      await dispute.connect(client).distributeKeyToJudge(disputeId, ethers.randomBytes(32));
      await dispute.connect(freelancer1).distributeKeyToJudge(disputeId, ethers.randomBytes(32));

      // Judge submits ruling: FreelancerWins with 80% share
      const reasoningHash = ethers.keccak256(ethers.toUtf8Bytes("ruling-reasoning"));
      await dispute.connect(judge).submitRuling(disputeId, 1, reasoningHash, 8000, 0);

      // Execute ruling
      await dispute.connect(client).executeRuling(disputeId);

      // Check milestone is resolved
      const ms = await jobEscrow.getMilestoneInfo(jobId, 0);
      expect(ms.status).to.equal(5); // Resolved

      // Check funds were distributed
      const msValue = milestoneValues[0];
      const fee = (msValue * 200n) / 10000n;
      const distributable = msValue - fee;
      const freelancerAmount = (distributable * 8000n) / 10000n;

      const freelancerBal = await jobEscrow.withdrawableBalances(freelancer1.address);
      // Freelancer gets milestone payout + dispute fee refund
      expect(freelancerBal).to.be.gte(freelancerAmount);
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// §5 — Economic Incentive / Fund Accounting Verification
// ═══════════════════════════════════════════════════════════════

describe("Fund Accounting Invariants", function () {
  it("should never allow total withdrawals to exceed total deposits", async function () {
    const { jobEscrow, usdc: usdcContract, client, freelancer1, treasury } =
      await loadFixture(deployFullPlatformFixture);

    const { jobId, totalValue } = await advanceJobToActive(jobEscrow, usdcContract, client, freelancer1);
    const job = await jobEscrow.getJobInfo(jobId);
    const deposit = job.freelancerDeposit;
    const bond = job.behaviorBond;

    // Complete both milestones
    for (let i = 0; i < 2; i++) {
      await jobEscrow.connect(freelancer1).submitMilestone(
        jobId, i, ethers.keccak256(ethers.toUtf8Bytes(`del-${i}`)), `QmDel${i}`
      );
      await jobEscrow.connect(client).approveMilestone(jobId, i);
    }

    // Sum all withdrawable balances
    const clientBal = await jobEscrow.withdrawableBalances(client.address);
    const freelancerBal = await jobEscrow.withdrawableBalances(freelancer1.address);
    const treasuryBal = await jobEscrow.withdrawableBalances(treasury.address);

    const totalWithdrawable = clientBal + freelancerBal + treasuryBal;
    const totalDeposited = totalValue + bond + deposit;

    // Total withdrawable should equal total deposited
    expect(totalWithdrawable).to.equal(totalDeposited);
  });

  it("should correctly account for protocol fee across all milestones", async function () {
    const { jobEscrow, usdc: usdcContract, client, freelancer1, treasury } =
      await loadFixture(deployFullPlatformFixture);

    const { jobId, totalValue, milestoneValues } = await advanceJobToActive(
      jobEscrow, usdcContract, client, freelancer1
    );

    // Complete all milestones
    for (let i = 0; i < milestoneValues.length; i++) {
      await jobEscrow.connect(freelancer1).submitMilestone(
        jobId, i, ethers.keccak256(ethers.toUtf8Bytes(`del-${i}`)), `QmDel${i}`
      );
      await jobEscrow.connect(client).approveMilestone(jobId, i);
    }

    // Treasury should have exactly 2% of total value
    const treasuryBal = await jobEscrow.withdrawableBalances(treasury.address);
    const expectedFee = (totalValue * 200n) / 10000n;
    expect(treasuryBal).to.equal(expectedFee);
  });
});

// ═══════════════════════════════════════════════════════════════
// Dispute Fee Calculation Tests
// ═══════════════════════════════════════════════════════════════

describe("Dispute Fee Calculation (§3.3 Step 1)", function () {
  it("should use base fee (50 USDC) for small milestones", async function () {
    const { jobEscrow, usdc: usdcContract, client, freelancer1 } =
      await loadFixture(deployFullPlatformFixture);

    // Create job with a small milestone (100 USDC → 10% = 10 USDC < 50 USDC base)
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    const milestoneValues = [usdc(100), usdc(100)];
    const milestoneDeadlines = [now + 30 * ONE_DAY, now + 60 * ONE_DAY];

    const tx = await jobEscrow.connect(client).postJob(
      ethers.keccak256(ethers.toUtf8Bytes("small-job")),
      milestoneValues,
      milestoneDeadlines,
      SEVEN_DAYS,
      "QmSmallJob"
    );
    const receipt = await tx.wait();
    const event = receipt?.logs.find((log: any) => {
      try {
        return jobEscrow.interface.parseLog({ topics: log.topics as string[], data: log.data })?.name === "JobPosted";
      } catch { return false; }
    });
    const parsed = jobEscrow.interface.parseLog({ topics: event!.topics as string[], data: event!.data });
    const jobId = parsed!.args.jobId;

    // Apply, select, stake
    await jobEscrow.connect(freelancer1).applyForJob(jobId, ethers.ZeroHash, "QmProp");
    await jobEscrow.connect(client).selectFreelancer(jobId, freelancer1.address, ethers.toUtf8Bytes("key"));
    await jobEscrow.connect(freelancer1).confirmAndStake(jobId);

    // Submit and dispute
    await jobEscrow.connect(freelancer1).submitMilestone(
      jobId, 0, ethers.keccak256(ethers.toUtf8Bytes("del")), "QmDel"
    );

    const balBefore = await usdcContract.balanceOf(client.address);
    await jobEscrow.connect(client).raiseDispute(jobId, 0);
    const balAfter = await usdcContract.balanceOf(client.address);

    // Should be 50 USDC (base fee)
    expect(balBefore - balAfter).to.equal(usdc(50));
  });
});

// ═══════════════════════════════════════════════════════════════
// Abandonment Tests
// ═══════════════════════════════════════════════════════════════

describe("Abandonment (§2.4 T_deadline)", function () {
  it("should forfeit freelancer deposit to treasury on abandonment", async function () {
    const { jobEscrow, usdc: usdcContract, client, freelancer1, treasury } =
      await loadFixture(deployFullPlatformFixture);
    const { jobId, totalValue } = await advanceJobToActive(
      jobEscrow, usdcContract, client, freelancer1
    );

    const job = await jobEscrow.getJobInfo(jobId);
    const deposit = job.freelancerDeposit;

    // Advance past milestone deadline
    const milestones = await jobEscrow.getMilestones(jobId);
    const deadline = milestones[0].deadline;
    await time.increaseTo(Number(deadline) + 1);

    await jobEscrow.connect(client).claimAbandonment(jobId, 0);

    // Deposit goes to treasury
    const treasuryBal = await jobEscrow.withdrawableBalances(treasury.address);
    expect(treasuryBal).to.equal(deposit);

    // Remaining escrow goes to client
    const clientBal = await jobEscrow.withdrawableBalances(client.address);
    const bond = job.behaviorBond;
    expect(clientBal).to.equal(totalValue + bond);

    const jobAfter = await jobEscrow.getJobInfo(jobId);
    expect(jobAfter.state).to.equal(5); // Abandoned
  });

  it("should not allow abandonment claim if milestone is in review", async function () {
    const { jobEscrow, usdc: usdcContract, client, freelancer1 } =
      await loadFixture(deployFullPlatformFixture);
    const { jobId } = await advanceJobToActive(jobEscrow, usdcContract, client, freelancer1);

    // Submit milestone 0
    await jobEscrow.connect(freelancer1).submitMilestone(
      jobId, 0, ethers.keccak256(ethers.toUtf8Bytes("del")), "QmDel"
    );

    // Advance past milestone 1 deadline
    const milestones = await jobEscrow.getMilestones(jobId);
    const deadline = milestones[1].deadline;
    await time.increaseTo(Number(deadline) + 1);

    // Attempt to claim abandonment on milestone 1 should fail because milestone 0 is InReview
    await expect(
      jobEscrow.connect(client).claimAbandonment(jobId, 1)
    ).to.be.revertedWithCustomError(jobEscrow, "MsInReviewOrDisputed");
  });
});

// ═══════════════════════════════════════════════════════════════
// Dispute Ruling Outcomes (§3.4)
// ═══════════════════════════════════════════════════════════════

describe("§3.4 Ruling Outcomes", function () {
  async function setupDisputeToRuling(fixture: any) {
    const { jobEscrow, dispute, usdc: usdcContract, client, freelancer1, platformAdmin, judge, treasury } = fixture;
    const { jobId, milestoneValues } = await advanceJobToActive(
      jobEscrow, usdcContract, client, freelancer1
    );

    await jobEscrow.connect(freelancer1).submitMilestone(
      jobId, 0, ethers.keccak256(ethers.toUtf8Bytes("del")), "QmDel"
    );
    await jobEscrow.connect(client).raiseDispute(jobId, 0);

    const disputeId = await jobEscrow.disputeIds(jobId, 0);

    await time.increase(5 * ONE_DAY + 1);
    await dispute.connect(client).closeEvidencePhase(disputeId);

    const ephemeralKey = ethers.hexlify(ethers.randomBytes(33));
    await dispute.connect(platformAdmin).assignJudge(disputeId, judge.address, ephemeralKey);

    await dispute.connect(client).distributeKeyToJudge(disputeId, ethers.randomBytes(32));
    await dispute.connect(freelancer1).distributeKeyToJudge(disputeId, ethers.randomBytes(32));

    return { jobId, disputeId, milestoneValues };
  }

  it("FreelancerWins: dispute fee refunded to freelancer (initiator was client)", async function () {
    const fixture = await loadFixture(deployFullPlatformFixture);
    const { dispute, jobEscrow, judge, client, freelancer1 } = fixture;
    const { jobId, disputeId } = await setupDisputeToRuling(fixture);

    const reasoningHash = ethers.keccak256(ethers.toUtf8Bytes("reasoning"));
    await dispute.connect(judge).submitRuling(disputeId, 1, reasoningHash, 8000, 0);
    await dispute.connect(client).executeRuling(disputeId);

    // Dispute fee should go to freelancer (since they won and client was the one paying)
    // The dispute fee was paid by the client, stored in disputeFees mapping
    // Per the contract logic, when FreelancerWins, disputeFee is refunded to freelancer
    const freelancerBal = await jobEscrow.withdrawableBalances(freelancer1.address);
    expect(freelancerBal).to.be.gt(0);
  });

  it("ClientWins: deposit partially slashed", async function () {
    const fixture = await loadFixture(deployFullPlatformFixture);
    const { dispute, jobEscrow, judge, client, freelancer1, treasury } = fixture;
    const { jobId, disputeId, milestoneValues } = await setupDisputeToRuling(fixture);

    const reasoningHash = ethers.keccak256(ethers.toUtf8Bytes("reasoning"));
    // ClientWins: freelancerShareBps must be < 5000, depositSlashBps = 3000 (30%)
    await dispute.connect(judge).submitRuling(disputeId, 2, reasoningHash, 2000, 3000);
    await dispute.connect(client).executeRuling(disputeId);

    // Treasury should get slashed deposit portion
    const treasuryBal = await jobEscrow.withdrawableBalances(treasury.address);
    expect(treasuryBal).to.be.gt(0);
  });

  it("Inconclusive: dispute fee forfeited to treasury", async function () {
    const fixture = await loadFixture(deployFullPlatformFixture);
    const { dispute, jobEscrow, judge, client, treasury } = fixture;
    const { jobId, disputeId } = await setupDisputeToRuling(fixture);

    const reasoningHash = ethers.keccak256(ethers.toUtf8Bytes("reasoning"));
    // Inconclusive ruling, 50/50 split, no deposit slash
    await dispute.connect(judge).submitRuling(disputeId, 0, reasoningHash, 5000, 0);
    await dispute.connect(client).executeRuling(disputeId);

    // Treasury gets the forfeited dispute fee + protocol fee
    const treasuryBal = await jobEscrow.withdrawableBalances(treasury.address);
    expect(treasuryBal).to.be.gt(0);
  });
});
