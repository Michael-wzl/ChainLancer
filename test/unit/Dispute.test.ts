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

    const disputeId = await jobEscrow.disputeIds(jobId, 0);

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
      const { dispute, client, disputeId } = await createDisputeFixture();

      await time.increase(5 * ONE_DAY + 1);
      await dispute.connect(client).closeEvidencePhase(disputeId);

      const [phase] = await dispute.getDisputeStatus(disputeId);
      expect(phase).to.equal(1); // AwaitingJudge
    });

    it("should reject before deadline", async function () {
      const { dispute, client, disputeId } = await createDisputeFixture();

      await expect(
        dispute.connect(client).closeEvidencePhase(disputeId)
      ).to.be.revertedWith("Evidence window not closed");
    });
  });

  // ═══════════════════════════════════════════════════════════
  //                    Judge Assignment
  // ═══════════════════════════════════════════════════════════
  describe("assignJudge()", function () {
    it("should assign judge with ephemeral key", async function () {
      const { dispute, platformAdmin, judge, client, disputeId } = await createDisputeFixture();

      await time.increase(5 * ONE_DAY + 1);
      await dispute.connect(client).closeEvidencePhase(disputeId);

      const ephKey = ethers.randomBytes(33);
      await expect(
        dispute.connect(platformAdmin).assignJudge(disputeId, judge.address, ephKey)
      ).to.emit(dispute, "JudgeAssigned");

      const [phase] = await dispute.getDisputeStatus(disputeId);
      expect(phase).to.equal(2); // KeyDistribution
    });

    it("should reject assignment by non-admin", async function () {
      const { dispute, client, judge, disputeId } = await createDisputeFixture();

      await time.increase(5 * ONE_DAY + 1);
      await dispute.connect(client).closeEvidencePhase(disputeId);

      await expect(
        dispute.connect(client).assignJudge(disputeId, judge.address, ethers.randomBytes(33))
      ).to.be.reverted;
    });
  });

  // ═══════════════════════════════════════════════════════════
  //                  Key Distribution
  // ═══════════════════════════════════════════════════════════
  describe("distributeKeyToJudge()", function () {
    async function advanceToKeyDistribution() {
      const fixture = await createDisputeFixture();
      const { dispute, platformAdmin, judge, client, disputeId } = fixture;

      await time.increase(5 * ONE_DAY + 1);
      await dispute.connect(client).closeEvidencePhase(disputeId);
      await dispute.connect(platformAdmin).assignJudge(
        disputeId, judge.address, ethers.randomBytes(33)
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
      const { dispute, platformAdmin, judge, client, disputeId } = fixture;

      await time.increase(5 * ONE_DAY + 1);
      await dispute.connect(client).closeEvidencePhase(disputeId);
      await dispute.connect(platformAdmin).assignJudge(
        disputeId, judge.address, ethers.randomBytes(33)
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
      await dispute.connect(client).closeEvidencePhase(disputeId);
      await dispute.connect(platformAdmin).assignJudge(
        disputeId, judge.address, ethers.randomBytes(33)
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
        dispute.connect(client).executeRuling(disputeId)
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

  // ═══════════════════════════════════════════════════════════
  //          G-04/G-13: claimRulingDefault()
  // ═══════════════════════════════════════════════════════════
  describe("claimRulingDefault()", function () {
    async function advanceToUnderReview() {
      const fixture = await createDisputeFixture();
      const { dispute, platformAdmin, judge, client, freelancer1, disputeId } = fixture;

      await time.increase(5 * ONE_DAY + 1);
      await dispute.connect(client).closeEvidencePhase(disputeId);
      await dispute.connect(platformAdmin).assignJudge(
        disputeId, judge.address, ethers.randomBytes(33)
      );
      await dispute.connect(client).distributeKeyToJudge(disputeId, ethers.toUtf8Bytes("key1"));
      await dispute.connect(freelancer1).distributeKeyToJudge(disputeId, ethers.toUtf8Bytes("key2"));

      return fixture;
    }

    it("should default to Inconclusive 50/50 when judge misses ruling deadline", async function () {
      const { dispute, disputeId } = await advanceToUnderReview();

      // Wait past the ruling deadline (14 days)
      await time.increase(14 * ONE_DAY + 1);

      await expect(
        dispute.claimRulingDefault(disputeId)
      ).to.emit(dispute, "RulingDefaultTriggered");

      const [phase] = await dispute.getDisputeStatus(disputeId);
      expect(phase).to.equal(1); // AwaitingJudge (reset for judge reassignment)
    });

    it("should revert if ruling deadline not passed", async function () {
      const { dispute, disputeId } = await advanceToUnderReview();

      await expect(
        dispute.claimRulingDefault(disputeId)
      ).to.be.revertedWith("Ruling deadline not passed");
    });

    it("should revert if not in UnderReview phase", async function () {
      const { dispute, disputeId } = await createDisputeFixture();

      await expect(
        dispute.claimRulingDefault(disputeId)
      ).to.be.revertedWith("Wrong phase");
    });

    it("should allow judge reassignment after claimRulingDefault", async function () {
      const { dispute, platformAdmin, freelancer1, disputeId } = await advanceToUnderReview();

      await time.increase(14 * ONE_DAY + 1);
      await dispute.claimRulingDefault(disputeId);

      // After claimRulingDefault, dispute is back in AwaitingJudge
      const [phase] = await dispute.getDisputeStatus(disputeId);
      expect(phase).to.equal(1); // AwaitingJudge

      // A new judge can be assigned
      const newJudge = freelancer1; // reuse for testing purposes
      await dispute.connect(platformAdmin).assignJudge(disputeId, newJudge.address, ethers.randomBytes(33));

      const [phase2] = await dispute.getDisputeStatus(disputeId);
      expect(phase2).to.equal(2); // KeyDistribution
    });
  });

  // ═══════════════════════════════════════════════════════════
  //      G-02/G-13: closeEvidencePhase Access Control
  // ═══════════════════════════════════════════════════════════
  describe("closeEvidencePhase() access control", function () {
    it("should reject calls from non-authorized address", async function () {
      const { dispute, freelancer2, disputeId } = await createDisputeFixture();

      await time.increase(5 * ONE_DAY + 1);

      await expect(
        dispute.connect(freelancer2).closeEvidencePhase(disputeId)
      ).to.be.revertedWith("Not authorized");
    });

    it("should allow client to close evidence phase", async function () {
      const { dispute, client, disputeId } = await createDisputeFixture();

      await time.increase(5 * ONE_DAY + 1);
      await dispute.connect(client).closeEvidencePhase(disputeId);

      const [phase] = await dispute.getDisputeStatus(disputeId);
      expect(phase).to.equal(1); // AwaitingJudge
    });

    it("should allow freelancer to close evidence phase", async function () {
      const { dispute, freelancer1, disputeId } = await createDisputeFixture();

      await time.increase(5 * ONE_DAY + 1);
      await dispute.connect(freelancer1).closeEvidencePhase(disputeId);

      const [phase] = await dispute.getDisputeStatus(disputeId);
      expect(phase).to.equal(1); // AwaitingJudge
    });

    it("should allow platform admin to close evidence phase", async function () {
      const { dispute, platformAdmin, disputeId } = await createDisputeFixture();

      await time.increase(5 * ONE_DAY + 1);
      await dispute.connect(platformAdmin).closeEvidencePhase(disputeId);

      const [phase] = await dispute.getDisputeStatus(disputeId);
      expect(phase).to.equal(1); // AwaitingJudge
    });
  });

  // ═══════════════════════════════════════════════════════════
  //       G-03/G-13: executeRuling Access Control
  // ═══════════════════════════════════════════════════════════
  describe("executeRuling() access control", function () {
    async function advanceToRuled() {
      const fixture = await createDisputeFixture();
      const { dispute, platformAdmin, judge, client, freelancer1, disputeId } = fixture;

      await time.increase(5 * ONE_DAY + 1);
      await dispute.connect(client).closeEvidencePhase(disputeId);
      await dispute.connect(platformAdmin).assignJudge(
        disputeId, judge.address, ethers.randomBytes(33)
      );
      await dispute.connect(client).distributeKeyToJudge(disputeId, ethers.toUtf8Bytes("key1"));
      await dispute.connect(freelancer1).distributeKeyToJudge(disputeId, ethers.toUtf8Bytes("key2"));

      const reasonHash = ethers.keccak256(ethers.toUtf8Bytes("reasoning"));
      await dispute.connect(judge).submitRuling(disputeId, 1, reasonHash, 10000, 0);

      return fixture;
    }

    it("should reject calls from non-authorized address", async function () {
      const { dispute, freelancer2, disputeId } = await advanceToRuled();

      await expect(
        dispute.connect(freelancer2).executeRuling(disputeId)
      ).to.be.revertedWith("Not authorized");
    });

    it("should allow judge to execute ruling", async function () {
      const { dispute, judge, disputeId } = await advanceToRuled();

      await expect(
        dispute.connect(judge).executeRuling(disputeId)
      ).to.emit(dispute, "RulingExecuted");
    });
  });
});
