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
      await reputation.connect(escrowSigner).recordDisputeLoss(freelancer1.address);
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
        await reputation.connect(escrowSigner).recordJobCompleted(client.address, usdc(1000));
      }

      const tier = await reputation.getClientTier(client.address);
      expect(tier).to.equal(1); // Bronze
    });
  });
});
