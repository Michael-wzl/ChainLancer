import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {
  deployFullPlatformFixture,
  createDefaultJob,
  advanceJobToActive,
  usdc,
  ONE_DAY,
  SEVEN_DAYS,
} from "../helpers/fixtures";

/**
 * Security Tests — Access Control
 *
 * Verifies that every restricted function reverts when called
 * from an unauthorized address.
 */
describe("Security: Access Control", function () {
  // ═══════════════════════════════════════════════════════════
  //  JobEscrow — Only client / Only freelancer / Only DISPUTE_ROLE
  // ═══════════════════════════════════════════════════════════

  describe("JobEscrow restricted functions", function () {
    it("selectFreelancer: rejects non-client", async function () {
      const { jobEscrow, usdc: usdcToken, client, freelancer1, freelancer2 } =
        await loadFixture(deployFullPlatformFixture);

      const { jobId } = await createDefaultJob(jobEscrow, client);
      const proposalHash = ethers.keccak256(ethers.toUtf8Bytes("proposal"));
      await jobEscrow.connect(freelancer1).applyForJob(jobId, proposalHash, "");

      const encKey = ethers.toUtf8Bytes("enc-key");
      await expect(
        jobEscrow.connect(freelancer2).selectFreelancer(jobId, freelancer1.address, encKey)
      ).to.be.revertedWithCustomError(jobEscrow, "OnlyClient");
    });

    it("confirmAndStake: rejects non-selected freelancer", async function () {
      const { jobEscrow, usdc: usdcToken, client, freelancer1, freelancer2 } =
        await loadFixture(deployFullPlatformFixture);

      const { jobId } = await createDefaultJob(jobEscrow, client);
      const proposalHash = ethers.keccak256(ethers.toUtf8Bytes("proposal"));
      await jobEscrow.connect(freelancer1).applyForJob(jobId, proposalHash, "");
      await jobEscrow.connect(freelancer2).applyForJob(jobId, proposalHash, "");

      const encKey = ethers.toUtf8Bytes("enc-key");
      await jobEscrow.connect(client).selectFreelancer(jobId, freelancer1.address, encKey);

      // freelancer2 should not be able to stake
      await expect(
        jobEscrow.connect(freelancer2).confirmAndStake(jobId)
      ).to.be.revertedWithCustomError(jobEscrow, "NotSelected");
    });

    it("submitMilestone: rejects non-freelancer", async function () {
      const { jobEscrow, usdc: usdcToken, client, freelancer1 } =
        await loadFixture(deployFullPlatformFixture);

      const { jobId } = await advanceJobToActive(jobEscrow, usdcToken, client, freelancer1);

      const deliverableHash = ethers.keccak256(ethers.toUtf8Bytes("deliverable-0"));
      await expect(
        jobEscrow.connect(client).submitMilestone(jobId, 0, deliverableHash, "QmDeliv0")
      ).to.be.revertedWithCustomError(jobEscrow, "OnlyFreelancer");
    });

    it("approveMilestone: rejects non-client", async function () {
      const { jobEscrow, usdc: usdcToken, client, freelancer1 } =
        await loadFixture(deployFullPlatformFixture);

      const { jobId } = await advanceJobToActive(jobEscrow, usdcToken, client, freelancer1);

      const deliverableHash = ethers.keccak256(ethers.toUtf8Bytes("deliverable-0"));
      await jobEscrow.connect(freelancer1).submitMilestone(jobId, 0, deliverableHash, "QmDeliv0");

      await expect(
        jobEscrow.connect(freelancer1).approveMilestone(jobId, 0)
      ).to.be.revertedWithCustomError(jobEscrow, "OnlyClient");
    });

    it("cancelJob: rejects non-client", async function () {
      const { jobEscrow, usdc: usdcToken, client, freelancer1 } =
        await loadFixture(deployFullPlatformFixture);

      const { jobId } = await createDefaultJob(jobEscrow, client);

      await expect(
        jobEscrow.connect(freelancer1).cancelJob(jobId)
      ).to.be.revertedWithCustomError(jobEscrow, "OnlyClient");
    });

    it("claimAbandonment: rejects non-client", async function () {
      const { jobEscrow, usdc: usdcToken, client, freelancer1, freelancer2 } =
        await loadFixture(deployFullPlatformFixture);

      const { jobId } = await advanceJobToActive(jobEscrow, usdcToken, client, freelancer1);

      await expect(
        jobEscrow.connect(freelancer2).claimAbandonment(jobId, 0)
      ).to.be.revertedWithCustomError(jobEscrow, "OnlyClient");
    });

    it("executeDisputeRuling: rejects direct call from non-DISPUTE_ROLE", async function () {
      const { jobEscrow, client } = await loadFixture(deployFullPlatformFixture);

      await expect(
        jobEscrow.connect(client).executeDisputeRuling(0, 0, 1, 8000, 0)
      ).to.be.reverted; // AccessControl revert
    });

    it("pause/unpause: rejects non-admin", async function () {
      const { jobEscrow, freelancer1 } = await loadFixture(deployFullPlatformFixture);

      await expect(
        jobEscrow.connect(freelancer1).pause()
      ).to.be.reverted;

      await expect(
        jobEscrow.connect(freelancer1).unpause()
      ).to.be.reverted;
    });
  });

  // ═══════════════════════════════════════════════════════════
  //  Reputation — Only ESCROW_ROLE
  // ═══════════════════════════════════════════════════════════

  describe("Reputation restricted functions", function () {
    it("recordMilestoneCompletion: rejects non-ESCROW_ROLE", async function () {
      const { reputation, freelancer1 } = await loadFixture(deployFullPlatformFixture);

      await expect(
        reputation.connect(freelancer1).recordMilestoneCompletion(
          freelancer1.address, usdc(500), false, false
        )
      ).to.be.reverted;
    });

    it("recordFreelancerDisputeLoss: rejects non-ESCROW_ROLE", async function () {
      const { reputation, client } = await loadFixture(deployFullPlatformFixture);

      await expect(
        reputation.connect(client).recordFreelancerDisputeLoss(client.address)
      ).to.be.reverted;
    });

    it("recordClientJobPosted: rejects non-ESCROW_ROLE", async function () {
      const { reputation, client } = await loadFixture(deployFullPlatformFixture);

      await expect(
        reputation.connect(client).recordClientJobPosted(client.address)
      ).to.be.reverted;
    });

    it("recordClientCancellation: rejects non-ESCROW_ROLE", async function () {
      const { reputation, client } = await loadFixture(deployFullPlatformFixture);

      await expect(
        reputation.connect(client).recordClientCancellation(client.address)
      ).to.be.reverted;
    });

    it("recordClientAutoApprove: rejects non-ESCROW_ROLE", async function () {
      const { reputation, client } = await loadFixture(deployFullPlatformFixture);

      await expect(
        reputation.connect(client).recordClientAutoApprove(client.address)
      ).to.be.reverted;
    });

    it("recordJobCompleted: rejects non-ESCROW_ROLE", async function () {
      const { reputation, client } = await loadFixture(deployFullPlatformFixture);

      await expect(
        reputation.connect(client).recordJobCompleted(client.address, usdc(1000), 3)
      ).to.be.reverted;
    });

    it("recordFreelancerJobCompleted: rejects non-ESCROW_ROLE", async function () {
      const { reputation, freelancer1 } = await loadFixture(deployFullPlatformFixture);

      await expect(
        reputation.connect(freelancer1).recordFreelancerJobCompleted(freelancer1.address)
      ).to.be.reverted;
    });
  });

  // ═══════════════════════════════════════════════════════════
  //  Dispute — Only ESCROW_ROLE / Only PLATFORM_ADMIN / Only Judge
  // ═══════════════════════════════════════════════════════════

  describe("Dispute restricted functions", function () {
    it("createDispute: rejects non-ESCROW_ROLE", async function () {
      const { dispute, client, freelancer1 } = await loadFixture(deployFullPlatformFixture);

      await expect(
        dispute.connect(client).createDispute(
          0, 0, client.address, client.address, freelancer1.address, usdc(500)
        )
      ).to.be.reverted;
    });

    it("assignJudge: rejects non-PLATFORM_ADMIN", async function () {
      const { dispute, client, judge } = await loadFixture(deployFullPlatformFixture);

      const ephKey = ethers.randomBytes(33);
      await expect(
        dispute.connect(client).assignJudge(0, judge.address, ephKey)
      ).to.be.reverted;
    });

    it("setJobEscrow: rejects non-admin", async function () {
      const { dispute, client } = await loadFixture(deployFullPlatformFixture);

      await expect(
        dispute.connect(client).setJobEscrow(client.address)
      ).to.be.reverted;
    });

    it("setJobEscrow: allows admin to update (M-2: removed one-time lock)", async function () {
      const { dispute, deployer } = await loadFixture(deployFullPlatformFixture);

      // M-2: Admin can now re-set the JobEscrow address (no more "Already set" revert)
      await expect(
        dispute.connect(deployer).setJobEscrow(deployer.address)
      ).to.not.be.reverted;
    });
  });

  // ═══════════════════════════════════════════════════════════
  //  DataAvailability — setRetentionExpiry requires role
  // ═══════════════════════════════════════════════════════════

  describe("DataAvailability restricted functions", function () {
    it("setRetentionExpiry: rejects non-authorized caller", async function () {
      const { dataAvailability, freelancer1 } = await loadFixture(deployFullPlatformFixture);

      await expect(
        dataAvailability.connect(freelancer1).setRetentionExpiry(0, 1000)
      ).to.be.revertedWith("Not authorized");
    });
  });
});
