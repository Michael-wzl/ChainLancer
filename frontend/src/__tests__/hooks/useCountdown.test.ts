/**
 * Tests for hooks/useCountdown.ts — Countdown timer hook
 *
 * Covers Stage 2 §10: CountdownTimer component behavior
 * - Returns correct seconds remaining
 * - Marks as expired when target time has passed
 * - Formats countdown correctly
 * - Handles null target timestamp
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCountdown } from "../../hooks/useCountdown";

// Mock useBlockTimestamp so we can control "now" precisely
let mockTimestamp = Math.floor(Date.now() / 1000);

vi.mock("../../hooks/useBlockTimestamp", () => ({
  IS_TEST_MODE: false,
  useBlockTimestamp: () => mockTimestamp,
}));

describe("hooks/useCountdown", () => {
  beforeEach(() => {
    mockTimestamp = Math.floor(Date.now() / 1000);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should return 0 seconds when target is null", () => {
    const { result } = renderHook(() => useCountdown(null));
    expect(result.current.secondsLeft).toBe(0);
    expect(result.current.isExpired).toBe(false);
  });

  it("should compute seconds remaining correctly", () => {
    const now = Math.floor(Date.now() / 1000);
    const target = now + 3600; // 1 hour from now

    const { result } = renderHook(() => useCountdown(target));

    // Should be approximately 3600 seconds
    expect(result.current.secondsLeft).toBeGreaterThanOrEqual(3599);
    expect(result.current.secondsLeft).toBeLessThanOrEqual(3600);
    expect(result.current.isExpired).toBe(false);
  });

  it("should mark as expired when target is in the past", () => {
    const now = Math.floor(Date.now() / 1000);
    const target = now - 100; // 100 seconds ago

    const { result } = renderHook(() => useCountdown(target));

    expect(result.current.secondsLeft).toBe(0);
    expect(result.current.isExpired).toBe(true);
  });

  it("should format countdown as HH:MM:SS", () => {
    const now = Math.floor(Date.now() / 1000);
    const target = now + 3661; // 1h 1m 1s

    const { result } = renderHook(() => useCountdown(target));

    // Format should be "01:01:01" or similar
    expect(result.current.formatted).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it("should include days when > 24h remaining", () => {
    const now = Math.floor(Date.now() / 1000);
    const target = now + 2 * 86400 + 3600; // 2 days 1 hour

    const { result } = renderHook(() => useCountdown(target));

    expect(result.current.formatted).toMatch(/^2d\s/);
  });

  it("should show 00:00:00 when expired", () => {
    const now = Math.floor(Date.now() / 1000);
    const target = now - 10;

    const { result } = renderHook(() => useCountdown(target));

    expect(result.current.formatted).toBe("00:00:00");
  });

  it("should tick down over time", () => {
    const now = mockTimestamp;
    const target = now + 60; // 60 seconds

    const { result, rerender } = renderHook(() => useCountdown(target));
    const initialSeconds = result.current.secondsLeft;

    // Simulate time advancing by 5 seconds
    act(() => {
      mockTimestamp = now + 5;
    });
    rerender();

    expect(result.current.secondsLeft).toBeLessThan(initialSeconds);
  });
});
