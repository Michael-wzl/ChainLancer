import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {
  deployFullPlatformFixture,
  advanceJobToActive,
  usdc,
  ONE_DAY,
  SEVEN_DAYS,
} from "../helpers/fixtures";

describe("Dispute", function () {
  /** Helper: advance to a dispute state */
  async function createDisputeFixture() {
    const fixture = await loadFixture(deployFullPlatformFixture);
    const { jobEscrow, usdc: usdcContract, client, freelancer1, dispute, platformAdmin, judge } = fixture;

    const { jobId } = await advanceJobToActive(jobEscrow, usdcContract as any, client, freelancer1);

    // Submit milestone
    await jobEscrow.connect(freelancer1).submitMilestone(
      jobId, 0, ethers.keccak256(ethers.toUtf8Bytes("work")), "QmWorkCID"
    );

    // Raise dispute (client pays dispute fee)
    await usdcContract.connect(client).approve(await jobEscrow.getAddress(), ethers.MaxUint256);
    await jobEscrow.connect(client).raiseDispute(jobId, 0);

    const disputeId = await jobEscrow.disputeIds(jobId);

    return { ...fixture, jobId, disputeId };
  }

  // ═══════════════════════════════════════════════════════════
  //                   Evidence Submission
  // ═══════════════════════════════════════════════════════════
  describe("submitEvidence()", function () {
    it("should allow both parties to submit evidence", async function () {
      const { dispute, client, freelancer1, disputeId } = await createDisputeFixture();

      const evHash1 = ethers.keccak256(ethers.toUtf8Bytes("client-evidence"));
      await expect(
        dispute.connect(client).submitEvidence(disputeId, evHash1, "QmClientEvidence")
      ).to.emit(dispute, "EvidenceSubmitted");

      const evHash2 = ethers.keccak256(ethers.toUtf8Bytes("freelancer-evidence"));
      await expect(
        dispute.connect(freelancer1).submitEvidence(disputeId, evHash2, "QmFreelancerEvidence")
      ).to.emit(dispute, "EvidenceSubmitted");

      const count = await dispute.getEvidenceCount(disputeId);
      expect(count).to.equal(2);
    });

    it("should reject evidence after deadline", async function () {
      const { dispute, client, disputeId } = await createDisputeFixture();

      await time.increase(5 * ONE_DAY + 1);

      await expect(
        dispute.connect(client).submitEvidence(disputeId, ethers.ZeroHash, "QmCID")
      ).to.be.revertedWith("Evidence window closed");
    });

    it("should reject evidence from non-parties", async function () {
      const { dispute, freelancer2, disputeId } = await createDisputeFixture();

      await expect(
        dispute.connect(freelancer2).submitEvidence(disputeId, ethers.ZeroHash, "QmCID")
      ).to.be.revertedWith("Not a party to this dispute");
    });
  });

  // ═══════════════════════════════════════════════════════════
  //                  Close Evidence Phase
  // ═══════════════════════════════════════════════════════════
  describe("closeEvidencePhase()", function () {
    it("should transition to AwaitingJudge after deadline", async function () {
      const { dispute, disputeId } = await createDisputeFixture();

      await time.increase(5 * ONE_DAY + 1);
      await dispute.closeEvidencePhase(disputeId);

      const [phase] = await dispute.getDisputeStatus(disputeId);
      expect(phase).to.equal(1); // AwaitingJudge
    });

    it("should reject before deadline", async function () {
      const { dispute, disputeId } = await createDisputeFixture();

      await expect(
        dispute.closeEvidencePhase(disputeId)
      ).to.be.revertedWith("Evidence window not closed");
    });
  });

  // ═══════════════════════════════════════════════════════════
  //                    Judge Assignment
  // ═══════════════════════════════════════════════════════════
  describe("assignJudge()", function () {
    it("should assign judge with ephemeral key", async function () {
      const { dispute, platformAdmin, judge, disputeId } = await createDisputeFixture();

      await time.increase(5 * ONE_DAY + 1);
      await dispute.closeEvidencePhase(disputeId);

      const ephKey = ethers.toUtf8Bytes("ephemeral-public-key");
      await expect(
        dispute.connect(platformAdmin).assignJudge(disputeId, judge.address, ephKey)
      ).to.emit(dispute, "JudgeAssigned");

      const [phase] = await dispute.getDisputeStatus(disputeId);
      expect(phase).to.equal(2); // KeyDistribution
    });

    it("should reject assignment by non-admin", async function () {
      const { dispute, client, judge, disputeId } = await createDisputeFixture();

      await time.increase(5 * ONE_DAY + 1);
      await dispute.closeEvidencePhase(disputeId);

      await expect(
        dispute.connect(client).assignJudge(disputeId, judge.address, ethers.toUtf8Bytes("key"))
      ).to.be.reverted;
    });
  });

  // ═══════════════════════════════════════════════════════════
  //                  Key Distribution
  // ═══════════════════════════════════════════════════════════
  describe("distributeKeyToJudge()", function () {
    async function advanceToKeyDistribution() {
      const fixture = await createDisputeFixture();
      const { dispute, platformAdmin, judge, disputeId } = fixture;

      await time.increase(5 * ONE_DAY + 1);
      await dispute.closeEvidencePhase(disputeId);
      await dispute.connect(platformAdmin).assignJudge(
        disputeId, judge.address, ethers.toUtf8Bytes("eph-key")
      );

      return fixture;
    }

    it("should accept keys from both parties and transition to UnderReview", async function () {
      const { dispute, client, freelancer1, disputeId } = await advanceToKeyDistribution();

      await dispute.connect(client).distributeKeyToJudge(disputeId, ethers.toUtf8Bytes("enc-key-client"));
      await dispute.connect(freelancer1).distributeKeyToJudge(disputeId, ethers.toUtf8Bytes("enc-key-free"));

      const [phase] = await dispute.getDisputeStatus(disputeId);
      expect(phase).to.equal(3); // UnderReview
    });

    it("should reject duplicate key submission", async function () {
      const { dispute, client, disputeId } = await advanceToKeyDistribution();

      await dispute.connect(client).distributeKeyToJudge(disputeId, ethers.toUtf8Bytes("enc-key"));
      await expect(
        dispute.connect(client).distributeKeyToJudge(disputeId, ethers.toUtf8Bytes("enc-key-2"))
      ).to.be.revertedWith("Client key already submitted");
    });
  });

  // ═══════════════════════════════════════════════════════════
  //                   Key Default
  // ═══════════════════════════════════════════════════════════
  describe("claimKeyDefault()", function () {
    async function advanceToKeyDistribution() {
      const fixture = await createDisputeFixture();
      const { dispute, platformAdmin, judge, disputeId } = fixture;

      await time.increase(5 * ONE_DAY + 1);
      await dispute.closeEvidencePhase(disputeId);
      await dispute.connect(platformAdmin).assignJudge(
        disputeId, judge.address, ethers.toUtf8Bytes("eph-key")
      );

      return fixture;
    }

    it("should default to FreelancerWins if client doesn't submit key", async function () {
      const { dispute, freelancer1, disputeId } = await advanceToKeyDistribution();

      // Only freelancer submits
      await dispute.connect(freelancer1).distributeKeyToJudge(disputeId, ethers.toUtf8Bytes("key"));

      // Wait for key distribution deadline
      await time.increase(2 * ONE_DAY + 1);
      await dispute.claimKeyDefault(disputeId);

      const [phase, ruling] = await dispute.getDisputeStatus(disputeId);
      expect(phase).to.equal(4); // Ruled
      expect(ruling).to.equal(1); // FreelancerWins
    });

    it("should default to ClientWins if freelancer doesn't submit key", async function () {
      const { dispute, client, disputeId } = await advanceToKeyDistribution();

      await dispute.connect(client).distributeKeyToJudge(disputeId, ethers.toUtf8Bytes("key"));

      await time.increase(2 * ONE_DAY + 1);
      await dispute.claimKeyDefault(disputeId);

      const [phase, ruling] = await dispute.getDisputeStatus(disputeId);
      expect(ruling).to.equal(2); // ClientWins
    });

    it("should default to Inconclusive if neither submits key", async function () {
      const { dispute, disputeId } = await advanceToKeyDistribution();

      await time.increase(2 * ONE_DAY + 1);
      await dispute.claimKeyDefault(disputeId);

      const [phase, ruling] = await dispute.getDisputeStatus(disputeId);
      expect(ruling).to.equal(0); // Inconclusive
    });
  });

  // ═══════════════════════════════════════════════════════════
  //                    Ruling & Execution
  // ═══════════════════════════════════════════════════════════
  describe("submitRuling() and executeRuling()", function () {
    async function advanceToUnderReview() {
      const fixture = await createDisputeFixture();
      const { dispute, platformAdmin, judge, client, freelancer1, disputeId } = fixture;

      await time.increase(5 * ONE_DAY + 1);
      await dispute.closeEvidencePhase(disputeId);
      await dispute.connect(platformAdmin).assignJudge(
        disputeId, judge.address, ethers.toUtf8Bytes("eph-key")
      );
      await dispute.connect(client).distributeKeyToJudge(disputeId, ethers.toUtf8Bytes("key1"));
      await dispute.connect(freelancer1).distributeKeyToJudge(disputeId, ethers.toUtf8Bytes("key2"));

      return fixture;
    }

    it("should allow judge to submit ruling (FreelancerWins)", async function () {
      const { dispute, judge, disputeId } = await advanceToUnderReview();

      const reasoningHash = ethers.keccak256(ethers.toUtf8Bytes("ruling-reasoning"));
      await expect(
        dispute.connect(judge).submitRuling(disputeId, 1, reasoningHash, 10000, 0) // FreelancerWins, 100% to freelancer
      ).to.emit(dispute, "RulingSubmitted");
    });

    it("should execute ruling and distribute funds via JobEscrow", async function () {
      const { dispute, judge, jobEscrow, freelancer1, client, disputeId, jobId } = await advanceToUnderReview();

      const reasoningHash = ethers.keccak256(ethers.toUtf8Bytes("reasoning"));
      await dispute.connect(judge).submitRuling(disputeId, 1, reasoningHash, 10000, 0);

      await expect(
        dispute.executeRuling(disputeId)
      ).to.emit(dispute, "RulingExecuted");

      // Verify milestone is resolved
      const msInfo = await jobEscrow.getMilestoneInfo(jobId, 0);
      expect(msInfo.status).to.equal(5); // Resolved
    });

    it("should reject ruling from non-judge", async function () {
      const { dispute, client, disputeId } = await advanceToUnderReview();

      await expect(
        dispute.connect(client).submitRuling(disputeId, 1, ethers.ZeroHash, 10000, 0)
      ).to.be.revertedWith("Not the assigned judge");
    });

    it("should reject ruling past deadline", async function () {
      const { dispute, judge, disputeId } = await advanceToUnderReview();

      await time.increase(14 * ONE_DAY + 1);

      await expect(
        dispute.connect(judge).submitRuling(disputeId, 1, ethers.ZeroHash, 10000, 0)
      ).to.be.revertedWith("Ruling deadline passed");
    });
  });
});
