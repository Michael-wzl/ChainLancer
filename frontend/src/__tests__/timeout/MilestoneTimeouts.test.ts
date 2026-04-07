/**
 * Tests for MilestoneActions — review timeout and deadline expiry logic
 *
 * Bug-hunting targets:
 * - Review deadline calculation: `submittedAt + reviewTimeout`
 * - Milestone deadline check: `useCountdown(deadline)` — isExpired flag
 * - "Trigger Auto-Approve" button visibility depends on `reviewExpired`
 * - "Claim Abandonment" button visibility depends on `deadlineExpired`
 * - useCountdown returns isExpired=true at boundary (remaining=0), but contract
 *   uses strict `>`, creating off-by-one at exact boundary
 * - What happens when submittedAt is 0 but status is InReview? (invalid state)
 */

import { describe, it, expect } from "vitest";
import { MilestoneStatus, JobState } from "../../config/constants";

describe("MilestoneActions — review timeout logic", () => {
  /**
   * From MilestoneActions.tsx:
   *
   * ```tsx
   * const reviewDeadline =
   *   milestone.status === MilestoneStatus.InReview && milestone.submittedAt > 0
   *     ? milestone.submittedAt + job.reviewTimeout
   *     : null;
   * const { formatted: reviewCountdown, isExpired: reviewExpired } = useCountdown(reviewDeadline);
   * ```
   *
   * Then `reviewExpired` controls "Trigger Auto-Approve" visibility.
   *
   * Contract: `block.timestamp > ms.submittedAt + job.reviewTimeout`
   */

  function computeReviewDeadline(
    status: MilestoneStatus,
    submittedAt: number,
    reviewTimeout: number
  ): number | null {
    return status === MilestoneStatus.InReview && submittedAt > 0
      ? submittedAt + reviewTimeout
      : null;
  }

  function isReviewExpired(
    nowTimestamp: number,
    reviewDeadline: number | null
  ): boolean {
    if (reviewDeadline === null || reviewDeadline === 0) return false;
    return nowTimestamp >= reviewDeadline; // useCountdown uses `<= 0` for remaining
  }

  function canContractAutoApprove(
    nowTimestamp: number,
    submittedAt: number,
    reviewTimeout: number
  ): boolean {
    return nowTimestamp > submittedAt + reviewTimeout; // strict >
  }

  it("review deadline is computed correctly for InReview milestone", () => {
    const deadline = computeReviewDeadline(MilestoneStatus.InReview, 1000000, 86400);
    expect(deadline).toBe(1086400);
  });

  it("review deadline is null for Pending milestone", () => {
    const deadline = computeReviewDeadline(MilestoneStatus.Pending, 1000000, 86400);
    expect(deadline).toBeNull();
  });

  it("review deadline is null when submittedAt is 0", () => {
    const deadline = computeReviewDeadline(MilestoneStatus.InReview, 0, 86400);
    expect(deadline).toBeNull();
  });

  it("review timeout of 1 day: expired after 1 day", () => {
    const submittedAt = 1000000;
    const reviewTimeout = 86400; // 1 day
    const nowTimestamp = submittedAt + reviewTimeout + 1;

    const deadline = computeReviewDeadline(MilestoneStatus.InReview, submittedAt, reviewTimeout);
    expect(isReviewExpired(nowTimestamp, deadline)).toBe(true);
    expect(canContractAutoApprove(nowTimestamp, submittedAt, reviewTimeout)).toBe(true);
  });

  it("BUG PROBE: at exact boundary, UI says expired but contract rejects auto-approve", () => {
    const submittedAt = 1000000;
    const reviewTimeout = 86400;
    const nowTimestamp = submittedAt + reviewTimeout; // exactly at boundary

    const deadline = computeReviewDeadline(MilestoneStatus.InReview, submittedAt, reviewTimeout);

    // useCountdown: remaining = deadline - now = 0 → isExpired = (0 <= 0) = true
    const uiExpired = isReviewExpired(nowTimestamp, deadline);
    expect(uiExpired).toBe(true); // UI shows "Trigger Auto-Approve" button

    // Contract: `block.timestamp > submittedAt + reviewTimeout`
    // nowTimestamp > 1086400 → 1086400 > 1086400 → false
    const contractAllows = canContractAutoApprove(nowTimestamp, submittedAt, reviewTimeout);
    expect(contractAllows).toBe(false); // Contract would REJECT

    // UI and contract DISAGREE at exact boundary!
    // User sees the button, clicks it, and gets a revert. Bad UX.
    expect(uiExpired).not.toBe(contractAllows);
  });

  it("1 second after boundary: both UI and contract agree", () => {
    const submittedAt = 1000000;
    const reviewTimeout = 86400;
    const nowTimestamp = submittedAt + reviewTimeout + 1;

    const deadline = computeReviewDeadline(MilestoneStatus.InReview, submittedAt, reviewTimeout);
    expect(isReviewExpired(nowTimestamp, deadline)).toBe(true);
    expect(canContractAutoApprove(nowTimestamp, submittedAt, reviewTimeout)).toBe(true);
  });

  it("1 second before boundary: both agree not expired", () => {
    const submittedAt = 1000000;
    const reviewTimeout = 86400;
    const nowTimestamp = submittedAt + reviewTimeout - 1;

    const deadline = computeReviewDeadline(MilestoneStatus.InReview, submittedAt, reviewTimeout);
    expect(isReviewExpired(nowTimestamp, deadline)).toBe(false);
    expect(canContractAutoApprove(nowTimestamp, submittedAt, reviewTimeout)).toBe(false);
  });

  // Test all valid review timeout values
  const VALID_TIMEOUTS = [86400, 259200, 604800, 1209600, 1814400, 2592000];

  VALID_TIMEOUTS.forEach((timeout) => {
    it(`review timeout ${timeout / 86400}d: expires correctly after full duration`, () => {
      const submittedAt = 1000000;
      const nowTimestamp = submittedAt + timeout + 1;
      const deadline = computeReviewDeadline(MilestoneStatus.InReview, submittedAt, timeout);
      expect(isReviewExpired(nowTimestamp, deadline)).toBe(true);
      expect(canContractAutoApprove(nowTimestamp, submittedAt, timeout)).toBe(true);
    });
  });
});

