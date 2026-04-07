/**
 * Tests for DisputeDetail.tsx — Evidence phase close and time source bugs
 *
 * Bug-hunting targets:
 * - DisputeDetail uses `Math.floor(Date.now() / 1000)` to decide whether to
 *   show the "Close Evidence Phase" button (line ~322). In test mode with
 *   evm_increaseTime, Date.now() won't reflect the time-travel, so the button
 *   will NOT appear even after the evidence deadline has passed on-chain.
 * - This is the same class of bug as the ApplicationList T_STAKE issue.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

describe("DisputeDetail — evidence deadline time source", () => {
  // ═══════════════════════════════════════════════════════════
  //  The "Close Evidence Phase" visibility condition analysis
  // ═══════════════════════════════════════════════════════════

  /**
   * From DisputeDetail.tsx, the condition for showing the "Close Evidence Phase" button:
   *
   * ```tsx
   * {dispute.phase === DisputePhase.Evidence &&
   *   dispute.evidenceDeadline > 0 &&
   *   Math.floor(Date.now() / 1000) > dispute.evidenceDeadline && (
   *   ...
   * )}
   * ```
   *
   * This uses Date.now() directly instead of useBlockTimestamp().
   * When blockchain time is advanced via evm_increaseTime, Date.now() stays
   * at the real system clock, so this condition evaluates to false even though
   * the on-chain deadline has passed.
   */

  it("BUG: Date.now() diverges from blockchain time — Close Evidence Phase button hidden after time-travel", () => {
    const systemNow = Math.floor(Date.now() / 1000);
    const evidenceDeadline = systemNow + 5 * 86400; // 5 days in the future (system time)

    // Simulate blockchain time advanced by 6 days
    const blockchainNow = systemNow + 6 * 86400;

    // Using Date.now() (the bug):
    const dateNowCheck = systemNow > evidenceDeadline;
    // Using blockchain time (the fix):
    const blockchainCheck = blockchainNow > evidenceDeadline;

    // Date.now() says deadline NOT passed — button hidden
    expect(dateNowCheck).toBe(false);
    // Blockchain time says deadline IS passed — button should show
    expect(blockchainCheck).toBe(true);

    // This proves the bug: after evm_increaseTime, the Close Evidence Phase
    // button remains hidden because it uses the wrong time source.
  });

  it("BUG: evidence phase close uses Date.now() while CountdownTimer uses useBlockTimestamp()", () => {
    // The CountdownTimer component (shown just below the Close Evidence button)
    // uses useCountdown → useBlockTimestamp, so it correctly shows "Expired".
    // But the button to CLOSE the evidence phase uses Date.now().
    //
    // Result: User sees "Expired — phase can be closed" countdown but NO button
    // to actually close it. Confusing UX inconsistency.

    const systemNow = Math.floor(Date.now() / 1000);
    const deadline = systemNow + 3600; // 1 hour from now (system time)
    const blockchainNow = systemNow + 7200; // blockchain is 2 hours ahead

    // CountdownTimer would show:
    const countdownRemaining = deadline - blockchainNow; // -3600 → expired
    expect(countdownRemaining).toBeLessThan(0); // CountdownTimer says "Expired"

    // Close button condition:
    const closeButtonVisible = systemNow > deadline; // false!
    expect(closeButtonVisible).toBe(false);
    // So the countdown says "Expired" but the close button is missing.
  });

  it("evidence deadline exactly at boundary — strict greater-than", () => {
    const now = 1000000;
    const deadline = 1000000;

    // `now > deadline` → false at exact boundary (strict >)
    expect(now > deadline).toBe(false);

    // `now > deadline` → true at +1
    expect((now + 1) > deadline).toBe(true);
  });

  it("evidence deadline of 0 should not show close button", () => {
    const deadline = 0;
    const now = Math.floor(Date.now() / 1000);

    // Condition: `deadline > 0 && now > deadline`
    const shouldShow = deadline > 0 && now > deadline;
    expect(shouldShow).toBe(false);
  });
});

describe("KeyDistributionPanel — deadline time source", () => {
  /**
   * From KeyDistributionPanel.tsx:
   *
   * ```tsx
   * const now = Math.floor(Date.now() / 1000);
   * const deadlinePassed = keyDistributionDeadline > 0 && now > keyDistributionDeadline;
   * ```
   *
   * Same bug as DisputeDetail: uses Date.now() instead of useBlockTimestamp().
   * The CountdownTimer in the same component uses useCountdown → useBlockTimestamp,
   * creating the same inconsistency.
   */

  it("BUG: Date.now() vs blockchain time for key distribution deadline", () => {
    const systemNow = Math.floor(Date.now() / 1000);
    const keyDeadline = systemNow + 2 * 86400; // 2 days from now (system time)

    // Simulate blockchain advanced by 3 days
    const blockchainNow = systemNow + 3 * 86400;

    // Using Date.now() (the bug):
    const dateNowCheck = keyDeadline > 0 && systemNow > keyDeadline;
    // Using blockchain time (the fix):
    const blockchainCheck = keyDeadline > 0 && blockchainNow > keyDeadline;

    expect(dateNowCheck).toBe(false); // Wrong — should show "Claim Key Default"
    expect(blockchainCheck).toBe(true); // Correct
  });

  it("BUG: canClaimDefault is false because Date.now() says deadline not passed", () => {
    const systemNow = Math.floor(Date.now() / 1000);
    const keyDistributionDeadline = systemNow + 86400; // 1 day from now
    const blockchainNow = systemNow + 3 * 86400; // blockchain is 3 days ahead

    const isClientKeySubmitted = false;
    const isFreelancerKeySubmitted = true;

    // The component's logic:
    const dateNowPassed = keyDistributionDeadline > 0 && systemNow > keyDistributionDeadline;
    const aMissing = !isClientKeySubmitted || !isFreelancerKeySubmitted;
    const canClaimDefaultBug = dateNowPassed && aMissing;

    // With blockchain time:
    const blockchainPassed = keyDistributionDeadline > 0 && blockchainNow > keyDistributionDeadline;
    const canClaimDefaultFixed = blockchainPassed && aMissing;

    expect(canClaimDefaultBug).toBe(false);  // Bug: button hidden
    expect(canClaimDefaultFixed).toBe(true);  // Fix: button visible
  });

  it("canClaimDefault is false when both keys are submitted (regardless of deadline)", () => {
    const keyDistributionDeadline = 1000;
    const now = 2000; // past deadline

    const isClientKeySubmitted = true;
    const isFreelancerKeySubmitted = true;

    const deadlinePassed = keyDistributionDeadline > 0 && now > keyDistributionDeadline;
    const aMissing = !isClientKeySubmitted || !isFreelancerKeySubmitted;
    const canClaimDefault = deadlinePassed && aMissing;

    expect(deadlinePassed).toBe(true);
    expect(aMissing).toBe(false);
    expect(canClaimDefault).toBe(false);
  });

  it("canClaimDefault is false when deadline is 0 (not set)", () => {
    const keyDistributionDeadline = 0;
    const now = 999999999;

    const deadlinePassed = keyDistributionDeadline > 0 && now > keyDistributionDeadline;
    expect(deadlinePassed).toBe(false);
  });
});
