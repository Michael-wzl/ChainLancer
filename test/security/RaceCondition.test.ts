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
 * Security Tests — Race Conditions
 *
 * Tests competing transactions on the same milestone to verify
 * only the first operation succeeds (state mutex via status checks).
 */
describe("Security: Race Conditions", function () {
  it("approveMilestone + triggerAutoApprove: only first succeeds", async function () {
    const { jobEscrow, usdc: usdcToken, client, freelancer1 } =
      await loadFixture(deployFullPlatformFixture);

    const { jobId } = await advanceJobToActive(jobEscrow, usdcToken, client, freelancer1);

    const deliverableHash = ethers.keccak256(ethers.toUtf8Bytes("deliverable-0"));
    await jobEscrow.connect(freelancer1).submitMilestone(jobId, 0, deliverableHash, "QmDeliv0");

    // Advance past review timeout so both actions would be valid
    await time.increase(SEVEN_DAYS + 1);

    // Client approves first
    await jobEscrow.connect(client).approveMilestone(jobId, 0);

    // Auto-approve should fail — milestone is no longer InReview
    await expect(
      jobEscrow.triggerAutoApprove(jobId, 0)
    ).to.be.revertedWith("Not in review");
  });

  it("raiseDispute + triggerAutoApprove: dispute takes priority when executed first", async function () {
    const { jobEscrow, usdc: usdcToken, client, freelancer1 } =
      await loadFixture(deployFullPlatformFixture);

    const { jobId } = await advanceJobToActive(jobEscrow, usdcToken, client, freelancer1);

    const deliverableHash = ethers.keccak256(ethers.toUtf8Bytes("deliverable-0"));
    await jobEscrow.connect(freelancer1).submitMilestone(jobId, 0, deliverableHash, "QmDeliv0");

    // Advance past review timeout
    await time.increase(SEVEN_DAYS + 1);

    // Client raises dispute first
    await jobEscrow.connect(client).raiseDispute(jobId, 0);

    // Auto-approve should fail — milestone is now Disputed
    await expect(
      jobEscrow.triggerAutoApprove(jobId, 0)
    ).to.be.revertedWith("Not in review");
  });

  it("approveMilestone + raiseDispute: only first succeeds", async function () {
    const { jobEscrow, usdc: usdcToken, client, freelancer1 } =
      await loadFixture(deployFullPlatformFixture);

    const { jobId } = await advanceJobToActive(jobEscrow, usdcToken, client, freelancer1);

    const deliverableHash = ethers.keccak256(ethers.toUtf8Bytes("deliverable-0"));
    await jobEscrow.connect(freelancer1).submitMilestone(jobId, 0, deliverableHash, "QmDeliv0");

    // Approve first
    await jobEscrow.connect(client).approveMilestone(jobId, 0);

    // Dispute should fail — milestone is no longer InReview
    await expect(
      jobEscrow.connect(client).raiseDispute(jobId, 0)
    ).to.be.revertedWith("Not in review");
  });

  it("double executeDisputeRuling: second call is no-op (phase guard)", async function () {
    const {
      jobEscrow,
      usdc: usdcToken,
      dispute,
      client,
      freelancer1,
      judge,
      platformAdmin,
    } = await loadFixture(deployFullPlatformFixture);

    const { jobId } = await advanceJobToActive(jobEscrow, usdcToken, client, freelancer1);

    // Submit milestone and raise dispute
    const deliverableHash = ethers.keccak256(ethers.toUtf8Bytes("deliverable-0"));
    await jobEscrow.connect(freelancer1).submitMilestone(jobId, 0, deliverableHash, "QmDeliv0");
    await jobEscrow.connect(client).raiseDispute(jobId, 0);

    const disputeId = 0;

    // Advance through dispute lifecycle
    await time.increase(5 * ONE_DAY + 1);
    await dispute.closeEvidencePhase(disputeId);

    const ephKey = ethers.toUtf8Bytes("judge-eph-key");
    await dispute.connect(platformAdmin).assignJudge(disputeId, judge.address, ephKey);

    const encKey = ethers.toUtf8Bytes("encrypted-key");
    await dispute.connect(client).distributeKeyToJudge(disputeId, encKey);
    await dispute.connect(freelancer1).distributeKeyToJudge(disputeId, encKey);

    const reasonHash = ethers.keccak256(ethers.toUtf8Bytes("reasoning"));
    await dispute.connect(judge).submitRuling(disputeId, 1, reasonHash, 8000, 0);

    // Execute ruling once
    await dispute.executeRuling(disputeId);

    // Second execution should revert
    await expect(dispute.executeRuling(disputeId)).to.be.revertedWith("Not ruled yet");
  });

  it("double withdraw: second call reverts with zero balance", async function () {
    const { jobEscrow, usdc: usdcToken, client, freelancer1 } =
      await loadFixture(deployFullPlatformFixture);

    const { jobId } = await advanceJobToActive(jobEscrow, usdcToken, client, freelancer1);

    // Submit and approve to get withdrawable balance
    const deliverableHash = ethers.keccak256(ethers.toUtf8Bytes("deliverable-0"));
    await jobEscrow.connect(freelancer1).submitMilestone(jobId, 0, deliverableHash, "QmDeliv0");
    await jobEscrow.connect(client).approveMilestone(jobId, 0);

    // First withdraw succeeds
    await jobEscrow.connect(freelancer1).withdraw();

    // Second withdraw reverts
    await expect(
      jobEscrow.connect(freelancer1).withdraw()
    ).to.be.revertedWith("Nothing to withdraw");
  });
});
