import { useState, useEffect, useRef, useCallback } from "react";

/**
 * Countdown timer hook. Returns seconds remaining.
 */
export function useCountdown(targetTimestamp: number | null): {
  secondsLeft: number;
  isExpired: boolean;
  formatted: string;
} {
  const [secondsLeft, setSecondsLeft] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    if (!targetTimestamp) {
      setSecondsLeft(0);
      return;
    }

    const tick = () => {
      const now = Math.floor(Date.now() / 1000);
      const remaining = targetTimestamp - now;
      setSecondsLeft(Math.max(0, remaining));
    };

    tick();
    intervalRef.current = setInterval(tick, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [targetTimestamp]);

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
