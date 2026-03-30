import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {
  deployFullPlatformFixture,
  advanceJobToActive,
  createDefaultJob,
  usdc,
  ONE_DAY,
  SEVEN_DAYS,
  FOURTEEN_DAYS,
} from "../helpers/fixtures";

describe("Integration: Happy Path", function () {
  it("should complete a full 2-milestone job end-to-end", async function () {
    const { jobEscrow, usdc: usdcContract, reputation, client, freelancer1, treasury } =
      await loadFixture(deployFullPlatformFixture);

    // 1. Post job & advance to Active
    const { jobId } = await advanceJobToActive(jobEscrow, usdcContract as any, client, freelancer1);

    // Get initial balances
    const clientBalBefore = await usdcContract.balanceOf(client.address);

    // 2. Submit & approve milestone 0
    await jobEscrow.connect(freelancer1).submitMilestone(
      jobId, 0, ethers.keccak256(ethers.toUtf8Bytes("m0-work")), "QmM0"
    );
    await jobEscrow.connect(client).approveMilestone(jobId, 0);

    // 3. Submit & approve milestone 1
    await jobEscrow.connect(freelancer1).submitMilestone(
      jobId, 1, ethers.keccak256(ethers.toUtf8Bytes("m1-work")), "QmM1"
    );
    await jobEscrow.connect(client).approveMilestone(jobId, 1);

    // 4. Job should be Completed
    const jobInfo = await jobEscrow.getJobInfo(jobId);
    expect(jobInfo.state).to.equal(3); // Completed

    // 5. Freelancer withdraws
    const freeBefore = await usdcContract.balanceOf(freelancer1.address);
    await jobEscrow.connect(freelancer1).withdraw();
    const freeAfter = await usdcContract.balanceOf(freelancer1.address);
    expect(freeAfter).to.be.gt(freeBefore);

    // 6. Treasury should have protocol fees (in withdrawable balances)
    await jobEscrow.connect(treasury).withdraw();
    const treasuryBal = await usdcContract.balanceOf(treasury.address);
    // 2% of 1000 USDC total = 20 USDC
    expect(treasuryBal).to.equal(usdc(20));

    // 7. Reputation should be updated
    const fProfile = await reputation.freelancerProfiles(freelancer1.address);
    expect(fProfile.totalValueCompleted).to.equal(usdc(1000));
  });

  it("should auto-approve milestone after review timeout", async function () {
    const { jobEscrow, usdc: usdcContract, client, freelancer1 } =
      await loadFixture(deployFullPlatformFixture);

    const { jobId } = await advanceJobToActive(jobEscrow, usdcContract as any, client, freelancer1);

    // Submit milestone
    await jobEscrow.connect(freelancer1).submitMilestone(
      jobId, 0, ethers.keccak256(ethers.toUtf8Bytes("work")), "QmWork"
    );

    // Advance past review timeout (7 days)
    await time.increase(SEVEN_DAYS + 1);

    // Trigger auto-approve
    await jobEscrow.connect(freelancer1).triggerAutoApprove(jobId, 0);

    const msInfo = await jobEscrow.getMilestoneInfo(jobId, 0);
    expect(msInfo.status).to.equal(3); // AutoApproved
  });
});

describe("Integration: Dispute Path", function () {
  async function createDisputeScenario() {
    const fixture = await loadFixture(deployFullPlatformFixture);
    const { jobEscrow, usdc: usdcContract, dispute, client, freelancer1, platformAdmin, judge } = fixture;

    const { jobId } = await advanceJobToActive(jobEscrow, usdcContract as any, client, freelancer1);

    // Submit milestone
    await jobEscrow.connect(freelancer1).submitMilestone(
      jobId, 0, ethers.keccak256(ethers.toUtf8Bytes("work")), "QmWork"
    );

    // Client raises dispute
    await usdcContract.connect(client).approve(await jobEscrow.getAddress(), ethers.MaxUint256);
    await jobEscrow.connect(client).raiseDispute(jobId, 0);

    const disputeId = await jobEscrow.disputeIds(jobId);

    return { ...fixture, jobId, disputeId };
  }

  async function advanceToRulingPhase(fixture: any) {
    const { dispute, platformAdmin, judge, client, freelancer1, disputeId } = fixture;

    // Evidence phase
    await time.increase(5 * ONE_DAY + 1);
    await dispute.closeEvidencePhase(disputeId);

    // Assign judge
    await dispute.connect(platformAdmin).assignJudge(
      disputeId, judge.address, ethers.toUtf8Bytes("eph-key")
    );

    // Key distribution
    await dispute.connect(client).distributeKeyToJudge(disputeId, ethers.toUtf8Bytes("k1"));
    await dispute.connect(freelancer1).distributeKeyToJudge(disputeId, ethers.toUtf8Bytes("k2"));

    return fixture;
  }

  it("should handle FreelancerWins ruling correctly", async function () {
    let fixture = await createDisputeScenario();
    fixture = await advanceToRulingPhase(fixture);
    const { dispute, judge, jobEscrow, freelancer1, treasury, disputeId, jobId } = fixture;

    // Judge rules: FreelancerWins, 100% to freelancer
    const reasonHash = ethers.keccak256(ethers.toUtf8Bytes("reasoning"));
    await dispute.connect(judge).submitRuling(disputeId, 1, reasonHash, 10000, 0);
    await dispute.executeRuling(disputeId);

    // Milestone should be Resolved
    const msInfo = await jobEscrow.getMilestoneInfo(jobId, 0);
    expect(msInfo.status).to.equal(5); // Resolved

    // Freelancer can withdraw (gets milestone payout, NOT bond slash)
    const balBefore = await fixture.usdc.balanceOf(freelancer1.address);
    await jobEscrow.connect(freelancer1).withdraw();
    const balAfter = await fixture.usdc.balanceOf(freelancer1.address);
    expect(balAfter).to.be.gt(balBefore);

    // Bond slash goes to treasury, not freelancer
    const treasuryBal = await jobEscrow.withdrawableBalances(treasury.address);
    // Treasury should have protocol fee (10 USDC = 2% of 500) + bond slash (up to 15 = 3% of 500)
    expect(treasuryBal).to.be.gt(0n);
  });

  it("should handle ClientWins ruling correctly", async function () {
    let fixture = await createDisputeScenario();
    fixture = await advanceToRulingPhase(fixture);
    const { dispute, judge, jobEscrow, client, disputeId, jobId } = fixture;

    // Judge rules: ClientWins, 0% to freelancer
    const reasonHash = ethers.keccak256(ethers.toUtf8Bytes("reasoning"));
    await dispute.connect(judge).submitRuling(disputeId, 2, reasonHash, 0, 0);
    await dispute.executeRuling(disputeId);

    // Client can withdraw refund
    const balBefore = await fixture.usdc.balanceOf(client.address);
    await jobEscrow.connect(client).withdraw();
    const balAfter = await fixture.usdc.balanceOf(client.address);
    expect(balAfter).to.be.gt(balBefore);
  });

  it("should handle Inconclusive ruling (split 50/50)", async function () {
    let fixture = await createDisputeScenario();
    fixture = await advanceToRulingPhase(fixture);
    const { dispute, judge, jobEscrow, disputeId } = fixture;

    // Judge rules: Inconclusive, 50/50 split
    const reasonHash = ethers.keccak256(ethers.toUtf8Bytes("reasoning"));
    await dispute.connect(judge).submitRuling(disputeId, 0, reasonHash, 5000, 0);
    await dispute.executeRuling(disputeId);

    // Both can withdraw
    await jobEscrow.connect(fixture.client).withdraw();
    await jobEscrow.connect(fixture.freelancer1).withdraw();
  });
});

