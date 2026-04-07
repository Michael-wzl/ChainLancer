/**
 * Tests for useCountdown hook — Countdown timer with blockchain time
 *
 * Bug-hunting targets:
 * - useCountdown uses useBlockTimestamp internally, but is it reactive?
 * - isExpired returns false when targetTimestamp is 0 (boundary)
 * - isExpired returns false when targetTimestamp is null even if label says "expired"
 * - Off-by-one: `secondsLeft <= 0` vs `<= 0` vs `< 0`
 * - formatCountdown doesn't handle fractional seconds from blockchain timestamps
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// Mock useBlockTimestamp to control the "now" value precisely
let mockNow = 1000000;
vi.mock("../../hooks/useBlockTimestamp", () => ({
  useBlockTimestamp: () => mockNow,
  IS_TEST_MODE: true,
}));

import { useCountdown } from "../../hooks/useCountdown";

describe("hooks/useCountdown — timeout edge cases", () => {
  beforeEach(() => {
    mockNow = 1000000;
  });

  // ═══════════════════════════════════════════════════════════
  //  Basic correctness
  // ═══════════════════════════════════════════════════════════

  it("should return 0 seconds and isExpired=false when target is null", () => {
    const { result } = renderHook(() => useCountdown(null));
    expect(result.current.secondsLeft).toBe(0);
    expect(result.current.isExpired).toBe(false);
    expect(result.current.formatted).toBe("00:00:00");
  });

  it("should compute remaining seconds correctly", () => {
    const target = mockNow + 3600; // 1 hour from now
    const { result } = renderHook(() => useCountdown(target));
    expect(result.current.secondsLeft).toBe(3600);
    expect(result.current.isExpired).toBe(false);
  });

  it("should show expired when target is in the past", () => {
    const target = mockNow - 100;
    const { result } = renderHook(() => useCountdown(target));
    expect(result.current.secondsLeft).toBe(0);
    expect(result.current.isExpired).toBe(true);
  });

  // ═══════════════════════════════════════════════════════════
  //  Boundary / Edge cases — potential bugs
  // ═══════════════════════════════════════════════════════════

  it("BUG PROBE: isExpired when target === now (exactly on the boundary)", () => {
    // target === now means remaining = 0.
    // The code: `isExpired = secondsLeft <= 0 && targetTimestamp !== null && targetTimestamp > 0`
    // secondsLeft = max(0, target - now) = 0, so isExpired = true.
    // This means the EXACT moment of the deadline counts as expired.
    // Contract uses strict `>`: `block.timestamp > selectedAt + T_STAKE`
    // So there's an off-by-one: UI says expired, contract says NOT expired.
    const target = mockNow;
    const { result } = renderHook(() => useCountdown(target));
    expect(result.current.secondsLeft).toBe(0);
    // UI will show expired...
    expect(result.current.isExpired).toBe(true);
    // ...but contract would still reject because block.timestamp is NOT > target.
    // This is a UI/contract inconsistency!
  });

  it("BUG PROBE: isExpired when target === now + 1 (1 second before boundary)", () => {
    const target = mockNow + 1;
    const { result } = renderHook(() => useCountdown(target));
    expect(result.current.secondsLeft).toBe(1);
    expect(result.current.isExpired).toBe(false);
  });

  it("BUG PROBE: isExpired when target is 0 (sentinel value)", () => {
    // targetTimestamp = 0 might represent "no deadline set".
    // The code: `isExpired = secondsLeft <= 0 && targetTimestamp !== null && targetTimestamp > 0`
    // targetTimestamp > 0 is false, so isExpired = false. This is correct but:
    // If someone passes 0 as an actual timestamp (Jan 1 1970), it won't show as expired.
    const { result } = renderHook(() => useCountdown(0));
    expect(result.current.isExpired).toBe(false); // by design, 0 = "no deadline"
  });

  it("should handle very large future timestamps without overflow", () => {
    const farFuture = mockNow + 365 * 86400; // 1 year
    const { result } = renderHook(() => useCountdown(farFuture));
    expect(result.current.secondsLeft).toBe(365 * 86400);
    expect(result.current.isExpired).toBe(false);
    expect(result.current.formatted).toContain("d ");
  });

  it("should handle negative remaining gracefully (Math.max(0, ...))", () => {
    const target = mockNow - 999999; // way in the past
    const { result } = renderHook(() => useCountdown(target));
    expect(result.current.secondsLeft).toBe(0);
    expect(result.current.isExpired).toBe(true);
  });

  // ═══════════════════════════════════════════════════════════
  //  Format edge cases
  // ═══════════════════════════════════════════════════════════

  it("should format exactly 1 day correctly", () => {
    const target = mockNow + 86400;
    const { result } = renderHook(() => useCountdown(target));
    expect(result.current.formatted).toBe("1d 00:00:00");
  });

  it("should format exactly 23:59:59 without day prefix", () => {
    const target = mockNow + 86399;
    const { result } = renderHook(() => useCountdown(target));
    expect(result.current.formatted).toBe("23:59:59");
  });

  it("should format 3d 00:00:00 for T_STAKE duration", () => {
    const T_STAKE = 259200; // 3 days
    const target = mockNow + T_STAKE;
    const { result } = renderHook(() => useCountdown(target));
    expect(result.current.formatted).toBe("3d 00:00:00");
  });

  // ═══════════════════════════════════════════════════════════
  //  Reactivity to time source changes
  // ═══════════════════════════════════════════════════════════

  it("should react when blockchain time advances (mockNow changes)", () => {
    const target = mockNow + 100;
    const { result, rerender } = renderHook(() => useCountdown(target));
    expect(result.current.secondsLeft).toBe(100);

    // Simulate blockchain advancing by 50 seconds
    mockNow += 50;
    rerender();
    expect(result.current.secondsLeft).toBe(50);

    // Advance past the deadline
    mockNow += 60;
    rerender();
    expect(result.current.secondsLeft).toBe(0);
    expect(result.current.isExpired).toBe(true);
  });

  it("should transition from not-expired to expired cleanly", () => {
    const target = mockNow + 1;
    const { result, rerender } = renderHook(() => useCountdown(target));
    expect(result.current.isExpired).toBe(false);
    expect(result.current.secondsLeft).toBe(1);

    mockNow += 2; // now past deadline
    rerender();
    expect(result.current.isExpired).toBe(true);
    expect(result.current.secondsLeft).toBe(0);
    expect(result.current.formatted).toBe("00:00:00");
  });
});
