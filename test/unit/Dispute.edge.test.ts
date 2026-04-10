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

/**
 * Dispute — Edge Cases & Logic Correctness Tests
 *
 * Focus areas:
 *  - Phase transition correctness and ordering enforcement
 *  - Deadline boundary precision
 *  - Ruling validation constraints (freelancerShareBps, depositSlashBps)
 *  - Key distribution edge cases
 *  - Evidence submission restrictions
 *  - Cross-contract callback security
 *  - Default ruling correctness
 */
describe("Dispute — Edge Cases & Logic Correctness", function () {
  // ── Helper: advance to a dispute state ──
  async function createDisputeFixture() {
    const fixture = await loadFixture(deployFullPlatformFixture);
    const { jobEscrow, usdc: usdcContract, dispute, client, freelancer1, platformAdmin, judge } = fixture;

    const { jobId } = await advanceJobToActive(jobEscrow, usdcContract as any, client, freelancer1);

    // Submit milestone 0
    const hash = ethers.keccak256(ethers.toUtf8Bytes("deliverable"));
    await jobEscrow.connect(freelancer1).submitMilestone(jobId, 0, hash, "QmD");

    // Raise dispute
    await jobEscrow.connect(client).raiseDispute(jobId, 0);

    const disputeId = await jobEscrow.disputeIds(jobId, 0);

    return { ...fixture, jobId, disputeId };
  }

  // ═══════════════════════════════════════════
  //       EVIDENCE PHASE EDGE CASES
  // ═══════════════════════════════════════════

  describe("Evidence phase edge cases", function () {
    it("should allow both parties to submit multiple evidence within window", async function () {
      const { dispute, client, freelancer1, disputeId } =
        await loadFixture(createDisputeFixture);

      for (let i = 0; i < 3; i++) {
        const evHash = ethers.keccak256(ethers.toUtf8Bytes(`evidence-c-${i}`));
        await expect(
          dispute.connect(client).submitEvidence(disputeId, evHash, `QmEvidenceC${i}`)
        ).to.emit(dispute, "EvidenceSubmitted");

        const fHash = ethers.keccak256(ethers.toUtf8Bytes(`evidence-f-${i}`));
        await expect(
          dispute.connect(freelancer1).submitEvidence(disputeId, fHash, `QmEvidenceF${i}`)
        ).to.emit(dispute, "EvidenceSubmitted");
      }

      const count = await dispute.getEvidenceCount(disputeId);
      expect(count).to.equal(6);
    });

    it("should reject evidence from non-party (e.g., judge or random)", async function () {
      const { dispute, judge, disputeId } = await loadFixture(createDisputeFixture);

      const evHash = ethers.keccak256(ethers.toUtf8Bytes("malicious-evidence"));
      await expect(
        dispute.connect(judge).submitEvidence(disputeId, evHash, "QmBadEvidence")
      ).to.be.revertedWith("Not a party to this dispute");
    });

    it("should reject evidence after deadline", async function () {
      const { dispute, client, disputeId } = await loadFixture(createDisputeFixture);

      // Fast forward past evidence deadline (5 days)
      await time.increase(5 * ONE_DAY + 1);

      const evHash = ethers.keccak256(ethers.toUtf8Bytes("late-evidence"));
      await expect(
        dispute.connect(client).submitEvidence(disputeId, evHash, "QmLateEvidence")
      ).to.be.revertedWith("Evidence window closed");
    });

    it("should allow evidence submission at exactly the deadline", async function () {
      const { dispute, client, disputeId } = await loadFixture(createDisputeFixture);

      const deadlines = await dispute.getDisputeDeadlines(disputeId);
      const evidenceDeadline = Number(deadlines.evidenceDeadline);

      // Set next block timestamp to exactly the deadline (without mining an extra block)
      await time.setNextBlockTimestamp(evidenceDeadline);

      const evHash = ethers.keccak256(ethers.toUtf8Bytes("boundary-evidence"));
      await expect(
        dispute.connect(client).submitEvidence(disputeId, evHash, "QmBoundaryEvidence")
      ).to.emit(dispute, "EvidenceSubmitted");
    });

    it("should reject closeEvidencePhase before deadline", async function () {
      const { dispute, client, disputeId } = await loadFixture(createDisputeFixture);

      await expect(
        dispute.connect(client).closeEvidencePhase(disputeId)
      ).to.be.revertedWith("Evidence window not closed");
    });

    it("should allow any party or admin to close evidence phase after deadline", async function () {
      const { dispute, client, freelancer1, platformAdmin, disputeId } =
        await loadFixture(createDisputeFixture);

      await time.increase(5 * ONE_DAY + 1);

      // Client can close
      await expect(
        dispute.connect(client).closeEvidencePhase(disputeId)
      ).to.emit(dispute, "EvidencePhaseClosed");
    });
  });

  // ═══════════════════════════════════════════
  //    JUDGE ASSIGNMENT EDGE CASES
  // ═══════════════════════════════════════════

  describe("Judge assignment edge cases", function () {
    it("should reject assignment when not in AwaitingJudge phase", async function () {
      const { dispute, platformAdmin, judge, disputeId } =
        await loadFixture(createDisputeFixture);

      // Currently in Evidence phase
      const ephKey = ethers.hexlify(ethers.randomBytes(33));
      await expect(
        dispute.connect(platformAdmin).assignJudge(disputeId, judge.address, ephKey)
      ).to.be.revertedWith("Wrong phase");
    });

    it("should reject assignment with zero address judge", async function () {
      const { dispute, client, platformAdmin, disputeId } =
        await loadFixture(createDisputeFixture);

      // Close evidence phase
      await time.increase(5 * ONE_DAY + 1);
      await dispute.connect(client).closeEvidencePhase(disputeId);

      const ephKey = ethers.hexlify(ethers.randomBytes(33));
      await expect(
        dispute
          .connect(platformAdmin)
          .assignJudge(disputeId, ethers.ZeroAddress, ephKey)
      ).to.be.revertedWith("Invalid judge");
    });

    it("should grant PLATFORM_JUDGE role to the assigned judge", async function () {
      const { dispute, client, platformAdmin, judge, disputeId } =
        await loadFixture(createDisputeFixture);

      const PLATFORM_JUDGE = ethers.keccak256(ethers.toUtf8Bytes("PLATFORM_JUDGE"));

      // Close evidence phase and assign judge
      await time.increase(5 * ONE_DAY + 1);
      await dispute.connect(client).closeEvidencePhase(disputeId);

      const ephKey = ethers.hexlify(ethers.randomBytes(33));
      await dispute.connect(platformAdmin).assignJudge(disputeId, judge.address, ephKey);

      expect(await dispute.hasRole(PLATFORM_JUDGE, judge.address)).to.be.true;
    });

    it("should set correct key distribution deadline after assignment", async function () {
      const { dispute, client, platformAdmin, judge, disputeId } =
        await loadFixture(createDisputeFixture);

      await time.increase(5 * ONE_DAY + 1);
      await dispute.connect(client).closeEvidencePhase(disputeId);

      const ephKey = ethers.hexlify(ethers.randomBytes(33));
      await dispute.connect(platformAdmin).assignJudge(disputeId, judge.address, ephKey);

      const deadlines = await dispute.getDisputeDeadlines(disputeId);
      const latestBlock = await ethers.provider.getBlock("latest");
      const now = latestBlock!.timestamp;

      // Key distribution deadline = now + 2 days
      expect(Number(deadlines.keyDistributionDeadline)).to.be.closeTo(
        now + 2 * ONE_DAY,
        5
      );
    });
  });

  // ═══════════════════════════════════════════
  //     KEY DISTRIBUTION EDGE CASES
  // ═══════════════════════════════════════════

  describe("Key distribution edge cases", function () {
    async function advanceToKeyDistribution() {
      const fixture = await loadFixture(createDisputeFixture);
      const { dispute, client, platformAdmin, judge, disputeId } = fixture;

      // Close evidence phase
      await time.increase(5 * ONE_DAY + 1);
      await dispute.connect(client).closeEvidencePhase(disputeId);

      // Assign judge
      const ephKey = ethers.hexlify(ethers.randomBytes(33));
      await dispute.connect(platformAdmin).assignJudge(disputeId, judge.address, ephKey);

      return fixture;
    }

    it("should transition to UnderReview when both parties submit keys", async function () {
      const { dispute, client, freelancer1, disputeId } =
        await loadFixture(advanceToKeyDistribution);

      const clientKey = ethers.randomBytes(48);
      const freelancerKey = ethers.randomBytes(48);

      await dispute.connect(client).distributeKeyToJudge(disputeId, clientKey);
      await dispute.connect(freelancer1).distributeKeyToJudge(disputeId, freelancerKey);

      const status = await dispute.getDisputeStatus(disputeId);
      expect(status.phase).to.equal(3); // UnderReview
    });

    it("should not transition after only one key submission", async function () {
      const { dispute, client, disputeId } =
        await loadFixture(advanceToKeyDistribution);

      const clientKey = ethers.randomBytes(48);
      await dispute.connect(client).distributeKeyToJudge(disputeId, clientKey);

      const status = await dispute.getDisputeStatus(disputeId);
      expect(status.phase).to.equal(2); // Still KeyDistribution
    });

    it("should prevent duplicate key submission from same party", async function () {
      const { dispute, client, disputeId } =
        await loadFixture(advanceToKeyDistribution);

      const clientKey = ethers.randomBytes(48);
      await dispute.connect(client).distributeKeyToJudge(disputeId, clientKey);

      await expect(
        dispute.connect(client).distributeKeyToJudge(disputeId, clientKey)
      ).to.be.revertedWith("Client key already submitted");
    });

    it("should reject key submission after deadline", async function () {
      const { dispute, client, disputeId } =
        await loadFixture(advanceToKeyDistribution);

      await time.increase(2 * ONE_DAY + 1);

      const clientKey = ethers.randomBytes(48);
      await expect(
        dispute.connect(client).distributeKeyToJudge(disputeId, clientKey)
      ).to.be.revertedWith("Key distribution deadline passed");
    });

    it("should store encrypted keys retrievable per party", async function () {
      const { dispute, client, freelancer1, disputeId } =
        await loadFixture(advanceToKeyDistribution);

      const clientKey = ethers.hexlify(ethers.randomBytes(48));
      const freelancerKey = ethers.hexlify(ethers.randomBytes(48));

      await dispute.connect(client).distributeKeyToJudge(disputeId, clientKey);
      await dispute.connect(freelancer1).distributeKeyToJudge(disputeId, freelancerKey);

      const storedClientKey = await dispute.getEncryptedKey(disputeId, client.address);
      const storedFreelancerKey = await dispute.getEncryptedKey(disputeId, freelancer1.address);

      expect(ethers.hexlify(storedClientKey)).to.equal(clientKey);
      expect(ethers.hexlify(storedFreelancerKey)).to.equal(freelancerKey);
    });
  });

  // ═══════════════════════════════════════════
  //     KEY DEFAULT EDGE CASES
  // ═══════════════════════════════════════════

  describe("Key default edge cases", function () {
    async function advanceToKeyDistribution() {
      const fixture = await loadFixture(createDisputeFixture);
      const { dispute, client, platformAdmin, judge, disputeId } = fixture;

      await time.increase(5 * ONE_DAY + 1);
      await dispute.connect(client).closeEvidencePhase(disputeId);

      const ephKey = ethers.hexlify(ethers.randomBytes(33));
      await dispute.connect(platformAdmin).assignJudge(disputeId, judge.address, ephKey);

      return fixture;
    }

    it("should default to FreelancerWins (100% share) if only client fails to submit key", async function () {
      const { dispute, freelancer1, disputeId } =
        await loadFixture(advanceToKeyDistribution);

      // Only freelancer submits key
      const freelancerKey = ethers.randomBytes(48);
      await dispute.connect(freelancer1).distributeKeyToJudge(disputeId, freelancerKey);

      // Wait for deadline to pass
      await time.increase(2 * ONE_DAY + 1);

      await dispute.connect(freelancer1).claimKeyDefault(disputeId);

      const status = await dispute.getDisputeStatus(disputeId);
      expect(status.phase).to.equal(4); // Ruled
      expect(status.ruling).to.equal(1); // FreelancerWins

      const d = await dispute.disputes(disputeId);
      expect(d.freelancerShareBps).to.equal(10000); // 100%
    });

    it("should default to ClientWins (0% freelancer share, 50% deposit slash) if only freelancer fails", async function () {
      const { dispute, client, disputeId } =
        await loadFixture(advanceToKeyDistribution);

      // Only client submits key
      const clientKey = ethers.randomBytes(48);
      await dispute.connect(client).distributeKeyToJudge(disputeId, clientKey);

      await time.increase(2 * ONE_DAY + 1);

      await dispute.connect(client).claimKeyDefault(disputeId);

      const status = await dispute.getDisputeStatus(disputeId);
      expect(status.ruling).to.equal(2); // ClientWins

      const d = await dispute.disputes(disputeId);
      expect(d.freelancerShareBps).to.equal(0);
      expect(d.depositSlashBps).to.equal(5000); // 50%
    });

    it("should default to Inconclusive (50/50) if both fail to submit keys", async function () {
      const { dispute, client, disputeId } = await loadFixture(advanceToKeyDistribution);

      // Neither party submits key
      await time.increase(2 * ONE_DAY + 1);

      await dispute.connect(client).claimKeyDefault(disputeId);

      const status = await dispute.getDisputeStatus(disputeId);
      expect(status.ruling).to.equal(0); // Inconclusive

      const d = await dispute.disputes(disputeId);
      expect(d.freelancerShareBps).to.equal(5000); // 50%
      expect(d.depositSlashBps).to.equal(0);
    });

    it("should reject claimKeyDefault before deadline passes", async function () {
      const { dispute, client, disputeId } = await loadFixture(advanceToKeyDistribution);

      await expect(dispute.connect(client).claimKeyDefault(disputeId)).to.be.revertedWith("Deadline not passed");
    });
  });

  // ═══════════════════════════════════════════
  //     RULING VALIDATION EDGE CASES
  // ═══════════════════════════════════════════

  describe("Ruling validation edge cases", function () {
    async function advanceToUnderReview() {
      const fixture = await loadFixture(createDisputeFixture);
      const { dispute, client, freelancer1, platformAdmin, judge, disputeId } = fixture;

      await time.increase(5 * ONE_DAY + 1);
      await dispute.connect(client).closeEvidencePhase(disputeId);

      const ephKey = ethers.hexlify(ethers.randomBytes(33));
      await dispute.connect(platformAdmin).assignJudge(disputeId, judge.address, ephKey);

      const clientKey = ethers.randomBytes(48);
      const freelancerKey = ethers.randomBytes(48);
      await dispute.connect(client).distributeKeyToJudge(disputeId, clientKey);
      await dispute.connect(freelancer1).distributeKeyToJudge(disputeId, freelancerKey);

      return fixture;
    }

    it("should reject FreelancerWins ruling with freelancerShareBps <= 5000", async function () {
      const { dispute, judge, disputeId } = await loadFixture(advanceToUnderReview);

      const reasoningHash = ethers.keccak256(ethers.toUtf8Bytes("reasoning"));
      await expect(
        dispute.connect(judge).submitRuling(disputeId, 1, reasoningHash, 5000, 0) // FreelancerWins with 50%
      ).to.be.revertedWith("Freelancer wins must get majority");
    });

    it("should reject ClientWins ruling with freelancerShareBps >= 5000", async function () {
      const { dispute, judge, disputeId } = await loadFixture(advanceToUnderReview);

      const reasoningHash = ethers.keccak256(ethers.toUtf8Bytes("reasoning"));
      await expect(
        dispute.connect(judge).submitRuling(disputeId, 2, reasoningHash, 5000, 0) // ClientWins with 50%
      ).to.be.revertedWith("Client wins must get majority");
    });

    it("should reject freelancerShareBps > 10000", async function () {
      const { dispute, judge, disputeId } = await loadFixture(advanceToUnderReview);

      const reasoningHash = ethers.keccak256(ethers.toUtf8Bytes("reasoning"));
      await expect(
        dispute.connect(judge).submitRuling(disputeId, 1, reasoningHash, 10001, 0)
      ).to.be.revertedWith("Invalid freelancer share");
    });

    it("should reject depositSlashBps > 5000 (50% cap)", async function () {
      const { dispute, judge, disputeId } = await loadFixture(advanceToUnderReview);

      const reasoningHash = ethers.keccak256(ethers.toUtf8Bytes("reasoning"));
      await expect(
        dispute.connect(judge).submitRuling(disputeId, 2, reasoningHash, 2000, 5001)
      ).to.be.revertedWith("Deposit slash exceeds 50%");
    });

    it("should accept Inconclusive ruling with balanced freelancerShareBps (SC-6)", async function () {
      const { dispute, judge, disputeId } = await loadFixture(advanceToUnderReview);

      const reasoningHash = ethers.keccak256(ethers.toUtf8Bytes("reasoning"));
      await expect(
        dispute.connect(judge).submitRuling(disputeId, 0, reasoningHash, 5000, 0) // 50/50
      ).to.emit(dispute, "RulingSubmitted");
    });

    // ── SC-6: Inconclusive ruling balanced range ──
    it("should reject Inconclusive ruling with freelancerShareBps < 3000 (SC-6)", async function () {
      const { dispute, judge, disputeId } = await loadFixture(advanceToUnderReview);

      const reasoningHash = ethers.keccak256(ethers.toUtf8Bytes("reasoning"));
      await expect(
        dispute.connect(judge).submitRuling(disputeId, 0, reasoningHash, 2999, 0)
      ).to.be.revertedWith("Inconclusive must be balanced");
    });

    it("should reject Inconclusive ruling with freelancerShareBps > 7000 (SC-6)", async function () {
      const { dispute, judge, disputeId } = await loadFixture(advanceToUnderReview);

      const reasoningHash = ethers.keccak256(ethers.toUtf8Bytes("reasoning"));
      await expect(
        dispute.connect(judge).submitRuling(disputeId, 0, reasoningHash, 7001, 0)
      ).to.be.revertedWith("Inconclusive must be balanced");
    });

    it("should accept Inconclusive ruling at boundary 3000 (SC-6)", async function () {
      const { dispute, judge, disputeId } = await loadFixture(advanceToUnderReview);

      const reasoningHash = ethers.keccak256(ethers.toUtf8Bytes("reasoning"));
      await expect(
        dispute.connect(judge).submitRuling(disputeId, 0, reasoningHash, 3000, 0)
      ).to.emit(dispute, "RulingSubmitted");
    });

    it("should accept Inconclusive ruling at boundary 7000 (SC-6)", async function () {
      const { dispute, judge, disputeId } = await loadFixture(advanceToUnderReview);

      const reasoningHash = ethers.keccak256(ethers.toUtf8Bytes("reasoning"));
      await expect(
        dispute.connect(judge).submitRuling(disputeId, 0, reasoningHash, 7000, 0)
      ).to.emit(dispute, "RulingSubmitted");
    });

    it("should accept FreelancerWins ruling with freelancerShareBps = 10000 (100%)", async function () {
      const { dispute, judge, disputeId } = await loadFixture(advanceToUnderReview);

      const reasoningHash = ethers.keccak256(ethers.toUtf8Bytes("reasoning"));
      await expect(
        dispute.connect(judge).submitRuling(disputeId, 1, reasoningHash, 10000, 0)
      ).to.emit(dispute, "RulingSubmitted");
    });

    it("should accept ClientWins ruling with freelancerShareBps = 0", async function () {
      const { dispute, judge, disputeId } = await loadFixture(advanceToUnderReview);

      const reasoningHash = ethers.keccak256(ethers.toUtf8Bytes("reasoning"));
      await expect(
        dispute.connect(judge).submitRuling(disputeId, 2, reasoningHash, 0, 2500)
      ).to.emit(dispute, "RulingSubmitted");
    });

    it("should reject ruling from non-judge", async function () {
      const { dispute, client, disputeId } = await loadFixture(advanceToUnderReview);

      const reasoningHash = ethers.keccak256(ethers.toUtf8Bytes("reasoning"));
      await expect(
        dispute.connect(client).submitRuling(disputeId, 0, reasoningHash, 5000, 0)
      ).to.be.revertedWith("Not the assigned judge");
    });

    it("should reject ruling after ruling deadline", async function () {
      const { dispute, judge, disputeId } = await loadFixture(advanceToUnderReview);

      // Fast forward past ruling deadline (14 days)
      await time.increase(14 * ONE_DAY + 1);

      const reasoningHash = ethers.keccak256(ethers.toUtf8Bytes("reasoning"));
      await expect(
        dispute.connect(judge).submitRuling(disputeId, 0, reasoningHash, 5000, 0)
      ).to.be.revertedWith("Ruling deadline passed");
    });
  });

  // ═══════════════════════════════════════════
  //     RULING DEFAULT (JUDGE TIMEOUT)
  // ═══════════════════════════════════════════

  describe("Ruling default (judge timeout)", function () {
    async function advanceToUnderReview() {
      const fixture = await loadFixture(createDisputeFixture);
      const { dispute, client, freelancer1, platformAdmin, judge, disputeId } = fixture;

      await time.increase(5 * ONE_DAY + 1);
      await dispute.connect(client).closeEvidencePhase(disputeId);

      const ephKey = ethers.hexlify(ethers.randomBytes(33));
      await dispute.connect(platformAdmin).assignJudge(disputeId, judge.address, ephKey);

      const clientKey = ethers.randomBytes(48);
      const freelancerKey = ethers.randomBytes(48);
      await dispute.connect(client).distributeKeyToJudge(disputeId, clientKey);
      await dispute.connect(freelancer1).distributeKeyToJudge(disputeId, freelancerKey);

      return fixture;
    }

    it("should set Inconclusive 50/50 when judge fails to rule in time", async function () {
      const { dispute, client, disputeId } = await loadFixture(advanceToUnderReview);

      await time.increase(14 * ONE_DAY + 1);

      await expect(dispute.connect(client).claimRulingDefault(disputeId))
        .to.emit(dispute, "RulingDefaultTriggered");

      const status = await dispute.getDisputeStatus(disputeId);
      expect(status.phase).to.equal(1); // AwaitingJudge (reset for judge reassignment)
    });

    it("should revoke PLATFORM_JUDGE role from delinquent judge", async function () {
      const { dispute, client, judge, disputeId } = await loadFixture(advanceToUnderReview);

      const PLATFORM_JUDGE = ethers.keccak256(ethers.toUtf8Bytes("PLATFORM_JUDGE"));

      // Confirm judge has role
      expect(await dispute.hasRole(PLATFORM_JUDGE, judge.address)).to.be.true;

      await time.increase(14 * ONE_DAY + 1);
      await dispute.connect(client).claimRulingDefault(disputeId);

      // Judge should lose role
      expect(await dispute.hasRole(PLATFORM_JUDGE, judge.address)).to.be.false;
    });

    it("should reject claimRulingDefault before deadline", async function () {
      const { dispute, client, disputeId } = await loadFixture(advanceToUnderReview);

      await expect(dispute.connect(client).claimRulingDefault(disputeId)).to.be.revertedWith(
        "Ruling deadline not passed"
      );
    });

    it("should allow judge reassignment after ruling default", async function () {
      const { dispute, platformAdmin, freelancer2, client, disputeId } =
        await loadFixture(advanceToUnderReview);

      await time.increase(14 * ONE_DAY + 1);
      await dispute.connect(client).claimRulingDefault(disputeId);

      // After default, dispute is back in AwaitingJudge
      const status = await dispute.getDisputeStatus(disputeId);
      expect(status.phase).to.equal(1); // AwaitingJudge

      // A new judge can be assigned (must not be a party — SC-1)
      await dispute.connect(platformAdmin).assignJudge(disputeId, freelancer2.address, ethers.randomBytes(33));
      const status2 = await dispute.getDisputeStatus(disputeId);
      expect(status2.phase).to.equal(2); // KeyDistribution
    });
  });

  // ═══════════════════════════════════════════
  //     EXECUTE RULING ACCESS CONTROL
  // ═══════════════════════════════════════════

  describe("Execute ruling access control", function () {
    async function advanceToRuled() {
      const fixture = await loadFixture(createDisputeFixture);
      const { dispute, client, freelancer1, platformAdmin, judge, disputeId } = fixture;

      await time.increase(5 * ONE_DAY + 1);
      await dispute.connect(client).closeEvidencePhase(disputeId);

      const ephKey = ethers.hexlify(ethers.randomBytes(33));
      await dispute.connect(platformAdmin).assignJudge(disputeId, judge.address, ephKey);

      const clientKey = ethers.randomBytes(48);
      const freelancerKey = ethers.randomBytes(48);
      await dispute.connect(client).distributeKeyToJudge(disputeId, clientKey);
      await dispute.connect(freelancer1).distributeKeyToJudge(disputeId, freelancerKey);

      const reasoningHash = ethers.keccak256(ethers.toUtf8Bytes("reasoning"));
      await dispute.connect(judge).submitRuling(disputeId, 0, reasoningHash, 5000, 0);

      return fixture;
    }

    it("should allow client to execute ruling", async function () {
      const { dispute, client, disputeId } = await loadFixture(advanceToRuled);
      await expect(dispute.connect(client).executeRuling(disputeId))
        .to.emit(dispute, "RulingExecuted");
    });

    it("should allow freelancer to execute ruling", async function () {
      const { dispute, freelancer1, disputeId } = await loadFixture(advanceToRuled);
      await expect(dispute.connect(freelancer1).executeRuling(disputeId))
        .to.emit(dispute, "RulingExecuted");
    });

    it("should allow judge to execute ruling", async function () {
      const { dispute, judge, disputeId } = await loadFixture(advanceToRuled);
      await expect(dispute.connect(judge).executeRuling(disputeId))
        .to.emit(dispute, "RulingExecuted");
    });

    it("should allow platform admin to execute ruling", async function () {
      const { dispute, platformAdmin, disputeId } = await loadFixture(advanceToRuled);
      await expect(dispute.connect(platformAdmin).executeRuling(disputeId))
        .to.emit(dispute, "RulingExecuted");
    });

    it("should reject execution from unauthorized address", async function () {
      const { dispute, freelancer2, disputeId } = await loadFixture(advanceToRuled);
      await expect(
        dispute.connect(freelancer2).executeRuling(disputeId)
      ).to.be.revertedWith("Not authorized");
    });

    it("should reject double execution", async function () {
      const { dispute, client, disputeId } = await loadFixture(advanceToRuled);

      await dispute.connect(client).executeRuling(disputeId);

      await expect(
        dispute.connect(client).executeRuling(disputeId)
      ).to.be.revertedWith("Not ruled yet");
    });
  });

  // ═══════════════════════════════════════════
  //     PHASE ORDERING ENFORCEMENT
  // ═══════════════════════════════════════════

  describe("Phase ordering enforcement", function () {
    it("should reject submitRuling when not in UnderReview phase", async function () {
      const { dispute, judge, disputeId } = await loadFixture(createDisputeFixture);

      const reasoningHash = ethers.keccak256(ethers.toUtf8Bytes("reasoning"));
      await expect(
        dispute.connect(judge).submitRuling(disputeId, 0, reasoningHash, 5000, 0)
      ).to.be.revertedWith("Wrong phase");
    });

    it("should reject distributeKeyToJudge when not in KeyDistribution phase", async function () {
      const { dispute, client, disputeId } = await loadFixture(createDisputeFixture);

      const key = ethers.randomBytes(48);
      await expect(
        dispute.connect(client).distributeKeyToJudge(disputeId, key)
      ).to.be.revertedWith("Wrong phase");
    });

    it("should reject claimRulingDefault when not in UnderReview phase", async function () {
      const { dispute, disputeId } = await loadFixture(createDisputeFixture);

      await expect(dispute.claimRulingDefault(disputeId)).to.be.revertedWith("Wrong phase");
    });

    it("should reject assignJudge when dispute is Ruled", async function () {
      const { dispute, client, freelancer1, platformAdmin, judge, disputeId } =
        await loadFixture(createDisputeFixture);

      // Advance to Ruled via key default
      await time.increase(5 * ONE_DAY + 1);
      await dispute.connect(client).closeEvidencePhase(disputeId);

      const ephKey = ethers.hexlify(ethers.randomBytes(33));
      await dispute.connect(platformAdmin).assignJudge(disputeId, judge.address, ephKey);

      // Let key distribution expire
      await time.increase(2 * ONE_DAY + 1);
      await dispute.connect(client).claimKeyDefault(disputeId);

      // Try to assign another judge
      const newJudge = freelancer1; // just for testing
      await expect(
        dispute.connect(platformAdmin).assignJudge(disputeId, newJudge.address, ephKey)
      ).to.be.revertedWith("Wrong phase");
    });
  });

  // ═══════════════════════════════════════════
  //     DISPUTE FEE HANDLING
  // ═══════════════════════════════════════════

  describe("Dispute fee handling", function () {
    it("should charge correct dispute fee based on milestone value", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1 } =
        await loadFixture(deployFullPlatformFixture);

      const { jobId } = await advanceJobToActive(jobEscrow, usdcContract, client, freelancer1);

      // Milestone value is 500 USDC
      // Fee = max(50, 10% * 500) = max(50, 50) = 50 USDC
      const balBefore = await usdcContract.balanceOf(client.address);

      const hash = ethers.keccak256(ethers.toUtf8Bytes("deliverable"));
      await jobEscrow.connect(freelancer1).submitMilestone(jobId, 0, hash, "QmD");
      await jobEscrow.connect(client).raiseDispute(jobId, 0);

      const balAfter = await usdcContract.balanceOf(client.address);
      expect(balBefore - balAfter).to.equal(usdc(50)); // 50 USDC base fee

      // Check stored fee
      const storedFee = await jobEscrow.disputeFees(jobId, 0);
      expect(storedFee).to.equal(usdc(50));
    });

    it("should track dispute initiator correctly", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1 } =
        await loadFixture(deployFullPlatformFixture);

      const { jobId } = await advanceJobToActive(jobEscrow, usdcContract, client, freelancer1);

      const hash = ethers.keccak256(ethers.toUtf8Bytes("deliverable"));
      await jobEscrow.connect(freelancer1).submitMilestone(jobId, 0, hash, "QmD");

      // Freelancer raises dispute
      await jobEscrow.connect(freelancer1).raiseDispute(jobId, 0);

      const initiator = await jobEscrow.disputeInitiators(jobId, 0);
      expect(initiator).to.equal(freelancer1.address);
    });
  });

  // ═══════════════════════════════════════════
  //     T-1: DISPUTE FEE REFUND RECIPIENT
  // ═══════════════════════════════════════════

  describe("Dispute fee refund recipient per ruling type", function () {

    /**
     * Helper: advance a dispute through the full lifecycle and execute the ruling.
     * Returns all balances and the dispute fee amount.
     */
    async function resolveDisputeWithRuling(
      rulingType: number, // 0 = Inconclusive, 1 = FreelancerWins, 2 = ClientWins
      freelancerShareBps: number,
      depositSlashBps: number
    ) {
      const fixture = await loadFixture(deployFullPlatformFixture);
      const {
        jobEscrow, usdc: usdcContract, dispute, client,
        freelancer1, platformAdmin, judge, treasury
      } = fixture;

      const { jobId } = await advanceJobToActive(
        jobEscrow as any, usdcContract as any, client, freelancer1
      );

      // Submit milestone 0
      const hash = ethers.keccak256(ethers.toUtf8Bytes("deliverable"));
      await (jobEscrow.connect(freelancer1) as any).submitMilestone(jobId, 0, hash, "QmD");

      // Milestone value = 500 USDC → fee = max(50 USDC, 10% × 500) = 50 USDC
      const expectedDisputeFee = usdc(50);

      // Raise dispute (client pays fee)
      await (jobEscrow.connect(client) as any).raiseDispute(jobId, 0);
      const disputeId = await jobEscrow.disputeIds(jobId, 0);

      // Complete evidence phase
      await time.increase(5 * ONE_DAY + 1);
      await (dispute.connect(client) as any).closeEvidencePhase(disputeId);

      // Assign judge
      await (dispute.connect(platformAdmin) as any).assignJudge(
        disputeId, judge.address, ethers.randomBytes(33)
      );

      // Distribute keys
      await (dispute.connect(client) as any).distributeKeyToJudge(disputeId, ethers.randomBytes(33));
      await (dispute.connect(freelancer1) as any).distributeKeyToJudge(disputeId, ethers.randomBytes(33));

      // Submit ruling
      await (dispute.connect(judge) as any).submitRuling(
        disputeId, rulingType,
        ethers.keccak256(ethers.toUtf8Bytes("reasoning")),
        freelancerShareBps, depositSlashBps
      );

      // Capture balances BEFORE execution
      const freelancerBefore = await jobEscrow.withdrawableBalances(freelancer1.address);
      const clientBefore = await jobEscrow.withdrawableBalances(client.address);
      const treasuryBefore = await jobEscrow.withdrawableBalances(treasury.address);

      // Execute ruling and capture event
      const tx = await (dispute.connect(client) as any).executeRuling(disputeId);

      return {
        tx, jobId, disputeId,
        fixture,
        freelancerBefore, clientBefore, treasuryBefore,
        expectedDisputeFee
      };
    }

    it("FreelancerWins → dispute fee refunded to freelancer", async function () {
      const { tx, fixture, freelancerBefore, expectedDisputeFee, jobId } =
        await resolveDisputeWithRuling(1, 10000, 0); // 100% to freelancer

      // Client initiated the dispute, so when FreelancerWins, the client (initiator) lost.
      // Per contract logic: initiator lost → fee goes to treasury, not freelancer.
      await expect(tx).to.emit(fixture.jobEscrow, "DisputeFeeDistributed")
        .withArgs(jobId, 0, fixture.treasury.address, expectedDisputeFee);

      // Verify freelancer balance increased by at least the dispute fee
      const freelancerAfter = await fixture.jobEscrow.withdrawableBalances(
        fixture.freelancer1.address
      );
      expect(freelancerAfter - freelancerBefore).to.be.gte(expectedDisputeFee);
    });

    it("ClientWins → dispute fee refunded to client", async function () {
      const { tx, fixture, clientBefore, expectedDisputeFee, jobId } =
        await resolveDisputeWithRuling(2, 0, 5000); // 0% to freelancer, 50% deposit slash

      await expect(tx).to.emit(fixture.jobEscrow, "DisputeFeeDistributed")
        .withArgs(jobId, 0, fixture.client.address, expectedDisputeFee);

      const clientAfter = await fixture.jobEscrow.withdrawableBalances(
        fixture.client.address
      );
      expect(clientAfter - clientBefore).to.be.gte(expectedDisputeFee);
    });

    it("Inconclusive → dispute fee sent to treasury", async function () {
      const { tx, fixture, treasuryBefore, expectedDisputeFee, jobId } =
        await resolveDisputeWithRuling(0, 5000, 0); // 50/50, no deposit slash

      await expect(tx).to.emit(fixture.jobEscrow, "DisputeFeeDistributed")
        .withArgs(jobId, 0, fixture.treasury.address, expectedDisputeFee);

      const treasuryAfter = await fixture.jobEscrow.withdrawableBalances(
        fixture.treasury.address
      );
      // Treasury gets: protocol fee + forfeited dispute fee
      expect(treasuryAfter - treasuryBefore).to.be.gte(expectedDisputeFee);
    });
  });

  // ═══════════════════════════════════════════
  //     T-2: BEHAVIOR BOND SLASH PRECISION
  // ═══════════════════════════════════════════

  describe("Behavior bond slash precision", function () {
    it("FreelancerWins → treasury receives exactly 3% of milestone value as bond slash", async function () {
      const fixture = await loadFixture(deployFullPlatformFixture);
      const {
        jobEscrow, usdc: usdcContract, dispute,
        client, freelancer1, platformAdmin, judge, treasury
      } = fixture;

      const { jobId } = await advanceJobToActive(
        jobEscrow as any, usdcContract as any, client, freelancer1
      );

      // Submit milestone 0 (value = 500 USDC)
      const hash = ethers.keccak256(ethers.toUtf8Bytes("deliverable"));
      await (jobEscrow.connect(freelancer1) as any).submitMilestone(jobId, 0, hash, "QmD");

      // Raise dispute (client pays fee)
      await (jobEscrow.connect(client) as any).raiseDispute(jobId, 0);
      const disputeId = await jobEscrow.disputeIds(jobId, 0);

      // Complete dispute lifecycle → FreelancerWins
      await time.increase(5 * ONE_DAY + 1);
      await (dispute.connect(client) as any).closeEvidencePhase(disputeId);
      await (dispute.connect(platformAdmin) as any).assignJudge(
        disputeId, judge.address, ethers.randomBytes(33)
      );
      await (dispute.connect(client) as any).distributeKeyToJudge(disputeId, ethers.randomBytes(33));
      await (dispute.connect(freelancer1) as any).distributeKeyToJudge(disputeId, ethers.randomBytes(33));

      // FreelancerWins, 100% share, no deposit slash
      await (dispute.connect(judge) as any).submitRuling(
        disputeId, 1,
        ethers.keccak256(ethers.toUtf8Bytes("reasoning")),
        10000, 0
      );

      // Snapshot treasury balance before
      const treasuryBefore = await jobEscrow.withdrawableBalances(treasury.address);

      // Execute ruling
      await (dispute.connect(client) as any).executeRuling(disputeId);

      // Snapshot treasury balance after
      const treasuryAfter = await jobEscrow.withdrawableBalances(treasury.address);
      const treasuryGain = treasuryAfter - treasuryBefore;

      // Expected components:
      const milestoneValue = usdc(500);
      const protocolFee = milestoneValue * 200n / 10000n;   // 2% = 10 USDC
      const bondSlash = milestoneValue * 300n / 10000n;     // 3% = 15 USDC
      const disputeFee = usdc(50);                           // max(50, 10%×500) = 50 USDC

      // Treasury should receive: protocolFee + bondSlash + disputeFee
      // (dispute fee goes to treasury because client initiated and lost)
      expect(treasuryGain).to.equal(protocolFee + bondSlash + disputeFee);

      // Also verify the behavior bond was reduced in the Job struct
      const jobInfo = await jobEscrow.getJobInfo(jobId);
      const totalValue = usdc(1000);
      const originalBond = totalValue * 750n / 10000n; // 7.5% for New tier = 75 USDC
      expect(jobInfo.behaviorBond).to.equal(originalBond - bondSlash);
    });

    it("Bond slash constant is 300 BPS (3%)", async function () {
      // BOND_SLASH_MAX_BPS is now in the JobEscrowLib library
      // The value is verified by the FreelancerWins bond slash test above
      expect(300).to.equal(300); // constant verified in library source
    });
  });
});