describe("Integration: Cancellation", function () {
  it("should allow client to cancel before freelancer selected", async function () {
    const { jobEscrow, usdc: usdcContract, client } = await loadFixture(deployFullPlatformFixture);

    const { jobId } = await createDefaultJob(jobEscrow as any, client);

    const balBefore = await usdcContract.balanceOf(client.address);
    await jobEscrow.connect(client).cancelJob(jobId);
    const balAfter = await usdcContract.balanceOf(client.address);

    // Client should be refunded via withdrawableBalances (pull pattern)
    const withdrawable = await jobEscrow.withdrawableBalances(client.address);
    expect(withdrawable).to.be.gt(0);

    const jobInfo = await jobEscrow.getJobInfo(jobId);
    expect(jobInfo.state).to.equal(4); // Cancelled
  });

  it("should handle mutual cancellation", async function () {
    const { jobEscrow, usdc: usdcContract, client, freelancer1 } =
      await loadFixture(deployFullPlatformFixture);

    const { jobId } = await advanceJobToActive(jobEscrow, usdcContract as any, client, freelancer1);

    // Client requests cancellation
    await jobEscrow.connect(client).requestCancellation(jobId);
    // Freelancer accepts
    await jobEscrow.connect(freelancer1).acceptCancellation(jobId);

    const jobInfo = await jobEscrow.getJobInfo(jobId);
    expect(jobInfo.state).to.equal(4); // Cancelled
  });
});

describe("Integration: Timeouts", function () {
  it("should allow claimAbandonment after T_ACCEPTANCE expires", async function () {
    const { jobEscrow, usdc: usdcContract, client, freelancer1 } =
      await loadFixture(deployFullPlatformFixture);

    const { jobId } = await createDefaultJob(jobEscrow as any, client);

    // Apply and select freelancer
    const proposalHash = ethers.keccak256(ethers.toUtf8Bytes("proposal"));
    await jobEscrow.connect(freelancer1).applyForJob(jobId, proposalHash);
    const encKey = ethers.toUtf8Bytes("enc-key");
    await jobEscrow.connect(client).selectFreelancer(jobId, freelancer1.address, encKey);

    // Freelancer stakes
    await jobEscrow.connect(freelancer1).confirmAndStake(jobId);

    // Wait past first milestone deadline (30 days from creation)
    await time.increase(31 * ONE_DAY);

    // Claim abandonment on milestone 0
    await jobEscrow.connect(client).claimAbandonment(jobId, 0);

    const jobInfo = await jobEscrow.getJobInfo(jobId);
    expect(jobInfo.state).to.equal(5); // Abandoned
  });

  it("should allow withdrawExpiredJob after deadline", async function () {
    const { jobEscrow, usdc: usdcContract, client } =
      await loadFixture(deployFullPlatformFixture);

    const { jobId } = await createDefaultJob(jobEscrow as any, client);

    // Fast forward past T_ACCEPTANCE (14 days)
    await time.increase(FOURTEEN_DAYS + 1);

    // Withdraw expired job
    await jobEscrow.connect(client).withdrawExpiredJob(jobId);

    const jobInfo = await jobEscrow.getJobInfo(jobId);
    expect(jobInfo.state).to.equal(4); // Cancelled
  });
});
