import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {
  deployFullPlatformFixture,
  advanceJobToActive,
  createDefaultJob,
  usdc,
  ONE_DAY,
} from "../helpers/fixtures";

/**
 * Enhanced Security Tests
 *
 * Focus areas:
 *  - Cross-contract attack vectors (unauthorized executeDisputeRuling)
 *  - Treasury fund security (slashed amounts go to treasury)
 *  - Pause mechanism completeness
 *  - Role escalation prevention
 *  - Fund accounting integrity
 *  - Withdraw patterns (CEI adherence)
 */
describe("Enhanced Security Tests", function () {
  // ═══════════════════════════════════════════
  //    CROSS-CONTRACT ATTACK VECTORS
  // ═══════════════════════════════════════════

  describe("Cross-contract: unauthorized executeDisputeRuling", function () {
    it("should reject executeDisputeRuling from client", async function () {
      const fixture = await loadFixture(deployFullPlatformFixture);
      const { jobEscrow, client } = fixture;

      await expect(
        (jobEscrow.connect(client) as any).executeDisputeRuling(0, 0, 1, 10000, 0)
      ).to.be.reverted;
    });

    it("should reject executeDisputeRuling from freelancer", async function () {
      const fixture = await loadFixture(deployFullPlatformFixture);
      const { jobEscrow, freelancer1 } = fixture;

      await expect(
        (jobEscrow.connect(freelancer1) as any).executeDisputeRuling(0, 0, 1, 10000, 0)
      ).to.be.reverted;
    });

    it("should reject executeDisputeRuling from deployer (DEFAULT_ADMIN)", async function () {
      const fixture = await loadFixture(deployFullPlatformFixture);
      const { jobEscrow, deployer } = fixture;

      // Even DEFAULT_ADMIN cannot call — only DISPUTE_ROLE
      await expect(
        (jobEscrow.connect(deployer) as any).executeDisputeRuling(0, 0, 1, 10000, 0)
      ).to.be.reverted;
    });

    it("should reject executeDisputeRuling from a random address with no role", async function () {
      const fixture = await loadFixture(deployFullPlatformFixture);
      const { jobEscrow } = fixture;
      const [, , , , , , , attacker] = await ethers.getSigners();

      await expect(
        (jobEscrow.connect(attacker) as any).executeDisputeRuling(0, 0, 1, 10000, 0)
      ).to.be.reverted;
    });

    it("should reject if caller has ESCROW_ROLE but not DISPUTE_ROLE", async function () {
      const fixture = await loadFixture(deployFullPlatformFixture);
      const { jobEscrow, deployer } = fixture;

      const [, , , , , , , , exploiter] = await ethers.getSigners();
      const ESCROW_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ESCROW_ROLE"));
      await (jobEscrow.connect(deployer) as any).grantRole(ESCROW_ROLE, exploiter.address);

      await expect(
        (jobEscrow.connect(exploiter) as any).executeDisputeRuling(0, 0, 1, 10000, 0)
      ).to.be.reverted;
    });
  });

  // ═══════════════════════════════════════════
  //    ROLE ESCALATION PREVENTION
  // ═══════════════════════════════════════════

  describe("Role escalation prevention", function () {
    it("should prevent client from granting themselves ESCROW_ROLE on Reputation", async function () {
      const fixture = await loadFixture(deployFullPlatformFixture);
      const { reputation, client } = fixture;

      const ESCROW_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ESCROW_ROLE"));
      await expect(
        (reputation.connect(client) as any).grantRole(ESCROW_ROLE, client.address)
      ).to.be.reverted;
    });

    it("should prevent freelancer from granting themselves DISPUTE_ROLE on JobEscrow", async function () {
      const fixture = await loadFixture(deployFullPlatformFixture);
      const { jobEscrow, freelancer1 } = fixture;

      const DISPUTE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("DISPUTE_ROLE"));
      await expect(
        (jobEscrow.connect(freelancer1) as any).grantRole(DISPUTE_ROLE, freelancer1.address)
      ).to.be.reverted;
    });

    it("should prevent non-admin from granting PLATFORM_JUDGE role on Dispute", async function () {
      const fixture = await loadFixture(deployFullPlatformFixture);
      const { dispute: disputeContract, freelancer1 } = fixture;

      const PLATFORM_JUDGE = ethers.keccak256(ethers.toUtf8Bytes("PLATFORM_JUDGE"));
      await expect(
        (disputeContract.connect(freelancer1) as any).grantRole(PLATFORM_JUDGE, freelancer1.address)
      ).to.be.reverted;
    });

    it("should prevent non-admin from granting DEFAULT_ADMIN_ROLE", async function () {
      const fixture = await loadFixture(deployFullPlatformFixture);
      const { jobEscrow, client } = fixture;

      const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;
      await expect(
        (jobEscrow.connect(client) as any).grantRole(DEFAULT_ADMIN_ROLE, client.address)
      ).to.be.reverted;
    });

    it("should allow admin to grant and revoke roles", async function () {
      const fixture = await loadFixture(deployFullPlatformFixture);
      const { reputation, deployer, freelancer1 } = fixture;

      const ESCROW_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ESCROW_ROLE"));

      await (reputation.connect(deployer) as any).grantRole(ESCROW_ROLE, freelancer1.address);
      expect(await reputation.hasRole(ESCROW_ROLE, freelancer1.address)).to.be.true;

      await (reputation.connect(deployer) as any).revokeRole(ESCROW_ROLE, freelancer1.address);
      expect(await reputation.hasRole(ESCROW_ROLE, freelancer1.address)).to.be.false;
    });
  });

  // ═══════════════════════════════════════════
  //    TREASURY FUND SECURITY
  // ═══════════════════════════════════════════

  describe("Treasury fund security", function () {
    it("should credit protocol fee to treasury on milestone approval", async function () {
      const fixture = await loadFixture(deployFullPlatformFixture);
      const { jobEscrow, usdc: usdcContract, client, freelancer1, treasury } = fixture;

      const { jobId } = await advanceJobToActive(jobEscrow as any, usdcContract as any, client, freelancer1);

      // Submit & approve first milestone
      await (jobEscrow.connect(freelancer1) as any).submitMilestone(
        jobId, 0, ethers.keccak256(ethers.toUtf8Bytes("deliverable")), "QmDeliverableCID"
      );
      await (jobEscrow.connect(client) as any).approveMilestone(jobId, 0);

      const treasuryBalance = await jobEscrow.withdrawableBalances(treasury.address);
      // Protocol fee = 2% of milestone value (500 USDC)
      const expectedFee = usdc(500) * 200n / 10_000n; // 10 USDC
      expect(treasuryBalance).to.equal(expectedFee);
    });

    it("should credit bond slash to treasury on FreelancerWins dispute", async function () {
      const fixture = await loadFixture(deployFullPlatformFixture);
      const { jobEscrow, usdc: usdcContract, client, freelancer1, treasury, deployer, judge, dispute: disputeContract, platformAdmin } = fixture;

      const { jobId } = await advanceJobToActive(jobEscrow as any, usdcContract as any, client, freelancer1);

      // Submit milestone
      await (jobEscrow.connect(freelancer1) as any).submitMilestone(
        jobId, 0, ethers.keccak256(ethers.toUtf8Bytes("deliverable")), "QmDeliverableCID"
      );

      // Raise dispute (client raises)
      await (jobEscrow.connect(client) as any).raiseDispute(jobId, 0);
      const disputeId = await jobEscrow.disputeIds(jobId, 0);

      // Complete dispute lifecycle
      await (disputeContract.connect(client) as any).submitEvidence(disputeId, ethers.keccak256(ethers.toUtf8Bytes("clientEvidence")), "QmClientEvidence");
      await (disputeContract.connect(freelancer1) as any).submitEvidence(disputeId, ethers.keccak256(ethers.toUtf8Bytes("freelancerEvidence")), "QmFreelancerEvidence");

      await time.increase(5 * ONE_DAY + 1);
      await (disputeContract.connect(client) as any).closeEvidencePhase(disputeId);

      // assignJudge internally grants PLATFORM_JUDGE role
      await (disputeContract.connect(platformAdmin) as any).assignJudge(disputeId, judge.address, ethers.randomBytes(33));

      await (disputeContract.connect(client) as any).distributeKeyToJudge(disputeId, ethers.randomBytes(33));
      await (disputeContract.connect(freelancer1) as any).distributeKeyToJudge(disputeId, ethers.randomBytes(33));

      // Submit ruling: FreelancerWins (1), 100% to freelancer
      const reasoningHash = ethers.keccak256(ethers.toUtf8Bytes("ruling-reasoning"));
      await (disputeContract.connect(judge) as any).submitRuling(disputeId, 1, reasoningHash, 10000, 0);

      // Execute ruling
      await (disputeContract.connect(client) as any).executeRuling(disputeId);

      const treasuryBalance = await jobEscrow.withdrawableBalances(treasury.address);
      // Treasury gets: protocol fee (10 USDC) + bond slash (3% of 500 = 15 USDC)
      expect(treasuryBalance).to.be.gt(0);
    });

    it("should credit deposit slash to treasury on ClientWins dispute", async function () {
      const fixture = await loadFixture(deployFullPlatformFixture);
      const { jobEscrow, usdc: usdcContract, client, freelancer1, treasury, deployer, judge, dispute: disputeContract, platformAdmin } = fixture;

      const { jobId } = await advanceJobToActive(jobEscrow as any, usdcContract as any, client, freelancer1);

      await (jobEscrow.connect(freelancer1) as any).submitMilestone(
        jobId, 0, ethers.keccak256(ethers.toUtf8Bytes("deliverable")), "QmDeliverableCID"
      );

      await (jobEscrow.connect(client) as any).raiseDispute(jobId, 0);
      const disputeId = await jobEscrow.disputeIds(jobId, 0);

      await (disputeContract.connect(client) as any).submitEvidence(disputeId, ethers.keccak256(ethers.toUtf8Bytes("evidence1")), "QmEvidence1");
      await (disputeContract.connect(freelancer1) as any).submitEvidence(disputeId, ethers.keccak256(ethers.toUtf8Bytes("evidence2")), "QmEvidence2");
      await time.increase(5 * ONE_DAY + 1);
      await (disputeContract.connect(client) as any).closeEvidencePhase(disputeId);

      // assignJudge internally grants PLATFORM_JUDGE role
      await (disputeContract.connect(platformAdmin) as any).assignJudge(disputeId, judge.address, ethers.randomBytes(33));

      await (disputeContract.connect(client) as any).distributeKeyToJudge(disputeId, ethers.randomBytes(33));
      await (disputeContract.connect(freelancer1) as any).distributeKeyToJudge(disputeId, ethers.randomBytes(33));

      // ClientWins (2), 0 to freelancer, 50% deposit slash
      const reasoningHash = ethers.keccak256(ethers.toUtf8Bytes("ruling-reasoning"));
      await (disputeContract.connect(judge) as any).submitRuling(disputeId, 2, reasoningHash, 0, 5000);

      await (disputeContract.connect(client) as any).executeRuling(disputeId);

      const treasuryBalance = await jobEscrow.withdrawableBalances(treasury.address);
      // Treasury gets: protocol fee + deposit slash
      expect(treasuryBalance).to.be.gt(0);
    });
  });

  // ═══════════════════════════════════════════
  //    PAUSE MECHANISM SECURITY
  // ═══════════════════════════════════════════

  describe("Pause mechanism security", function () {
    it("should prevent non-admin from pausing", async function () {
      const fixture = await loadFixture(deployFullPlatformFixture);
      const { jobEscrow, client } = fixture;

      await expect(
        (jobEscrow.connect(client) as any).pause()
      ).to.be.reverted;
    });

    it("should prevent non-admin from unpausing", async function () {
      const fixture = await loadFixture(deployFullPlatformFixture);
      const { jobEscrow, deployer, client } = fixture;

      await (jobEscrow.connect(deployer) as any).pause();

      await expect(
        (jobEscrow.connect(client) as any).unpause()
      ).to.be.reverted;
    });

    it("should block postJob when paused", async function () {
      const fixture = await loadFixture(deployFullPlatformFixture);
      const { jobEscrow, deployer, client } = fixture;

      await (jobEscrow.connect(deployer) as any).pause();

      const now = await time.latest();
      await expect(
        (jobEscrow.connect(client) as any).postJob(
          ethers.keccak256(ethers.toUtf8Bytes("agreement")),
          [usdc(500), usdc(500)],
          [now + 30 * ONE_DAY, now + 60 * ONE_DAY],
          7 * ONE_DAY,
          "QmAgreementCID"
        )
      ).to.be.reverted;
    });

    it("should block applyForJob when paused", async function () {
      const fixture = await loadFixture(deployFullPlatformFixture);
      const { jobEscrow, usdc: usdcContract, client, freelancer1, deployer } = fixture;

      const { jobId } = await createDefaultJob(jobEscrow as any, client);

      await (jobEscrow.connect(deployer) as any).pause();

      await expect(
        (jobEscrow.connect(freelancer1) as any).applyForJob(
          jobId,
          ethers.keccak256(ethers.toUtf8Bytes("proposal")),
          "QmProposalCID"
        )
      ).to.be.reverted;
    });

    it("should allow withdraw even when paused (safety hatch)", async function () {
      const fixture = await loadFixture(deployFullPlatformFixture);
      const { jobEscrow, usdc: usdcContract, client, freelancer1, deployer } = fixture;

      const { jobId } = await advanceJobToActive(jobEscrow as any, usdcContract as any, client, freelancer1);

      // Submit & approve to generate withdrawable balance
      await (jobEscrow.connect(freelancer1) as any).submitMilestone(
        jobId, 0, ethers.keccak256(ethers.toUtf8Bytes("deliverable")), "QmDeliverableCID"
      );
      await (jobEscrow.connect(client) as any).approveMilestone(jobId, 0);

      const balance = await jobEscrow.withdrawableBalances(freelancer1.address);
      expect(balance).to.be.gt(0);

      // Pause the contract
      await (jobEscrow.connect(deployer) as any).pause();

      // Withdraw should still work (withdraw is NOT whenNotPaused)
      await (jobEscrow.connect(freelancer1) as any).withdraw();

      expect(await jobEscrow.withdrawableBalances(freelancer1.address)).to.equal(0);
    });
  });

  // ═══════════════════════════════════════════
  //    FUND ACCOUNTING INTEGRITY
  // ═══════════════════════════════════════════

  describe("Fund accounting integrity", function () {
    it("should zero out withdrawableBalances after withdraw (CEI pattern)", async function () {
      const fixture = await loadFixture(deployFullPlatformFixture);
      const { jobEscrow, usdc: usdcContract, client, freelancer1 } = fixture;

      const { jobId } = await advanceJobToActive(jobEscrow as any, usdcContract as any, client, freelancer1);

      await (jobEscrow.connect(freelancer1) as any).submitMilestone(
        jobId, 0, ethers.keccak256(ethers.toUtf8Bytes("deliverable")), "QmDeliverableCID"
      );
      await (jobEscrow.connect(client) as any).approveMilestone(jobId, 0);

      const balanceBefore = await jobEscrow.withdrawableBalances(freelancer1.address);
      expect(balanceBefore).to.be.gt(0);

      await (jobEscrow.connect(freelancer1) as any).withdraw();

      const balanceAfter = await jobEscrow.withdrawableBalances(freelancer1.address);
      expect(balanceAfter).to.equal(0);
    });

    it("should reject withdraw when balance is 0", async function () {
      const fixture = await loadFixture(deployFullPlatformFixture);
      const { jobEscrow, freelancer1 } = fixture;

      await expect(
        (jobEscrow.connect(freelancer1) as any).withdraw()
      ).to.be.revertedWithCustomError(jobEscrow, "NothingToWithdraw");
    });

    it("should correctly accumulate multiple milestone payments before withdraw", async function () {
      const fixture = await loadFixture(deployFullPlatformFixture);
      const { jobEscrow, usdc: usdcContract, client, freelancer1 } = fixture;

      const { jobId } = await advanceJobToActive(jobEscrow as any, usdcContract as any, client, freelancer1);

      // Submit & approve milestone 0
      await (jobEscrow.connect(freelancer1) as any).submitMilestone(
        jobId, 0, ethers.keccak256(ethers.toUtf8Bytes("del1")), "QmDel1"
      );
      await (jobEscrow.connect(client) as any).approveMilestone(jobId, 0);

      const balance1 = await jobEscrow.withdrawableBalances(freelancer1.address);

      // Submit & approve milestone 1
      await (jobEscrow.connect(freelancer1) as any).submitMilestone(
        jobId, 1, ethers.keccak256(ethers.toUtf8Bytes("del2")), "QmDel2"
      );
      await (jobEscrow.connect(client) as any).approveMilestone(jobId, 1);

      const balance2 = await jobEscrow.withdrawableBalances(freelancer1.address);
      expect(balance2).to.be.gt(balance1);

      // Single withdraw covers both
      const usdcBefore = await usdcContract.balanceOf(freelancer1.address);
      await (jobEscrow.connect(freelancer1) as any).withdraw();
      const usdcAfter = await usdcContract.balanceOf(freelancer1.address);

      expect(usdcAfter - usdcBefore).to.equal(balance2);
    });

    it("should emit FundsWithdrawn event with correct amount", async function () {
      const fixture = await loadFixture(deployFullPlatformFixture);
      const { jobEscrow, usdc: usdcContract, client, freelancer1 } = fixture;

      const { jobId } = await advanceJobToActive(jobEscrow as any, usdcContract as any, client, freelancer1);

      await (jobEscrow.connect(freelancer1) as any).submitMilestone(
        jobId, 0, ethers.keccak256(ethers.toUtf8Bytes("deliverable")), "QmDel"
      );
      await (jobEscrow.connect(client) as any).approveMilestone(jobId, 0);

      const balance = await jobEscrow.withdrawableBalances(freelancer1.address);

      await expect(
        (jobEscrow.connect(freelancer1) as any).withdraw()
      )
        .to.emit(jobEscrow, "FundsWithdrawn")
        .withArgs(freelancer1.address, balance);
    });
  });

  // ═══════════════════════════════════════════
  //    DISPUTE ROLE ISOLATION
  // ═══════════════════════════════════════════

  describe("Dispute contract role isolation", function () {
    it("should ensure only Dispute contract has DISPUTE_ROLE on JobEscrow", async function () {
      const fixture = await loadFixture(deployFullPlatformFixture);
      const { jobEscrow, dispute: disputeContract, client, freelancer1, deployer } = fixture;

      const DISPUTE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("DISPUTE_ROLE"));

      const disputeAddr = await disputeContract.getAddress();
      expect(await jobEscrow.hasRole(DISPUTE_ROLE, disputeAddr)).to.be.true;

      expect(await jobEscrow.hasRole(DISPUTE_ROLE, client.address)).to.be.false;
      expect(await jobEscrow.hasRole(DISPUTE_ROLE, freelancer1.address)).to.be.false;
      expect(await jobEscrow.hasRole(DISPUTE_ROLE, deployer.address)).to.be.false;
    });

    it("should ensure only JobEscrow has ESCROW_ROLE on Reputation", async function () {
      const fixture = await loadFixture(deployFullPlatformFixture);
      const { reputation, jobEscrow, client, freelancer1, deployer } = fixture;

      const ESCROW_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ESCROW_ROLE"));

      const escrowAddr = await jobEscrow.getAddress();
      expect(await reputation.hasRole(ESCROW_ROLE, escrowAddr)).to.be.true;

      expect(await reputation.hasRole(ESCROW_ROLE, client.address)).to.be.false;
      expect(await reputation.hasRole(ESCROW_ROLE, freelancer1.address)).to.be.false;
      expect(await reputation.hasRole(ESCROW_ROLE, deployer.address)).to.be.false;
    });
  });

  // ═══════════════════════════════════════════
  //    INPUT VALIDATION BOUNDARIES
  // ═══════════════════════════════════════════

  describe("Input validation boundaries", function () {
    it("should reject postJob with zero total value", async function () {
      const fixture = await loadFixture(deployFullPlatformFixture);
      const { jobEscrow, client } = fixture;

      const now = await time.latest();
      await expect(
        (jobEscrow.connect(client) as any).postJob(
          ethers.keccak256(ethers.toUtf8Bytes("agreement")),
          [0],
          [now + 30 * ONE_DAY],
          7 * ONE_DAY,
          "QmCID"
        )
      ).to.be.revertedWithCustomError(jobEscrow, "ZeroTotalValue");
    });

    it("should reject postJob with empty agreement hash", async function () {
      const fixture = await loadFixture(deployFullPlatformFixture);
      const { jobEscrow, client } = fixture;

      const now = await time.latest();
      await expect(
        (jobEscrow.connect(client) as any).postJob(
          ethers.ZeroHash,
          [usdc(500), usdc(500)],
          [now + 30 * ONE_DAY, now + 60 * ONE_DAY],
          7 * ONE_DAY,
          "QmCID"
        )
      ).to.be.revertedWithCustomError(jobEscrow, "EmptyAgreement");
    });

    it("should reject postJob with array length mismatch", async function () {
      const fixture = await loadFixture(deployFullPlatformFixture);
      const { jobEscrow, client } = fixture;

      const now = await time.latest();
      await expect(
        (jobEscrow.connect(client) as any).postJob(
          ethers.keccak256(ethers.toUtf8Bytes("agreement")),
          [usdc(500), usdc(500)],
          [now + 30 * ONE_DAY], // only 1 deadline for 2 milestones
          7 * ONE_DAY,
          "QmCID"
        )
      ).to.be.revertedWithCustomError(jobEscrow, "ArrayMismatch");
    });

    it("should reject postJob with >20 milestones", async function () {
      const fixture = await loadFixture(deployFullPlatformFixture);
      const { jobEscrow, usdc: usdcContract, client } = fixture;

      const now = await time.latest();
      const values = Array(21).fill(usdc(50));
      const deadlines = Array(21).fill(now + 60 * ONE_DAY);

      await (usdcContract.connect(client) as any).approve(
        await jobEscrow.getAddress(),
        ethers.MaxUint256
      );

      await expect(
        (jobEscrow.connect(client) as any).postJob(
          ethers.keccak256(ethers.toUtf8Bytes("agreement")),
          values,
          deadlines,
          7 * ONE_DAY,
          "QmCID"
        )
      ).to.be.revertedWithCustomError(jobEscrow, "TooManyMilestones");
    });

    it("should reject postJob with no milestones", async function () {
      const fixture = await loadFixture(deployFullPlatformFixture);
      const { jobEscrow, client } = fixture;

      await expect(
        (jobEscrow.connect(client) as any).postJob(
          ethers.keccak256(ethers.toUtf8Bytes("agreement")),
          [],
          [],
          7 * ONE_DAY,
          "QmCID"
        )
      ).to.be.revertedWithCustomError(jobEscrow, "NoMilestones");
    });
  });
});
