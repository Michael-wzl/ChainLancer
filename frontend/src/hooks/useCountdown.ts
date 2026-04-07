import { useState, useEffect, useRef, useCallback } from "react";
import { useBlockTimestamp } from "./useBlockTimestamp";

/**
 * Countdown timer hook. Returns seconds remaining.
 *
 * Uses blockchain time (via useBlockTimestamp) when VITE_TEST_MODE is enabled,
 * otherwise uses Date.now(). This fixes BUG-005 where time-dependent UI
 * elements would not reflect evm_increaseTime advances.
 */
export function useCountdown(targetTimestamp: number | null): {
  secondsLeft: number;
  isExpired: boolean;
  formatted: string;
} {
  const nowTimestamp = useBlockTimestamp();
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (!targetTimestamp) {
      setSecondsLeft(0);
      return;
    }

    const remaining = targetTimestamp - nowTimestamp;
    setSecondsLeft(Math.max(0, remaining));
  }, [targetTimestamp, nowTimestamp]);

  const isExpired = secondsLeft <= 0 && targetTimestamp !== null && targetTimestamp > 0;

  const formatted = formatCountdown(secondsLeft);

  return { secondsLeft, isExpired, formatted };
}

function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "00:00:00";

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const pad = (n: number) => n.toString().padStart(2, "0");

  if (days > 0) {
    return `${days}d ${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
  }
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
}
