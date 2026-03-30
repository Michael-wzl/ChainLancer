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

describe("JobEscrow", function () {
  // ═══════════════════════════════════════════════════════════
  //                       postJob()
  // ═══════════════════════════════════════════════════════════
  describe("postJob()", function () {
    it("should create a job with correct parameters", async function () {
      const { jobEscrow, client } = await loadFixture(deployFullPlatformFixture);
      const { jobId, totalValue, agreementHash } = await createDefaultJob(jobEscrow, client);

      const jobInfo = await jobEscrow.getJobInfo(jobId);
      expect(jobInfo.client).to.equal(client.address);
      expect(jobInfo.totalValue).to.equal(usdc(1000));
      expect(jobInfo.state).to.equal(0); // Open
      expect(jobInfo.reviewTimeout).to.equal(SEVEN_DAYS);
    });

    it("should lock totalValue + behaviorBond from client", async function () {
      const { jobEscrow, usdc: usdcContract, client } = await loadFixture(deployFullPlatformFixture);
      const balanceBefore = await usdcContract.balanceOf(client.address);

      await createDefaultJob(jobEscrow, client);

      const balanceAfter = await usdcContract.balanceOf(client.address);
      // New client → 7.5% behavior bond → 1000 + 75 = 1075 USDC
      expect(balanceBefore - balanceAfter).to.equal(usdc(1075));
    });

    it("should create the correct number of milestones", async function () {
      const { jobEscrow, client } = await loadFixture(deployFullPlatformFixture);
      const { jobId } = await createDefaultJob(jobEscrow, client);

      const milestones = await jobEscrow.getMilestones(jobId);
      expect(milestones.length).to.equal(2);
      expect(milestones[0].value).to.equal(usdc(500));
      expect(milestones[1].value).to.equal(usdc(500));
    });

    it("should reject invalid review timeout", async function () {
      const { jobEscrow, client } = await loadFixture(deployFullPlatformFixture);
      const now = (await ethers.provider.getBlock("latest"))!.timestamp;

      await expect(
        jobEscrow.connect(client).postJob(
          ethers.keccak256(ethers.toUtf8Bytes("agreement")),
          [usdc(1000)],
          [now + 30 * ONE_DAY],
          5 * ONE_DAY, // 5 days is NOT in allowed set
          "QmCID"
        )
      ).to.be.revertedWith("Invalid review timeout");
    });

    it("should reject milestone below 10% minimum", async function () {
      const { jobEscrow, client } = await loadFixture(deployFullPlatformFixture);
      const now = (await ethers.provider.getBlock("latest"))!.timestamp;

      await expect(
        jobEscrow.connect(client).postJob(
          ethers.keccak256(ethers.toUtf8Bytes("agreement")),
          [usdc(50), usdc(950)], // 5% and 95% → first one < 10%
          [now + 30 * ONE_DAY, now + 60 * ONE_DAY],
          SEVEN_DAYS,
          "QmCID"
        )
      ).to.be.revertedWith("Milestone below minimum");
    });

    it("should reject empty milestones array", async function () {
      const { jobEscrow, client } = await loadFixture(deployFullPlatformFixture);

      await expect(
        jobEscrow.connect(client).postJob(
          ethers.keccak256(ethers.toUtf8Bytes("agreement")),
          [],
          [],
          SEVEN_DAYS,
          "QmCID"
        )
      ).to.be.revertedWith("No milestones");
    });

    it("should emit JobPosted event", async function () {
      const { jobEscrow, client } = await loadFixture(deployFullPlatformFixture);
      const now = (await ethers.provider.getBlock("latest"))!.timestamp;
      const agreementHash = ethers.keccak256(ethers.toUtf8Bytes("test-agreement-salt-plaintext"));

      await expect(
        jobEscrow.connect(client).postJob(
          agreementHash,
          [usdc(500), usdc(500)],
          [now + 30 * ONE_DAY, now + 60 * ONE_DAY],
          SEVEN_DAYS,
          "QmTestCID"
        )
      ).to.emit(jobEscrow, "JobPosted");
    });
  });

  // ═══════════════════════════════════════════════════════════
  //                     applyForJob()
  // ═══════════════════════════════════════════════════════════
  describe("applyForJob()", function () {
    it("should allow freelancer to apply", async function () {
      const { jobEscrow, client, freelancer1 } = await loadFixture(deployFullPlatformFixture);
      const { jobId } = await createDefaultJob(jobEscrow, client);

      const proposalHash = ethers.keccak256(ethers.toUtf8Bytes("proposal"));
      await expect(
        jobEscrow.connect(freelancer1).applyForJob(jobId, proposalHash)
      ).to.emit(jobEscrow, "ApplicationSubmitted");

      const apps = await jobEscrow.getApplications(jobId);
      expect(apps.length).to.equal(1);
      expect(apps[0].freelancer).to.equal(freelancer1.address);
    });

    it("should transition job state to Applications", async function () {
      const { jobEscrow, client, freelancer1 } = await loadFixture(deployFullPlatformFixture);
      const { jobId } = await createDefaultJob(jobEscrow, client);

      await jobEscrow.connect(freelancer1).applyForJob(jobId, ethers.ZeroHash);

      const info = await jobEscrow.getJobInfo(jobId);
      expect(info.state).to.equal(1); // Applications
    });

    it("should reject duplicate applications", async function () {
      const { jobEscrow, client, freelancer1 } = await loadFixture(deployFullPlatformFixture);
      const { jobId } = await createDefaultJob(jobEscrow, client);

      await jobEscrow.connect(freelancer1).applyForJob(jobId, ethers.ZeroHash);
      await expect(
        jobEscrow.connect(freelancer1).applyForJob(jobId, ethers.ZeroHash)
      ).to.be.revertedWith("Already applied");
    });

    it("should reject client from applying to own job", async function () {
      const { jobEscrow, client } = await loadFixture(deployFullPlatformFixture);
      const { jobId } = await createDefaultJob(jobEscrow, client);

      await expect(
        jobEscrow.connect(client).applyForJob(jobId, ethers.ZeroHash)
      ).to.be.revertedWith("Client cannot apply");
    });
  });

  // ═══════════════════════════════════════════════════════════
  //                   selectFreelancer()
  // ═══════════════════════════════════════════════════════════
  describe("selectFreelancer()", function () {
    it("should select a freelancer who applied", async function () {
      const { jobEscrow, client, freelancer1 } = await loadFixture(deployFullPlatformFixture);
      const { jobId } = await createDefaultJob(jobEscrow, client);

      await jobEscrow.connect(freelancer1).applyForJob(jobId, ethers.ZeroHash);

      const encKey = ethers.toUtf8Bytes("enc-key");
      await expect(
        jobEscrow.connect(client).selectFreelancer(jobId, freelancer1.address, encKey)
      ).to.emit(jobEscrow, "FreelancerSelected");

      const info = await jobEscrow.getJobInfo(jobId);
      expect(info.freelancer).to.equal(freelancer1.address);
    });

    it("should reject selecting non-applicant", async function () {
      const { jobEscrow, client, freelancer1, freelancer2 } = await loadFixture(deployFullPlatformFixture);
      const { jobId } = await createDefaultJob(jobEscrow, client);

      await jobEscrow.connect(freelancer1).applyForJob(jobId, ethers.ZeroHash);

      await expect(
        jobEscrow.connect(client).selectFreelancer(jobId, freelancer2.address, ethers.toUtf8Bytes("key"))
      ).to.be.revertedWith("Freelancer has not applied");
    });

    it("should reject selection by non-client", async function () {
      const { jobEscrow, client, freelancer1 } = await loadFixture(deployFullPlatformFixture);
      const { jobId } = await createDefaultJob(jobEscrow, client);

      await jobEscrow.connect(freelancer1).applyForJob(jobId, ethers.ZeroHash);

      await expect(
        jobEscrow.connect(freelancer1).selectFreelancer(jobId, freelancer1.address, ethers.toUtf8Bytes("key"))
      ).to.be.revertedWith("Only client");
    });
  });

  // ═══════════════════════════════════════════════════════════
  //                   confirmAndStake()
  // ═══════════════════════════════════════════════════════════
  describe("confirmAndStake()", function () {
    it("should activate job and transfer deposit", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1 } =
        await loadFixture(deployFullPlatformFixture);
      const { jobId } = await createDefaultJob(jobEscrow, client);

      await jobEscrow.connect(freelancer1).applyForJob(jobId, ethers.ZeroHash);
      await jobEscrow.connect(client).selectFreelancer(jobId, freelancer1.address, ethers.toUtf8Bytes("key"));

      const balBefore = await usdcContract.balanceOf(freelancer1.address);
      await jobEscrow.connect(freelancer1).confirmAndStake(jobId);
      const balAfter = await usdcContract.balanceOf(freelancer1.address);

      // 5% of 1000 = 50 USDC deposit
      expect(balBefore - balAfter).to.equal(usdc(50));

      const info = await jobEscrow.getJobInfo(jobId);
      expect(info.state).to.equal(2); // Active
      expect(info.freelancerDeposit).to.equal(usdc(50));
    });

    it("should reject if stake window expired (T_STAKE = 3 days)", async function () {
      const { jobEscrow, client, freelancer1 } = await loadFixture(deployFullPlatformFixture);
      const { jobId } = await createDefaultJob(jobEscrow, client);

      await jobEscrow.connect(freelancer1).applyForJob(jobId, ethers.ZeroHash);
      await jobEscrow.connect(client).selectFreelancer(jobId, freelancer1.address, ethers.toUtf8Bytes("key"));

      // Advance past T_STAKE
      await time.increase(THREE_DAYS + 1);

      await expect(
        jobEscrow.connect(freelancer1).confirmAndStake(jobId)
      ).to.be.revertedWith("Stake window expired");
    });

    it("should reject wrong freelancer", async function () {
      const { jobEscrow, client, freelancer1, freelancer2 } = await loadFixture(deployFullPlatformFixture);
      const { jobId } = await createDefaultJob(jobEscrow, client);

      await jobEscrow.connect(freelancer1).applyForJob(jobId, ethers.ZeroHash);
      await jobEscrow.connect(client).selectFreelancer(jobId, freelancer1.address, ethers.toUtf8Bytes("key"));

      await expect(
        jobEscrow.connect(freelancer2).confirmAndStake(jobId)
      ).to.be.revertedWith("Not selected freelancer");
    });
  });

  // ═══════════════════════════════════════════════════════════
  //                   submitMilestone()
  // ═══════════════════════════════════════════════════════════
  describe("submitMilestone()", function () {
    it("should submit milestone and transition to InReview", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1 } =
        await loadFixture(deployFullPlatformFixture);
      const { jobId } = await advanceJobToActive(jobEscrow, usdcContract, client, freelancer1);

      const deliverableHash = ethers.keccak256(ethers.toUtf8Bytes("deliverable"));
      await expect(
        jobEscrow.connect(freelancer1).submitMilestone(jobId, 0, deliverableHash, "QmDeliverableCID")
      ).to.emit(jobEscrow, "MilestoneSubmitted");

      const msInfo = await jobEscrow.getMilestoneInfo(jobId, 0);
      expect(msInfo.status).to.equal(1); // InReview
    });

    it("should reject non-freelancer submission", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1 } =
        await loadFixture(deployFullPlatformFixture);
      const { jobId } = await advanceJobToActive(jobEscrow, usdcContract, client, freelancer1);

      await expect(
        jobEscrow.connect(client).submitMilestone(jobId, 0, ethers.ZeroHash, "QmCID")
      ).to.be.revertedWith("Only freelancer");
    });

    it("should reject submission past deadline", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1 } =
        await loadFixture(deployFullPlatformFixture);
      const { jobId } = await advanceJobToActive(jobEscrow, usdcContract, client, freelancer1);

      // Advance past first milestone deadline (30 days)
      await time.increase(31 * ONE_DAY);

      await expect(
        jobEscrow.connect(freelancer1).submitMilestone(jobId, 0, ethers.ZeroHash, "QmCID")
      ).to.be.revertedWith("Milestone deadline passed");
    });
  });

  // ═══════════════════════════════════════════════════════════
  //                  approveMilestone()
  // ═══════════════════════════════════════════════════════════
  describe("approveMilestone()", function () {
    it("should approve milestone and credit freelancer balance", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1, treasury } =
        await loadFixture(deployFullPlatformFixture);
      const { jobId } = await advanceJobToActive(jobEscrow, usdcContract, client, freelancer1);

      // Submit milestone
      await jobEscrow.connect(freelancer1).submitMilestone(
        jobId, 0, ethers.keccak256(ethers.toUtf8Bytes("work")), "QmWorkCID"
      );

      // Approve
      await jobEscrow.connect(client).approveMilestone(jobId, 0);

      // 500 USDC milestone, 2% fee = 10 USDC, freelancer gets 490
      const freelancerBal = await jobEscrow.withdrawableBalances(freelancer1.address);
      expect(freelancerBal).to.equal(usdc(490));

      const treasuryBal = await jobEscrow.withdrawableBalances(treasury.address);
      expect(treasuryBal).to.equal(usdc(10));
    });

    it("should only allow client to approve", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1 } =
        await loadFixture(deployFullPlatformFixture);
      const { jobId } = await advanceJobToActive(jobEscrow, usdcContract, client, freelancer1);

      await jobEscrow.connect(freelancer1).submitMilestone(
        jobId, 0, ethers.ZeroHash, "QmCID"
      );

      await expect(
        jobEscrow.connect(freelancer1).approveMilestone(jobId, 0)
      ).to.be.revertedWith("Only client");
    });

    it("should reject approval of non-InReview milestone", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1 } =
        await loadFixture(deployFullPlatformFixture);
      const { jobId } = await advanceJobToActive(jobEscrow, usdcContract, client, freelancer1);

      await expect(
        jobEscrow.connect(client).approveMilestone(jobId, 0)
      ).to.be.revertedWith("Not in review");
    });
  });

  // ═══════════════════════════════════════════════════════════
  //                 triggerAutoApprove()
  // ═══════════════════════════════════════════════════════════
  describe("triggerAutoApprove()", function () {
    it("should auto-approve after review timeout", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1 } =
        await loadFixture(deployFullPlatformFixture);
      const { jobId } = await advanceJobToActive(jobEscrow, usdcContract, client, freelancer1);

      await jobEscrow.connect(freelancer1).submitMilestone(
        jobId, 0, ethers.ZeroHash, "QmCID"
      );

      // Advance past review timeout (7 days + 1 second for strict >)
      await time.increase(SEVEN_DAYS + 1);

      await expect(
        jobEscrow.connect(freelancer1).triggerAutoApprove(jobId, 0)
      ).to.emit(jobEscrow, "MilestoneAutoApproved");

      const msInfo = await jobEscrow.getMilestoneInfo(jobId, 0);
      expect(msInfo.status).to.equal(3); // AutoApproved
    });

    it("should reject auto-approve before timeout (strict >)", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1 } =
        await loadFixture(deployFullPlatformFixture);
      const { jobId } = await advanceJobToActive(jobEscrow, usdcContract, client, freelancer1);

      await jobEscrow.connect(freelancer1).submitMilestone(
        jobId, 0, ethers.ZeroHash, "QmCID"
      );

      // Get the submitted timestamp
      const msInfo = await jobEscrow.getMilestoneInfo(jobId, 0);
      const submittedAt = msInfo.submittedAt;
      const reviewTimeout = SEVEN_DAYS;

      // Set time to exactly submittedAt + reviewTimeout - 1 so next block.timestamp == submittedAt + reviewTimeout
      // This makes block.timestamp == submittedAt + reviewTimeout (not >), so it should revert
      await time.increaseTo(Number(submittedAt) + reviewTimeout - 1);

      await expect(
        jobEscrow.triggerAutoApprove(jobId, 0)
      ).to.be.revertedWith("Review timeout not expired");
    });

    it("should allow anyone to trigger auto-approve", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1, freelancer2 } =
        await loadFixture(deployFullPlatformFixture);
      const { jobId } = await advanceJobToActive(jobEscrow, usdcContract, client, freelancer1);

      await jobEscrow.connect(freelancer1).submitMilestone(
        jobId, 0, ethers.ZeroHash, "QmCID"
      );

      await time.increase(SEVEN_DAYS + 1);

      // Even a random third party can trigger
      await expect(
        jobEscrow.connect(freelancer2).triggerAutoApprove(jobId, 0)
      ).to.emit(jobEscrow, "MilestoneAutoApproved");
    });
  });

  // ═══════════════════════════════════════════════════════════
  //                    raiseDispute()
  // ═══════════════════════════════════════════════════════════
  describe("raiseDispute()", function () {
    it("should create a dispute and transition milestone to Disputed", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1 } =
        await loadFixture(deployFullPlatformFixture);
      const { jobId } = await advanceJobToActive(jobEscrow, usdcContract, client, freelancer1);

      await jobEscrow.connect(freelancer1).submitMilestone(
        jobId, 0, ethers.ZeroHash, "QmCID"
      );

      await expect(
        jobEscrow.connect(client).raiseDispute(jobId, 0)
      ).to.emit(jobEscrow, "DisputeRaised");

      const msInfo = await jobEscrow.getMilestoneInfo(jobId, 0);
      expect(msInfo.status).to.equal(4); // Disputed
    });

    it("should reject dispute on non-InReview milestone", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1 } =
        await loadFixture(deployFullPlatformFixture);
      const { jobId } = await advanceJobToActive(jobEscrow, usdcContract, client, freelancer1);

      // Milestone is Pending, not InReview
      await expect(
        jobEscrow.connect(client).raiseDispute(jobId, 0)
      ).to.be.revertedWith("Not in review");
    });
  });

  // ═══════════════════════════════════════════════════════════
  //                  claimAbandonment()
  // ═══════════════════════════════════════════════════════════
  describe("claimAbandonment()", function () {
    it("should forfeit deposit to treasury and return escrow when deadline missed", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1, treasury } =
        await loadFixture(deployFullPlatformFixture);
      const { jobId } = await advanceJobToActive(jobEscrow, usdcContract, client, freelancer1);

      // Advance past first milestone deadline
      await time.increase(31 * ONE_DAY);

      await jobEscrow.connect(client).claimAbandonment(jobId, 0);

      const info = await jobEscrow.getJobInfo(jobId);
      expect(info.state).to.equal(5); // Abandoned

      // Client should get remaining escrow (1000) + bond refund (75), but deposit (50) goes to treasury
      const clientBal = await jobEscrow.withdrawableBalances(client.address);
      expect(clientBal).to.equal(usdc(1075)); // 1000 escrow + 75 bond

      // Treasury gets the forfeited deposit
      const treasuryBal = await jobEscrow.withdrawableBalances(treasury.address);
      expect(treasuryBal).to.equal(usdc(50)); // freelancer deposit
    });
  });

  // ═══════════════════════════════════════════════════════════
  //                     cancelJob()
  // ═══════════════════════════════════════════════════════════
  describe("cancelJob()", function () {
    it("should cancel job in Open state and refund fully", async function () {
      const { jobEscrow, client } = await loadFixture(deployFullPlatformFixture);
      const { jobId } = await createDefaultJob(jobEscrow, client);

      await jobEscrow.connect(client).cancelJob(jobId);

      const info = await jobEscrow.getJobInfo(jobId);
      expect(info.state).to.equal(4); // Cancelled

      // Client gets totalValue (1000) + bond (75)
      const clientBal = await jobEscrow.withdrawableBalances(client.address);
      expect(clientBal).to.equal(usdc(1075));
    });

    it("should cancel in Applications state with reputation penalty if freelancer selected", async function () {
      const { jobEscrow, client, freelancer1 } = await loadFixture(deployFullPlatformFixture);
      const { jobId } = await createDefaultJob(jobEscrow, client);

      await jobEscrow.connect(freelancer1).applyForJob(jobId, ethers.ZeroHash);
      await jobEscrow.connect(client).selectFreelancer(jobId, freelancer1.address, ethers.toUtf8Bytes("key"));

      await jobEscrow.connect(client).cancelJob(jobId);

      const info = await jobEscrow.getJobInfo(jobId);
      expect(info.state).to.equal(4); // Cancelled
    });

    it("should reject cancellation in Active state", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1 } =
        await loadFixture(deployFullPlatformFixture);
      const { jobId } = await advanceJobToActive(jobEscrow, usdcContract, client, freelancer1);

      await expect(
        jobEscrow.connect(client).cancelJob(jobId)
      ).to.be.revertedWith("Cannot cancel in current state");
    });
  });

  // ═══════════════════════════════════════════════════════════
  //            requestCancellation / acceptCancellation
  // ═══════════════════════════════════════════════════════════
  describe("Mutual Cancellation", function () {
    it("should allow mutual cancellation in Active state", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1 } =
        await loadFixture(deployFullPlatformFixture);
      const { jobId } = await advanceJobToActive(jobEscrow, usdcContract, client, freelancer1);

      await jobEscrow.connect(client).requestCancellation(jobId);
      await jobEscrow.connect(freelancer1).acceptCancellation(jobId);

      const info = await jobEscrow.getJobInfo(jobId);
      expect(info.state).to.equal(4); // Cancelled

      // Freelancer gets deposit back
      const fBal = await jobEscrow.withdrawableBalances(freelancer1.address);
      expect(fBal).to.equal(usdc(50)); // 5% deposit refund

      // Client gets remaining escrow + bond (7.5%)
      const cBal = await jobEscrow.withdrawableBalances(client.address);
      expect(cBal).to.equal(usdc(1075)); // 1000 escrow + 75 bond
    });

    it("should handle partial completion correctly", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1 } =
        await loadFixture(deployFullPlatformFixture);
      const { jobId } = await advanceJobToActive(jobEscrow, usdcContract, client, freelancer1);

      // Submit and approve first milestone
      await jobEscrow.connect(freelancer1).submitMilestone(
        jobId, 0, ethers.ZeroHash, "QmCID"
      );
      await jobEscrow.connect(client).approveMilestone(jobId, 0);

      // Now request mutual cancellation
      await jobEscrow.connect(freelancer1).requestCancellation(jobId);
      await jobEscrow.connect(client).acceptCancellation(jobId);

      // Freelancer: 490 (milestone payout) + 50 (deposit refund)
      const fBal = await jobEscrow.withdrawableBalances(freelancer1.address);
      expect(fBal).to.equal(usdc(540));

      // Client: 500 (remaining 1 milestone escrow) + 75 (bond)
      const cBal = await jobEscrow.withdrawableBalances(client.address);
      expect(cBal).to.equal(usdc(575));
    });
  });

  // ═══════════════════════════════════════════════════════════
  //                  withdrawExpiredJob()
  // ═══════════════════════════════════════════════════════════
  describe("withdrawExpiredJob()", function () {
    it("should allow withdrawal after T_ACCEPTANCE", async function () {
      const { jobEscrow, client } = await loadFixture(deployFullPlatformFixture);
      const { jobId } = await createDefaultJob(jobEscrow, client);

      await time.increase(FOURTEEN_DAYS + 1);

      await jobEscrow.connect(client).withdrawExpiredJob(jobId);

      const info = await jobEscrow.getJobInfo(jobId);
      expect(info.state).to.equal(4); // Cancelled

      const cBal = await jobEscrow.withdrawableBalances(client.address);
      expect(cBal).to.equal(usdc(1075));
    });

    it("should reject before T_ACCEPTANCE", async function () {
      const { jobEscrow, client } = await loadFixture(deployFullPlatformFixture);
      const { jobId } = await createDefaultJob(jobEscrow, client);

      await expect(
        jobEscrow.connect(client).withdrawExpiredJob(jobId)
      ).to.be.revertedWith("Not expired yet");
    });
  });

  // ═══════════════════════════════════════════════════════════
  //                      withdraw()
  // ═══════════════════════════════════════════════════════════
  describe("withdraw()", function () {
    it("should transfer withdrawable balance to user", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1 } =
        await loadFixture(deployFullPlatformFixture);
      const { jobId } = await advanceJobToActive(jobEscrow, usdcContract, client, freelancer1);

      // Submit and approve
      await jobEscrow.connect(freelancer1).submitMilestone(
        jobId, 0, ethers.ZeroHash, "QmCID"
      );
      await jobEscrow.connect(client).approveMilestone(jobId, 0);

      const balBefore = await usdcContract.balanceOf(freelancer1.address);
      await jobEscrow.connect(freelancer1).withdraw();
      const balAfter = await usdcContract.balanceOf(freelancer1.address);

      expect(balAfter - balBefore).to.equal(usdc(490));
    });

    it("should reject withdrawal with zero balance", async function () {
      const { jobEscrow, client } = await loadFixture(deployFullPlatformFixture);

      await expect(
        jobEscrow.connect(client).withdraw()
      ).to.be.revertedWith("Nothing to withdraw");
    });
  });

  // ═══════════════════════════════════════════════════════════
  //                  reselectFreelancer()
  // ═══════════════════════════════════════════════════════════
  describe("reselectFreelancer()", function () {
    it("should allow reselection after T_STAKE expires", async function () {
      const { jobEscrow, client, freelancer1, freelancer2 } = await loadFixture(deployFullPlatformFixture);
      const { jobId } = await createDefaultJob(jobEscrow, client);

      await jobEscrow.connect(freelancer1).applyForJob(jobId, ethers.ZeroHash);
      await jobEscrow.connect(freelancer2).applyForJob(jobId, ethers.ZeroHash);
      await jobEscrow.connect(client).selectFreelancer(jobId, freelancer1.address, ethers.toUtf8Bytes("key"));

      // Wait for T_STAKE to expire
      await time.increase(THREE_DAYS + 1);

      await jobEscrow.connect(client).reselectFreelancer(
        jobId, freelancer2.address, ethers.toUtf8Bytes("key2")
      );

      const info = await jobEscrow.getJobInfo(jobId);
      expect(info.freelancer).to.equal(freelancer2.address);
    });
  });

  // ═══════════════════════════════════════════════════════════
  //                    rejectOffer()
  // ═══════════════════════════════════════════════════════════
  describe("rejectOffer()", function () {
    it("should allow selected freelancer to reject offer", async function () {
      const { jobEscrow, client, freelancer1 } = await loadFixture(deployFullPlatformFixture);
      const { jobId } = await createDefaultJob(jobEscrow, client);

      await jobEscrow.connect(freelancer1).applyForJob(jobId, ethers.ZeroHash);
      await jobEscrow.connect(client).selectFreelancer(jobId, freelancer1.address, ethers.toUtf8Bytes("key"));

      await expect(
        jobEscrow.connect(freelancer1).rejectOffer(jobId)
      ).to.emit(jobEscrow, "OfferRejected").withArgs(jobId, freelancer1.address);

      const info = await jobEscrow.getJobInfo(jobId);
      expect(info.freelancer).to.equal(ethers.ZeroAddress);
      expect(info.state).to.equal(1); // Still Applications
    });

    it("should revert if caller is not the selected freelancer", async function () {
      const { jobEscrow, client, freelancer1, freelancer2 } = await loadFixture(deployFullPlatformFixture);
      const { jobId } = await createDefaultJob(jobEscrow, client);

      await jobEscrow.connect(freelancer1).applyForJob(jobId, ethers.ZeroHash);
      await jobEscrow.connect(client).selectFreelancer(jobId, freelancer1.address, ethers.toUtf8Bytes("key"));

      await expect(
        jobEscrow.connect(freelancer2).rejectOffer(jobId)
      ).to.be.revertedWith("Not selected freelancer");
    });

    it("should allow client to reselect after rejection", async function () {
      const { jobEscrow, client, freelancer1, freelancer2 } = await loadFixture(deployFullPlatformFixture);
      const { jobId } = await createDefaultJob(jobEscrow, client);

      await jobEscrow.connect(freelancer1).applyForJob(jobId, ethers.ZeroHash);
      await jobEscrow.connect(freelancer2).applyForJob(jobId, ethers.ZeroHash);
      await jobEscrow.connect(client).selectFreelancer(jobId, freelancer1.address, ethers.toUtf8Bytes("key"));

      // Freelancer rejects
      await jobEscrow.connect(freelancer1).rejectOffer(jobId);

      // Client selects another freelancer immediately (no need to wait for T_STAKE)
      await jobEscrow.connect(client).selectFreelancer(jobId, freelancer2.address, ethers.toUtf8Bytes("key2"));

      const info = await jobEscrow.getJobInfo(jobId);
      expect(info.freelancer).to.equal(freelancer2.address);
    });

    it("should revert if freelancer already confirmed and staked (Active state)", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1 } =
        await loadFixture(deployFullPlatformFixture);
      const { jobId } = await advanceJobToActive(jobEscrow, usdcContract, client, freelancer1);

      await expect(
        jobEscrow.connect(freelancer1).rejectOffer(jobId)
      ).to.be.revertedWith("Not in applications");
    });
  });

  // ═══════════════════════════════════════════════════════════
  //                    expireOffer()
  // ═══════════════════════════════════════════════════════════
  describe("expireOffer()", function () {
    it("should allow anyone to expire a stale offer after T_STAKE", async function () {
      const { jobEscrow, client, freelancer1, freelancer2 } = await loadFixture(deployFullPlatformFixture);
      const { jobId } = await createDefaultJob(jobEscrow, client);

      await jobEscrow.connect(freelancer1).applyForJob(jobId, ethers.ZeroHash);
      await jobEscrow.connect(client).selectFreelancer(jobId, freelancer1.address, ethers.toUtf8Bytes("key"));

      // Wait for T_STAKE to expire
      await time.increase(THREE_DAYS + 1);

      // Anyone can trigger this
      await expect(
        jobEscrow.connect(freelancer2).expireOffer(jobId)
      ).to.emit(jobEscrow, "OfferExpired").withArgs(jobId, freelancer1.address);

      const info = await jobEscrow.getJobInfo(jobId);
      expect(info.freelancer).to.equal(ethers.ZeroAddress);
      expect(info.state).to.equal(1); // Still Applications
    });

    it("should revert before T_STAKE expires", async function () {
      const { jobEscrow, client, freelancer1 } = await loadFixture(deployFullPlatformFixture);
      const { jobId } = await createDefaultJob(jobEscrow, client);

      await jobEscrow.connect(freelancer1).applyForJob(jobId, ethers.ZeroHash);
      await jobEscrow.connect(client).selectFreelancer(jobId, freelancer1.address, ethers.toUtf8Bytes("key"));

      await expect(
        jobEscrow.connect(freelancer1).expireOffer(jobId)
      ).to.be.revertedWith("Offer not expired");
    });

    it("should revert when no freelancer is selected", async function () {
      const { jobEscrow, client, freelancer1 } = await loadFixture(deployFullPlatformFixture);
      const { jobId } = await createDefaultJob(jobEscrow, client);

      await jobEscrow.connect(freelancer1).applyForJob(jobId, ethers.ZeroHash);

      await expect(
        jobEscrow.connect(freelancer1).expireOffer(jobId)
      ).to.be.revertedWith("No pending offer");
    });
  });

  // ═══════════════════════════════════════════════════════════
  //           Graduated Behavior Bond (Change 6)
  // ═══════════════════════════════════════════════════════════
  describe("Graduated Behavior Bond", function () {
    it("should charge 7.5% bond for New tier client", async function () {
      const { jobEscrow, usdc: usdcContract, client } = await loadFixture(deployFullPlatformFixture);
      const balBefore = await usdcContract.balanceOf(client.address);

      await createDefaultJob(jobEscrow, client);

      const balAfter = await usdcContract.balanceOf(client.address);
      // 7.5% of 1000 = 75 USDC bond
      expect(balBefore - balAfter).to.equal(usdc(1075)); // 1000 + 75
    });
  });

  // ═══════════════════════════════════════════════════════════
  //         Slashing to Treasury (Change 5)
  // ═══════════════════════════════════════════════════════════
  describe("Slashing to Treasury", function () {
    it("should send forfeited deposit to treasury on abandonment", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1, treasury } =
        await loadFixture(deployFullPlatformFixture);
      const { jobId } = await advanceJobToActive(jobEscrow, usdcContract, client, freelancer1);

      await time.increase(31 * ONE_DAY);
      await jobEscrow.connect(client).claimAbandonment(jobId, 0);

      // Treasury gets the forfeited deposit
      const treasuryBal = await jobEscrow.withdrawableBalances(treasury.address);
      expect(treasuryBal).to.equal(usdc(50)); // 5% of 1000

      // Client does NOT get the deposit
      const clientBal = await jobEscrow.withdrawableBalances(client.address);
      expect(clientBal).to.equal(usdc(1075)); // only escrow (1000) + bond (75)
    });
  });

  // ═══════════════════════════════════════════════════════════
  //       Dispute Timer Pause (Change 7)
  // ═══════════════════════════════════════════════════════════
  describe("Dispute Timer Pause", function () {
    it("should record remainingReviewTime when dispute is raised", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1 } =
        await loadFixture(deployFullPlatformFixture);
      const { jobId } = await advanceJobToActive(jobEscrow, usdcContract, client, freelancer1);

      // Submit milestone
      await jobEscrow.connect(freelancer1).submitMilestone(
        jobId, 0, ethers.ZeroHash, "QmCID"
      );

      // Wait 2 days into the 7-day review period
      await time.increase(2 * ONE_DAY);

      // Raise dispute
      await jobEscrow.connect(client).raiseDispute(jobId, 0);

      // Check milestone is disputed
      const msInfo = await jobEscrow.getMilestoneInfo(jobId, 0);
      expect(msInfo.status).to.equal(4); // Disputed

      // Check remainingReviewTime is approximately 5 days (7 - 2)
      const milestones = await jobEscrow.getMilestones(jobId);
      const remaining = milestones[0].remainingReviewTime;
      // Allow ±10 seconds of tolerance for block timestamps
      expect(remaining).to.be.closeTo(BigInt(5 * ONE_DAY), 10n);
    });

    it("should reject auto-approve on disputed milestone", async function () {
      const { jobEscrow, usdc: usdcContract, client, freelancer1 } =
        await loadFixture(deployFullPlatformFixture);
      const { jobId } = await advanceJobToActive(jobEscrow, usdcContract, client, freelancer1);

      // Submit milestone
      await jobEscrow.connect(freelancer1).submitMilestone(
        jobId, 0, ethers.ZeroHash, "QmCID"
      );

      // Raise dispute
      await jobEscrow.connect(client).raiseDispute(jobId, 0);

      // Try to auto-approve past the review period
      await time.increase(SEVEN_DAYS + 1);

      await expect(
        jobEscrow.triggerAutoApprove(jobId, 0)
      ).to.be.revertedWith("Not in review");
    });
  });
});
