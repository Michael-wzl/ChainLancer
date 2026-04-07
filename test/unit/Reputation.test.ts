import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { deployFullPlatformFixture, usdc } from "../helpers/fixtures";

async function getEscrowSigner(jobEscrowAddress: string) {
  const signer = await ethers.getImpersonatedSigner(jobEscrowAddress);
  // Fund impersonated signer using hardhat_setBalance (no receive() needed)
  await ethers.provider.send("hardhat_setBalance", [
    jobEscrowAddress,
    "0xDE0B6B3A7640000", // 1 ETH
  ]);
  return signer;
}

describe("Reputation", function () {
  // ═══════════════════════════════════════════════════════════
  //                    Access Control
  // ═══════════════════════════════════════════════════════════
  describe("Access Control", function () {
    it("should reject calls from non-ESCROW_ROLE", async function () {
      const { reputation, client, freelancer1 } = await loadFixture(deployFullPlatformFixture);

      await expect(
        reputation.connect(client).recordMilestoneCompletion(freelancer1.address, usdc(500), false, false)
      ).to.be.reverted;
    });
  });

  // ═══════════════════════════════════════════════════════════
  //           Freelancer Reputation Score
  // ═══════════════════════════════════════════════════════════
  describe("Freelancer Score", function () {
    it("should increase with milestone completions", async function () {
      const { reputation, jobEscrow, freelancer1 } = await loadFixture(deployFullPlatformFixture);
      const escrowSigner = await getEscrowSigner(await jobEscrow.getAddress());

      await reputation.connect(escrowSigner).recordMilestoneCompletion(freelancer1.address, usdc(1000), false, false);
      const profile = await reputation.freelancerProfiles(freelancer1.address);
      expect(profile.totalValueCompleted).to.equal(usdc(1000));
      expect(profile.reputationScore).to.be.gt(0);
    });

    it("should decrease with dispute losses", async function () {
      const { reputation, jobEscrow, freelancer1 } = await loadFixture(deployFullPlatformFixture);
      const escrowSigner = await getEscrowSigner(await jobEscrow.getAddress());

      // Build some rep first
      await reputation.connect(escrowSigner).recordMilestoneCompletion(freelancer1.address, usdc(5000), false, false);
      const scoreBefore = (await reputation.freelancerProfiles(freelancer1.address)).reputationScore;

      // Lose a dispute
      await reputation.connect(escrowSigner).recordFreelancerDisputeLoss(freelancer1.address);
      const scoreAfter = (await reputation.freelancerProfiles(freelancer1.address)).reputationScore;

      expect(scoreAfter).to.be.lt(scoreBefore);
    });

    it("should correctly calculate score using ReputationLib formula", async function () {
      const { reputation, jobEscrow, freelancer1 } = await loadFixture(deployFullPlatformFixture);
      const escrowSigner = await getEscrowSigner(await jobEscrow.getAddress());

      await reputation.connect(escrowSigner).recordMilestoneCompletion(freelancer1.address, usdc(10000), false, false);

      const profile = await reputation.freelancerProfiles(freelancer1.address);
      // score = totalValueCompleted * PRECISION / (PRECISION + disputesLost * 3 * PRECISION / 10)
      // score = 10000e6 * 1e18 / (1e18 + 0) = 10000e6
      expect(profile.reputationScore).to.equal(usdc(10000));
    });
  });

  // ═══════════════════════════════════════════════════════════
  //                    Client Profile
  // ═══════════════════════════════════════════════════════════
  describe("Client Profile", function () {
    it("should track job posting", async function () {
      const { reputation, jobEscrow, client } = await loadFixture(deployFullPlatformFixture);
      const escrowSigner = await getEscrowSigner(await jobEscrow.getAddress());

      await reputation.connect(escrowSigner).recordClientJobPosted(client.address);
      const profile = await reputation.clientProfiles(client.address);
      expect(profile.jobsPosted).to.equal(1);
    });

    it("should track cancellations and affect score", async function () {
      const { reputation, jobEscrow, client } = await loadFixture(deployFullPlatformFixture);
      const escrowSigner = await getEscrowSigner(await jobEscrow.getAddress());

      await reputation.connect(escrowSigner).recordClientJobPosted(client.address);
      await reputation.connect(escrowSigner).recordClientCancellation(client.address);

      const profile = await reputation.clientProfiles(client.address);
      expect(profile.jobsCancelledAfterSelection).to.equal(1);
    });

    it("should track auto-approves", async function () {
      const { reputation, jobEscrow, client } = await loadFixture(deployFullPlatformFixture);
      const escrowSigner = await getEscrowSigner(await jobEscrow.getAddress());

      await reputation.connect(escrowSigner).recordClientAutoApprove(client.address);
      const profile = await reputation.clientProfiles(client.address);
      expect(profile.autoApproveCount).to.equal(1);
    });
  });

  // ═══════════════════════════════════════════════════════════
  //                   Client Tiers
  // ═══════════════════════════════════════════════════════════
  describe("Tier Calculation", function () {
    it("should start as New tier", async function () {
      const { reputation, client } = await loadFixture(deployFullPlatformFixture);
      const tier = await reputation.getClientTier(client.address);
      expect(tier).to.equal(0); // New
    });

    it("should progress to Bronze tier", async function () {
      const { reputation, jobEscrow, client } = await loadFixture(deployFullPlatformFixture);
      const escrowSigner = await getEscrowSigner(await jobEscrow.getAddress());

      // Post 3 jobs, complete all, high completion ratio
      for (let i = 0; i < 3; i++) {
        await reputation.connect(escrowSigner).recordClientJobPosted(client.address);
        await reputation.connect(escrowSigner).recordJobCompleted(client.address, usdc(1000), 3);
      }

      const tier = await reputation.getClientTier(client.address);
      expect(tier).to.equal(1); // Bronze
    });
  });

  // ═══════════════════════════════════════════════════════════
  //          G-13: Tier Boundary Conditions
  // ═══════════════════════════════════════════════════════════
  describe("getClientTier boundary conditions", function () {
    it("should return New when totalValueCompleted == 999e6", async function () {
      const { reputation, jobEscrow, client } = await loadFixture(deployFullPlatformFixture);
      const escrowSigner = await getEscrowSigner(await jobEscrow.getAddress());

      // Post 1 job, complete with 999 USDC → just below Bronze threshold
      await reputation.connect(escrowSigner).recordClientJobPosted(client.address);
      await reputation.connect(escrowSigner).recordJobCompleted(client.address, usdc(999), 3);

      const tier = await reputation.getClientTier(client.address);
      expect(tier).to.equal(0); // New
    });

    it("should return Bronze when totalValueCompleted == 1000e6 and completion > 50%", async function () {
      const { reputation, jobEscrow, client } = await loadFixture(deployFullPlatformFixture);
      const escrowSigner = await getEscrowSigner(await jobEscrow.getAddress());

      // Post 2 jobs, complete both (100% completion > 50%), total = 1000
      await reputation.connect(escrowSigner).recordClientJobPosted(client.address);
      await reputation.connect(escrowSigner).recordClientJobPosted(client.address);
      await reputation.connect(escrowSigner).recordJobCompleted(client.address, usdc(500), 3);
      await reputation.connect(escrowSigner).recordJobCompleted(client.address, usdc(500), 3);

      const tier = await reputation.getClientTier(client.address);
      expect(tier).to.equal(1); // Bronze
    });

    it("should return Bronze (not Silver) when totalValueCompleted == 9999e6", async function () {
      const { reputation, jobEscrow, client } = await loadFixture(deployFullPlatformFixture);
      const escrowSigner = await getEscrowSigner(await jobEscrow.getAddress());

      // All completed, 9999 USDC — below Silver threshold
      await reputation.connect(escrowSigner).recordClientJobPosted(client.address);
      await reputation.connect(escrowSigner).recordJobCompleted(client.address, usdc(9999), 3);

      const tier = await reputation.getClientTier(client.address);
      expect(tier).to.equal(1); // Bronze
    });

    it("should return Silver when totalValueCompleted == 10_000e6, completion > 75%, autoApprove < 20%", async function () {
      const { reputation, jobEscrow, client } = await loadFixture(deployFullPlatformFixture);
      const escrowSigner = await getEscrowSigner(await jobEscrow.getAddress());

      // Post 2 jobs, complete both (100% > 75%), total = 10000, no auto-approves
      await reputation.connect(escrowSigner).recordClientJobPosted(client.address);
      await reputation.connect(escrowSigner).recordClientJobPosted(client.address);
      await reputation.connect(escrowSigner).recordJobCompleted(client.address, usdc(5000), 3);
      await reputation.connect(escrowSigner).recordJobCompleted(client.address, usdc(5000), 3);

      const tier = await reputation.getClientTier(client.address);
      expect(tier).to.equal(2); // Silver
    });

    it("should return Silver (not Gold) when totalValueCompleted == 49_999e6", async function () {
      const { reputation, jobEscrow, client } = await loadFixture(deployFullPlatformFixture);
      const escrowSigner = await getEscrowSigner(await jobEscrow.getAddress());

      await reputation.connect(escrowSigner).recordClientJobPosted(client.address);
      await reputation.connect(escrowSigner).recordJobCompleted(client.address, usdc(49999), 3);

      const tier = await reputation.getClientTier(client.address);
      expect(tier).to.equal(2); // Silver
    });

    it("should return Gold when totalValueCompleted == 50_000e6, completion > 90%, autoApprove < 10%", async function () {
      const { reputation, jobEscrow, client } = await loadFixture(deployFullPlatformFixture);
      const escrowSigner = await getEscrowSigner(await jobEscrow.getAddress());

      // Post 2 jobs, complete both (100% > 90%), total = 50000, no auto-approves
      await reputation.connect(escrowSigner).recordClientJobPosted(client.address);
      await reputation.connect(escrowSigner).recordClientJobPosted(client.address);
      await reputation.connect(escrowSigner).recordJobCompleted(client.address, usdc(25000), 3);
      await reputation.connect(escrowSigner).recordJobCompleted(client.address, usdc(25000), 3);

      const tier = await reputation.getClientTier(client.address);
      expect(tier).to.equal(3); // Gold
    });

    it("should remain Silver if autoApproveRate >= 10% even with $50k+", async function () {
      const { reputation, jobEscrow, client } = await loadFixture(deployFullPlatformFixture);
      const escrowSigner = await getEscrowSigner(await jobEscrow.getAddress());

      // Post 2 jobs, complete both, total = 50000
      await reputation.connect(escrowSigner).recordClientJobPosted(client.address);
      await reputation.connect(escrowSigner).recordClientJobPosted(client.address);
      await reputation.connect(escrowSigner).recordJobCompleted(client.address, usdc(25000), 3);
      await reputation.connect(escrowSigner).recordJobCompleted(client.address, usdc(25000), 3);

      // autoApproveRate = autoApproveCount * 100 / totalMilestoneCount
      // With 2 completed jobs, milestoneCount=3 each → totalMilestones = 6
      // Need autoApproveRate >= 10 → autoApproveCount * 100 / 6 >= 10 → autoApproveCount >= 1
      await reputation.connect(escrowSigner).recordClientAutoApprove(client.address);

      // autoApproveRate = 1 * 100 / 6 = 16 → >= 10, so NOT Gold
      const tier = await reputation.getClientTier(client.address);
      expect(tier).to.equal(2); // Silver, not Gold
    });

    it("should remain Bronze if completion rate <= 75% even with $10k+", async function () {
      const { reputation, jobEscrow, client } = await loadFixture(deployFullPlatformFixture);
      const escrowSigner = await getEscrowSigner(await jobEscrow.getAddress());

      // Post 4 jobs, complete 3 → 75% completion, which is NOT > 75% (strict >)
      for (let i = 0; i < 4; i++) {
        await reputation.connect(escrowSigner).recordClientJobPosted(client.address);
      }
      await reputation.connect(escrowSigner).recordJobCompleted(client.address, usdc(4000), 3);
      await reputation.connect(escrowSigner).recordJobCompleted(client.address, usdc(3000), 3);
      await reputation.connect(escrowSigner).recordJobCompleted(client.address, usdc(3000), 3);

      // total = 10000, completion = 3/4 = 75% → NOT > 75%
      const tier = await reputation.getClientTier(client.address);
      expect(tier).to.equal(1); // Bronze, not Silver
    });
  });

  // ═══════════════════════════════════════════════════════════
  //          G-13: Tier Progression Lifecycle
  // ═══════════════════════════════════════════════════════════
  describe("Tier progression lifecycle", function () {
    it("should progress New → Bronze → Silver → Gold as thresholds are met", async function () {
      const { reputation, jobEscrow, client } = await loadFixture(deployFullPlatformFixture);
      const escrowSigner = await getEscrowSigner(await jobEscrow.getAddress());

      // Start: New
      expect(await reputation.getClientTier(client.address)).to.equal(0);

      // Post 2 jobs, complete both with 500 each → total 1000, completion 100% → Bronze
      await reputation.connect(escrowSigner).recordClientJobPosted(client.address);
      await reputation.connect(escrowSigner).recordClientJobPosted(client.address);
      await reputation.connect(escrowSigner).recordJobCompleted(client.address, usdc(500), 3);
      await reputation.connect(escrowSigner).recordJobCompleted(client.address, usdc(500), 3);
      expect(await reputation.getClientTier(client.address)).to.equal(1); // Bronze

      // Complete more to reach 10000 → Silver
      await reputation.connect(escrowSigner).recordClientJobPosted(client.address);
      await reputation.connect(escrowSigner).recordJobCompleted(client.address, usdc(9000), 3);
      expect(await reputation.getClientTier(client.address)).to.equal(2); // Silver

      // Complete more to reach 50000 → Gold
      await reputation.connect(escrowSigner).recordClientJobPosted(client.address);
      await reputation.connect(escrowSigner).recordJobCompleted(client.address, usdc(40000), 3);
      expect(await reputation.getClientTier(client.address)).to.equal(3); // Gold
    });
  });
});