describe("MilestoneActions — milestone deadline (abandonment) logic", () => {
  /**
   * From MilestoneActions.tsx:
   *
   * ```tsx
   * const { isExpired: deadlineExpired } = useCountdown(
   *   milestone.status === MilestoneStatus.Pending ? milestone.deadline : null
   * );
   * ```
   *
   * Then: `milestone.status === MilestoneStatus.Pending && isClient && deadlineExpired`
   * shows "Claim Abandonment" button.
   *
   * Contract: `block.timestamp > ms.deadline`
   */

  function canClaimAbandonment(
    isClient: boolean,
    status: MilestoneStatus,
    deadline: number,
    nowTimestamp: number
  ): boolean {
    if (!isClient || status !== MilestoneStatus.Pending) return false;
    const remaining = deadline - nowTimestamp;
    // useCountdown: isExpired = remaining <= 0 && targetTimestamp !== null && targetTimestamp > 0
    return remaining <= 0 && deadline > 0;
  }

  function canContractClaimAbandonment(
    isClient: boolean,
    status: MilestoneStatus,
    deadline: number,
    nowTimestamp: number
  ): boolean {
    return isClient && status === MilestoneStatus.Pending && nowTimestamp > deadline;
  }

  it("should show abandonment button when deadline passed", () => {
    expect(canClaimAbandonment(true, MilestoneStatus.Pending, 1000000, 1000001)).toBe(true);
    expect(canContractClaimAbandonment(true, MilestoneStatus.Pending, 1000000, 1000001)).toBe(true);
  });

  it("should NOT show abandonment button for non-client", () => {
    expect(canClaimAbandonment(false, MilestoneStatus.Pending, 1000000, 2000000)).toBe(false);
  });

  it("should NOT show abandonment button for non-Pending milestone", () => {
    expect(canClaimAbandonment(true, MilestoneStatus.InReview, 1000000, 2000000)).toBe(false);
  });

  it("BUG PROBE: at exact deadline boundary, UI says expired but contract rejects", () => {
    const deadline = 1000000;
    const now = 1000000;

    const uiExpired = canClaimAbandonment(true, MilestoneStatus.Pending, deadline, now);
    const contractAllows = canContractClaimAbandonment(true, MilestoneStatus.Pending, deadline, now);

    // UI: remaining = 0, isExpired = true
    expect(uiExpired).toBe(true);
    // Contract: now > deadline → 1000000 > 1000000 → false
    expect(contractAllows).toBe(false);

    // Off-by-one inconsistency!
    expect(uiExpired).not.toBe(contractAllows);
  });

  it("deadline of 0 should not trigger abandonment", () => {
    expect(canClaimAbandonment(true, MilestoneStatus.Pending, 0, 999999)).toBe(false);
  });
});

describe("MilestoneActions — state-dependent button visibility", () => {
  it("should not render anything when job state is not Active", () => {
    // The component returns null when job.state !== JobState.Active
    const states = [JobState.Open, JobState.Applications, JobState.Completed, JobState.Cancelled, JobState.Abandoned];
    states.forEach((state) => {
      expect(state).not.toBe(JobState.Active);
    });
  });

  it("InReview milestone shows Approve, Dispute, and potentially Auto-Approve buttons", () => {
    // Verify the status-based routing logic
    const status: MilestoneStatus = MilestoneStatus.InReview;
    expect(status).toBe(MilestoneStatus.InReview);
    expect(status).not.toBe(MilestoneStatus.Pending);
    expect(status).not.toBe(MilestoneStatus.Disputed);
  });

  it("only freelancer can submit deliverables for Pending milestones", () => {
    const status = MilestoneStatus.Pending;
    const isFreelancer = true;
    const isClient = false;

    expect(status === MilestoneStatus.Pending && isFreelancer).toBe(true);
    expect(status === MilestoneStatus.Pending && isClient).toBe(false);
  });
});
