import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {
  deployFullPlatformFixture,
  advanceJobToActive,
  usdc,
  ONE_DAY,
} from "../helpers/fixtures";

/**
 * Reputation — Edge Cases & Logic Correctness Tests
 *
 * Focus areas:
 *  - ReputationLib scoring formula correctness
 *  - Tier boundary precision (exact thresholds)
 *  - Multi-operation sequencing and accumulation
 *  - Access control for all mutation functions
 *  - Edge cases in auto-approve rate calculation
 */
describe("Reputation — Edge Cases & Logic Correctness", function () {

  /**
   * Helper: load fixture and grant ESCROW_ROLE to deployer so we can
   * call reputation mutation functions directly in unit tests.
   */
  async function loadWithEscrowRole() {
    const fixture = await loadFixture(deployFullPlatformFixture);
    const { reputation, deployer, ESCROW_ROLE } = fixture;
    await reputation.grantRole(ESCROW_ROLE, deployer.address);
    return fixture;
  }

  // ═══════════════════════════════════════════
  //    FREELANCER SCORE FORMULA VERIFICATION
  // ═══════════════════════════════════════════

  describe("Freelancer score formula verification", function () {
    it("should return 0 for a fresh freelancer", async function () {
      const { reputation, freelancer1 } = await loadWithEscrowRole();
      const score = await reputation.getFreelancerScore(freelancer1.address);
      expect(score).to.equal(0);
    });

    it("should compute score = totalValue / (1 + L*0.3) with no disputes", async function () {
      const { reputation, jobEscrow, client, freelancer1, ESCROW_ROLE } =
        await loadWithEscrowRole();

      // Record a milestone completion: 1000 USDC (6 decimals)
      await reputation.recordMilestoneCompletion(freelancer1.address, usdc(1000), false, false);

      const score = await reputation.getFreelancerScore(freelancer1.address);
      // score = 1000e6 * 1e18 / 1e18 = 1000e6
      expect(score).to.equal(usdc(1000));
    });

    it("should reduce score correctly with one dispute loss", async function () {
      const { reputation, freelancer1 } = await loadWithEscrowRole();

      await reputation.recordMilestoneCompletion(freelancer1.address, usdc(1000), false, false);
      await reputation.recordFreelancerDisputeLoss(freelancer1.address);

      const score = await reputation.getFreelancerScore(freelancer1.address);
      // score = 1000e6 * 1e18 / (1e18 + 0.3 * 1e18) = 1000e6 / 1.3
      const PRECISION = 10n ** 18n;
      const expected = (usdc(1000) * PRECISION) / (PRECISION + (3n * PRECISION) / 10n);
      expect(score).to.equal(expected);
    });

    it("should reduce score more with multiple dispute losses", async function () {
      const { reputation, freelancer1 } = await loadWithEscrowRole();

      await reputation.recordMilestoneCompletion(freelancer1.address, usdc(1000), false, false);
      await reputation.recordFreelancerDisputeLoss(freelancer1.address);
      await reputation.recordFreelancerDisputeLoss(freelancer1.address);
      await reputation.recordFreelancerDisputeLoss(freelancer1.address);

      const score = await reputation.getFreelancerScore(freelancer1.address);
      // score = 1000e6 / (1 + 3*0.3) = 1000e6 / 1.9
      const PRECISION = 10n ** 18n;
      const denom = PRECISION + (3n * 3n * PRECISION) / 10n; // 1 + 0.9
      const expected = (usdc(1000) * PRECISION) / denom;
      expect(score).to.equal(expected);
    });

    it("should credit full value for non-dispute milestone, half for dispute-won", async function () {
      const { reputation, freelancer1 } = await loadWithEscrowRole();

      // Non-dispute milestone: full value
      await reputation.recordMilestoneCompletion(freelancer1.address, usdc(1000), false, false);

      let profile = await reputation.freelancerProfiles(freelancer1.address);
      expect(profile.totalValueCompleted).to.equal(usdc(1000));

      // Dispute-won milestone: half value
      await reputation.recordMilestoneCompletion(freelancer1.address, usdc(1000), true, true);

      profile = await reputation.freelancerProfiles(freelancer1.address);
      // 1000 + 500 = 1500
      expect(profile.totalValueCompleted).to.equal(usdc(1500));
    });

    it("should not credit value for dispute-lost milestone", async function () {
      const { reputation, freelancer1 } = await loadWithEscrowRole();

      await reputation.recordMilestoneCompletion(freelancer1.address, usdc(1000), true, false);

      const profile = await reputation.freelancerProfiles(freelancer1.address);
      expect(profile.totalValueCompleted).to.equal(0);
    });
  });

  // ═══════════════════════════════════════════
  //     CLIENT SCORE FORMULA VERIFICATION
  // ═══════════════════════════════════════════

  describe("Client score formula verification", function () {
    it("should return 0 for a client with 0 jobs posted", async function () {
      const { reputation, client } = await loadWithEscrowRole();
      const score = await reputation.getClientScore(client.address);
      expect(score).to.equal(0);
    });

    it("should compute score based on completion ratio and penalties", async function () {
      const { reputation, client } = await loadWithEscrowRole();

      // Post 2 jobs, complete 1
      await reputation.recordClientJobPosted(client.address);
      await reputation.recordClientJobPosted(client.address);
      await reputation.recordJobCompleted(client.address, usdc(5000), 3);

      const profile = await reputation.clientProfiles(client.address);
      expect(profile.jobsPosted).to.equal(2);
      expect(profile.jobsCompleted).to.equal(1);
      expect(profile.totalValueCompleted).to.equal(usdc(5000));

      // score = 5000e6 * (1/2) / (1 + 0 + 0 + 0) = 2500e6
      const score = await reputation.getClientScore(client.address);
      const PRECISION = 10n ** 18n;
      const completionRatio = (1n * PRECISION) / 2n; // 1/2
      const expected = (usdc(5000) * completionRatio) / PRECISION;
      expect(score).to.equal(expected);
    });

    it("should reduce score with cancellations, auto-approves, dispute losses", async function () {
      const { reputation, client } = await loadWithEscrowRole();

      await reputation.recordClientJobPosted(client.address);
      await reputation.recordJobCompleted(client.address, usdc(10000), 3);
      await reputation.recordClientCancellation(client.address);
      await reputation.recordClientAutoApprove(client.address);
      await reputation.recordClientDisputeLoss(client.address);

      const profile = await reputation.clientProfiles(client.address);
      expect(profile.jobsCancelledAfterSelection).to.equal(1);
      expect(profile.autoApproveCount).to.equal(1);
      expect(profile.disputesLost).to.equal(1);

      // score = 10000e6 * (1/1) / (1 + 1*0.3 + 1*0.1 + 1*0.05) = 10000e6 / 1.45
      const score = await reputation.getClientScore(client.address);
      const PRECISION = 10n ** 18n;
      const penalty =
        PRECISION +
        (3n * PRECISION) / 10n + // L*0.3
        PRECISION / 10n + // C*0.1
        PRECISION / 20n; // A*0.05
      const expected = (usdc(10000) * PRECISION) / penalty;
      expect(score).to.equal(expected);
    });
  });

  // ═══════════════════════════════════════════
  //        TIER BOUNDARY PRECISION
  // ═══════════════════════════════════════════

  describe("Tier boundary precision", function () {
    it("should be New tier with totalValueCompleted = 999.999999 USDC", async function () {
      const { reputation, client } = await loadWithEscrowRole();

      await reputation.recordClientJobPosted(client.address);
      // 999.999999 USDC (just under 1000)
      await reputation.recordJobCompleted(client.address, 999_999_999n, 3);

      const tier = await reputation.getClientTier(client.address);
      expect(tier).to.equal(0); // New
    });

    it("should be Bronze tier with totalValueCompleted = 1000 USDC and 100% completion", async function () {
      const { reputation, client } = await loadWithEscrowRole();

      await reputation.recordClientJobPosted(client.address);
      await reputation.recordJobCompleted(client.address, usdc(1000), 3);

      const tier = await reputation.getClientTier(client.address);
      expect(tier).to.equal(1); // Bronze
    });

    it("should remain Bronze at 9999.999999 USDC value", async function () {
      const { reputation, client } = await loadWithEscrowRole();

      await reputation.recordClientJobPosted(client.address);
      await reputation.recordJobCompleted(client.address, 9_999_999_999n, 3);

      const tier = await reputation.getClientTier(client.address);
      expect(tier).to.equal(1); // Bronze
    });

    it("should require > 75% completion for Silver", async function () {
      const { reputation, client } = await loadWithEscrowRole();

      // 4 jobs, 3 completed = 75% → NOT Silver (needs > 75)
      for (let i = 0; i < 4; i++) {
        await reputation.recordClientJobPosted(client.address);
      }
      for (let i = 0; i < 3; i++) {
        await reputation.recordJobCompleted(client.address, usdc(2500), 3);
      }

      // totalValueCompleted = 7500, completionRate = 75% → not Silver (needs > 75%)
      // Actually wait: 3/4 = 75, which is NOT > 75, so should be Bronze
      const tier = await reputation.getClientTier(client.address);
      expect(tier).to.equal(1); // Bronze, not Silver
    });

    it("should be Silver when completion is > 75% and value >= 10000 USDC", async function () {
      const { reputation, client } = await loadWithEscrowRole();

      // 10 jobs, 8 completed = 80% > 75%
      for (let i = 0; i < 10; i++) {
        await reputation.recordClientJobPosted(client.address);
      }
      for (let i = 0; i < 8; i++) {
        await reputation.recordJobCompleted(client.address, usdc(1500), 3);
      }

      // totalValueCompleted = 12000, completionRate = 80%
      const tier = await reputation.getClientTier(client.address);
      expect(tier).to.equal(2); // Silver
    });

    it("should require autoApproveRate < 10% for Gold", async function () {
      const { reputation, client } = await loadWithEscrowRole();

      // Build up Gold-level stats
      for (let i = 0; i < 20; i++) {
        await reputation.recordClientJobPosted(client.address);
      }
      for (let i = 0; i < 19; i++) {
        await reputation.recordJobCompleted(client.address, usdc(3000), 3);
      }

      // totalValueCompleted = 57000, completionRate = 95%
      // But add many auto-approves: 19 completed jobs * 3 milestones each = 57 total milestones
      // Need >= 10% = 6 auto-approves to block Gold
      for (let i = 0; i < 6; i++) {
        await reputation.recordClientAutoApprove(client.address);
      }

      const tier = await reputation.getClientTier(client.address);
      // autoApproveRate = 6/(19*3) = 6/57 ≈ 10.5% >= 10 → NOT Gold
      expect(tier).to.equal(2); // Silver, not Gold
    });

    it("should achieve Gold with high value, > 90% completion, < 10% auto-approve rate", async function () {
      const { reputation, client } = await loadWithEscrowRole();

      for (let i = 0; i < 20; i++) {
        await reputation.recordClientJobPosted(client.address);
      }
      for (let i = 0; i < 19; i++) {
        await reputation.recordJobCompleted(client.address, usdc(3000), 3);
      }

      // totalValue = 57000, completion = 95%, autoApprove = 0 → Gold
      const tier = await reputation.getClientTier(client.address);
      expect(tier).to.equal(3); // Gold
    });
  });

  // ═══════════════════════════════════════════
  //     AUTO-APPROVE RATE EDGE CASES
  // ═══════════════════════════════════════════

  describe("Auto-approve rate edge cases", function () {
    it("should return 0% auto-approve rate with 0 completed jobs", async function () {
      const { reputation, client } = await loadWithEscrowRole();

      // No jobs completed → totalMilestones = 0 → rate = 0
      await reputation.recordClientJobPosted(client.address);

      // Should still be New tier
      const tier = await reputation.getClientTier(client.address);
      expect(tier).to.equal(0); // New
    });
  });

  // ═══════════════════════════════════════════
  //     ACCESS CONTROL FOR ALL MUTATIONS
  // ═══════════════════════════════════════════

  describe("Access control for all mutation functions", function () {
    it("should reject recordMilestoneCompletion from non-ESCROW_ROLE", async function () {
      const { reputation, freelancer1, client } = await loadWithEscrowRole();

      await expect(
        (reputation.connect(client) as any).recordMilestoneCompletion(freelancer1.address, usdc(100), false, false)
      ).to.be.reverted;
    });

    it("should reject recordFreelancerDisputeLoss from non-ESCROW_ROLE", async function () {
      const { reputation, freelancer1, client } = await loadWithEscrowRole();

      await expect(
        (reputation.connect(client) as any).recordFreelancerDisputeLoss(freelancer1.address)
      ).to.be.reverted;
    });

    it("should reject recordClientDisputeLoss from non-ESCROW_ROLE", async function () {
      const { reputation, client, freelancer1 } = await loadWithEscrowRole();

      await expect(
        (reputation.connect(freelancer1) as any).recordClientDisputeLoss(client.address)
      ).to.be.reverted;
    });

    it("should reject recordClientJobPosted from non-ESCROW_ROLE", async function () {
      const { reputation, client, freelancer1 } = await loadWithEscrowRole();

      await expect(
        (reputation.connect(freelancer1) as any).recordClientJobPosted(client.address)
      ).to.be.reverted;
    });

    it("should reject recordClientCancellation from non-ESCROW_ROLE", async function () {
      const { reputation, client, freelancer1 } = await loadWithEscrowRole();

      await expect(
        (reputation.connect(freelancer1) as any).recordClientCancellation(client.address)
      ).to.be.reverted;
    });

    it("should reject recordClientAutoApprove from non-ESCROW_ROLE", async function () {
      const { reputation, client, freelancer1 } = await loadWithEscrowRole();

      await expect(
        (reputation.connect(freelancer1) as any).recordClientAutoApprove(client.address)
      ).to.be.reverted;
    });

    it("should reject recordJobCompleted from non-ESCROW_ROLE", async function () {
      const { reputation, client, freelancer1 } = await loadWithEscrowRole();

      await expect(
        (reputation.connect(freelancer1) as any).recordJobCompleted(client.address, usdc(1000), 3)
      ).to.be.reverted;
    });

    it("should reject recordFreelancerJobCompleted from non-ESCROW_ROLE", async function () {
      const { reputation, freelancer1, client } = await loadWithEscrowRole();

      await expect(
        (reputation.connect(client) as any).recordFreelancerJobCompleted(freelancer1.address)
      ).to.be.reverted;
    });
  });

  // ═══════════════════════════════════════════
  //    MULTI-OPERATION ACCUMULATION
  // ═══════════════════════════════════════════

  describe("Multi-operation accumulation", function () {
    it("should accumulate totalValueCompleted correctly across multiple milestones", async function () {
      const { reputation, freelancer1 } = await loadWithEscrowRole();

      await reputation.recordMilestoneCompletion(freelancer1.address, usdc(100), false, false);
      await reputation.recordMilestoneCompletion(freelancer1.address, usdc(200), false, false);
      await reputation.recordMilestoneCompletion(freelancer1.address, usdc(300), false, false);

      const profile = await reputation.freelancerProfiles(freelancer1.address);
      expect(profile.totalValueCompleted).to.equal(usdc(600));
    });

    it("should track jobsCompleted independently from milestones", async function () {
      const { reputation, freelancer1 } = await loadWithEscrowRole();

      // jobsCompleted is only incremented by recordFreelancerJobCompleted
      await reputation.recordMilestoneCompletion(freelancer1.address, usdc(500), false, false);
      await reputation.recordMilestoneCompletion(freelancer1.address, usdc(500), false, false);
      await reputation.recordFreelancerJobCompleted(freelancer1.address);

      const profile = await reputation.freelancerProfiles(freelancer1.address);
      expect(profile.totalValueCompleted).to.equal(usdc(1000));
      expect(profile.jobsCompleted).to.equal(1);
    });

    it("should emit FreelancerScoreUpdated on every milestone completion", async function () {
      const { reputation, freelancer1 } = await loadWithEscrowRole();

      await expect(
        reputation.recordMilestoneCompletion(freelancer1.address, usdc(500), false, false)
      ).to.emit(reputation, "FreelancerScoreUpdated");
    });

    it("should emit ClientScoreUpdated on profile-changing operations", async function () {
      const { reputation, client } = await loadWithEscrowRole();

      await expect(reputation.recordClientJobPosted(client.address))
        .to.emit(reputation, "ClientScoreUpdated");

      await expect(reputation.recordClientCancellation(client.address))
        .to.emit(reputation, "ClientScoreUpdated");

      await expect(reputation.recordClientAutoApprove(client.address))
        .to.emit(reputation, "ClientScoreUpdated");
    });
  });

  // ═══════════════════════════════════════════
  //   T-3: FREELANCER CANCELLATION REPUTATION
  // ═══════════════════════════════════════════

  describe("Freelancer cancellation reputation penalty", function () {
    it("should increment cancellations counter when freelancer initiates cancellation", async function () {
      const fixture = await loadFixture(deployFullPlatformFixture);
      const { jobEscrow, usdc: usdcContract, reputation, client, freelancer1 } = fixture;

      const { jobId } = await advanceJobToActive(
        jobEscrow as any, usdcContract as any, client, freelancer1
      );

      // Get freelancer profile before cancellation
      const profileBefore = await reputation.getFreelancerProfile(freelancer1.address);

      // Freelancer requests cancellation
      await (jobEscrow.connect(freelancer1) as any).requestCancellation(jobId);

      // Client accepts
      await (jobEscrow.connect(client) as any).acceptCancellation(jobId);

      // Get freelancer profile after cancellation
      const profileAfter = await reputation.getFreelancerProfile(freelancer1.address);

      // After G-2: check cancellations field (not disputesLost)
      expect(profileAfter.cancellations).to.equal(profileBefore.cancellations + 1n);
      // disputesLost should remain unchanged
      expect(profileAfter.disputesLost).to.equal(profileBefore.disputesLost);
    });

    it("should NOT increment cancellations when client initiates cancellation", async function () {
      const fixture = await loadFixture(deployFullPlatformFixture);
      const { jobEscrow, usdc: usdcContract, reputation, client, freelancer1 } = fixture;

      const { jobId } = await advanceJobToActive(
        jobEscrow as any, usdcContract as any, client, freelancer1
      );

      const profileBefore = await reputation.getFreelancerProfile(freelancer1.address);

      // Client requests cancellation
      await (jobEscrow.connect(client) as any).requestCancellation(jobId);

      // Freelancer accepts
      await (jobEscrow.connect(freelancer1) as any).acceptCancellation(jobId);

      const profileAfter = await reputation.getFreelancerProfile(freelancer1.address);

      // Freelancer's cancellations and disputesLost should NOT change
      expect(profileAfter.cancellations).to.equal(profileBefore.cancellations);
      expect(profileAfter.disputesLost).to.equal(profileBefore.disputesLost);
    });

    it("should decrease freelancer reputation score after cancellation penalty", async function () {
      const fixture = await loadFixture(deployFullPlatformFixture);
      const { jobEscrow, usdc: usdcContract, reputation, client, freelancer1 } = fixture;

      // First complete a job to build some reputation
      const { jobId: job1Id } = await advanceJobToActive(
        jobEscrow as any, usdcContract as any, client, freelancer1
      );
      const hash = ethers.keccak256(ethers.toUtf8Bytes("work"));
      await (jobEscrow.connect(freelancer1) as any).submitMilestone(job1Id, 0, hash, "QmW0");
      await (jobEscrow.connect(client) as any).approveMilestone(job1Id, 0);
      await (jobEscrow.connect(freelancer1) as any).submitMilestone(job1Id, 1, hash, "QmW1");
      await (jobEscrow.connect(client) as any).approveMilestone(job1Id, 1);

      // Check score after completing a full job
      const scoreBefore = await reputation.getFreelancerScore(freelancer1.address);
      expect(scoreBefore).to.be.gt(0);

      // Now start and cancel a second job (manual creation to avoid CID collision)
      const now = (await ethers.provider.getBlock("latest"))!.timestamp;
      const msValues = [usdc(500), usdc(500)];
      const msDeadlines = [now + 30 * 86400, now + 60 * 86400];
      const agreeHash2 = ethers.keccak256(ethers.toUtf8Bytes("agreement-cancel-test"));
      const tx2 = await (jobEscrow.connect(client) as any).postJob(agreeHash2, msValues, msDeadlines, 7 * 86400, "QmAgreementCancel");
      const receipt2 = await tx2.wait();
      const ev2 = receipt2?.logs.find((log: any) => {
        try { return jobEscrow.interface.parseLog({ topics: log.topics as string[], data: log.data })?.name === "JobPosted"; } catch { return false; }
      });
      const job2Id = jobEscrow.interface.parseLog({ topics: ev2!.topics as string[], data: ev2!.data })!.args.jobId;
      const proposalHash2 = ethers.keccak256(ethers.toUtf8Bytes("proposal-cancel"));
      await (jobEscrow.connect(freelancer1) as any).applyForJob(job2Id, proposalHash2, "QmPropCancel");
      await (jobEscrow.connect(client) as any).selectFreelancer(job2Id, freelancer1.address, ethers.toUtf8Bytes("key"));
      await (jobEscrow.connect(freelancer1) as any).confirmAndStake(job2Id);

      await (jobEscrow.connect(freelancer1) as any).requestCancellation(job2Id);
      await (jobEscrow.connect(client) as any).acceptCancellation(job2Id);

      // Score should decrease due to cancellation penalty (C × 0.1)
      const scoreAfter = await reputation.getFreelancerScore(freelancer1.address);
      expect(scoreAfter).to.be.lt(scoreBefore);
    });

    it("should apply lighter penalty for cancellation (C*0.1) vs dispute loss (L*0.3)", async function () {
      const fixture = await loadFixture(deployFullPlatformFixture);
      const { reputation, deployer, ESCROW_ROLE, freelancer1, freelancer2 } = fixture;
      await reputation.grantRole(ESCROW_ROLE, deployer.address);

      // Give both freelancers identical base reputation
      await reputation.recordMilestoneCompletion(freelancer1.address, usdc(1000), false, false);
      await reputation.recordMilestoneCompletion(freelancer2.address, usdc(1000), false, false);

      const scoreBase = await reputation.getFreelancerScore(freelancer1.address);

      // freelancer1 gets a cancellation penalty (C*0.1)
      await reputation.recordFreelancerCancellation(freelancer1.address);
      const scoreCancellation = await reputation.getFreelancerScore(freelancer1.address);

      // freelancer2 gets a dispute loss penalty (L*0.3)
      await reputation.recordFreelancerDisputeLoss(freelancer2.address);
      const scoreDisputeLoss = await reputation.getFreelancerScore(freelancer2.address);

      // Both should be less than base
      expect(scoreCancellation).to.be.lt(scoreBase);
      expect(scoreDisputeLoss).to.be.lt(scoreBase);

      // Cancellation penalty should be lighter than dispute loss
      // score_cancel = 1000e6 / (1 + 0.1) = 1000e6 / 1.1
      // score_dispute = 1000e6 / (1 + 0.3) = 1000e6 / 1.3
      // score_cancel > score_dispute
      expect(scoreCancellation).to.be.gt(scoreDisputeLoss);
    });
  });
});
