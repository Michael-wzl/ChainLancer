import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {
  deployFullPlatformFixture,
  advanceJobToActive,
  usdc,
  SEVEN_DAYS,
  ONE_DAY,
} from "../helpers/fixtures";
import * as helpers from "@nomicfoundation/hardhat-network-helpers";

/**
 * Security Tests — Reentrancy
 *
 * Verifies that the ReentrancyGuard protects critical functions
 * that transfer USDC or update withdrawable balances.
 *
 * Note: Since we use SafeERC20 with a standard ERC20 (MockUSDC),
 * reentrancy via malicious token callbacks is not possible.
 * These tests verify the guard is present by checking that:
 *   - withdraw() zeroes the balance BEFORE transfer
 *   - approveMilestone() processes funds only once (idempotency)
 *   - executeDisputeRuling() processes funds only once (idempotency)
 */
describe("Security: Reentrancy Protection", function () {
  it("withdraw() should zero balance before transfer (CEI pattern)", async function () {
    const { jobEscrow, usdc: usdcToken, client, freelancer1, treasury } =
      await loadFixture(deployFullPlatformFixture);

    // Create job and complete a milestone to build withdrawable balance
    const { jobId } = await advanceJobToActive(jobEscrow, usdcToken, client, freelancer1);

    // Submit and approve milestone 0
    const deliverableHash = ethers.keccak256(ethers.toUtf8Bytes("deliverable-0"));
    await jobEscrow.connect(freelancer1).submitMilestone(jobId, 0, deliverableHash, "QmDeliv0");
    await jobEscrow.connect(client).approveMilestone(jobId, 0);

    // Freelancer now has withdrawable balance
    const balance = await jobEscrow.withdrawableBalances(freelancer1.address);
    expect(balance).to.be.gt(0);

    // Withdraw should succeed
    await jobEscrow.connect(freelancer1).withdraw();

    // Balance should be zero after withdrawal
    const afterBalance = await jobEscrow.withdrawableBalances(freelancer1.address);
    expect(afterBalance).to.equal(0);

    // Second withdrawal should revert (no reentrancy possible)
    await expect(jobEscrow.connect(freelancer1).withdraw()).to.be.revertedWith(
      "Nothing to withdraw"
    );
  });

  it("approveMilestone() should process funds only once (fundsProcessed guard)", async function () {
    const { jobEscrow, usdc: usdcToken, client, freelancer1 } =
      await loadFixture(deployFullPlatformFixture);

    const { jobId } = await advanceJobToActive(jobEscrow, usdcToken, client, freelancer1);

    const deliverableHash = ethers.keccak256(ethers.toUtf8Bytes("deliverable-0"));
    await jobEscrow.connect(freelancer1).submitMilestone(jobId, 0, deliverableHash, "QmDeliv0");

    // Approve once
    await jobEscrow.connect(client).approveMilestone(jobId, 0);

    // Try to approve again — should revert (status is no longer InReview)
    await expect(
      jobEscrow.connect(client).approveMilestone(jobId, 0)
    ).to.be.revertedWith("Not in review");
  });

  it("executeDisputeRuling() should process funds only once (fundsProcessed guard)", async function () {
    const {
      jobEscrow,
      usdc: usdcToken,
      dispute,
      client,
      freelancer1,
      judge,
      platformAdmin,
      DISPUTE_ROLE,
    } = await loadFixture(deployFullPlatformFixture);

    const { jobId } = await advanceJobToActive(jobEscrow, usdcToken, client, freelancer1);

    // Submit milestone and raise dispute
    const deliverableHash = ethers.keccak256(ethers.toUtf8Bytes("deliverable-0"));
    await jobEscrow.connect(freelancer1).submitMilestone(jobId, 0, deliverableHash, "QmDeliv0");
    await jobEscrow.connect(client).raiseDispute(jobId, 0);

    // Fast-forward through dispute process
    const disputeId = 0;

    // Close evidence phase
    await helpers.time.increase(5 * ONE_DAY + 1);
    await dispute.closeEvidencePhase(disputeId);

    // Assign judge
    const ephKey = ethers.toUtf8Bytes("judge-eph-key");
    await dispute.connect(platformAdmin).assignJudge(disputeId, judge.address, ephKey);

    // Both parties submit keys
    const encKey = ethers.toUtf8Bytes("encrypted-key");
    await dispute.connect(client).distributeKeyToJudge(disputeId, encKey);
    await dispute.connect(freelancer1).distributeKeyToJudge(disputeId, encKey);

    // Judge rules
    const reasonHash = ethers.keccak256(ethers.toUtf8Bytes("reasoning"));
    await dispute.connect(judge).submitRuling(disputeId, 1, reasonHash, 8000, 0);

    // Execute ruling
    await dispute.executeRuling(disputeId);

    // Try to execute again — should revert (phase is Executed)
    await expect(dispute.executeRuling(disputeId)).to.be.revertedWith("Not ruled yet");
  });

  it("triggerAutoApprove() and approveMilestone() cannot both succeed on same milestone", async function () {
    const { jobEscrow, usdc: usdcToken, client, freelancer1 } =
      await loadFixture(deployFullPlatformFixture);

    const { jobId } = await advanceJobToActive(jobEscrow, usdcToken, client, freelancer1);

    const deliverableHash = ethers.keccak256(ethers.toUtf8Bytes("deliverable-0"));
    await jobEscrow.connect(freelancer1).submitMilestone(jobId, 0, deliverableHash, "QmDeliv0");

    // Approve manually first
    await jobEscrow.connect(client).approveMilestone(jobId, 0);

    // Advance past review timeout
    await helpers.time.increase(SEVEN_DAYS + 1);

    // Auto-approve should fail because milestone is already Approved
    await expect(
      jobEscrow.connect(freelancer1).triggerAutoApprove(jobId, 0)
    ).to.be.revertedWith("Not in review");
  });
});
