import React from "react";
import { Clock } from "lucide-react";
import { useCountdown } from "../../hooks/useCountdown";

interface CountdownTimerProps {
  targetTimestamp: number;
  label?: string;
  expiredLabel?: string;
}

export function CountdownTimer({
  targetTimestamp,
  label = "Time remaining",
  expiredLabel = "Expired",
}: CountdownTimerProps) {
  const { formatted, isExpired } = useCountdown(targetTimestamp);

  return (
    <div
      className={`flex items-center gap-2 text-sm ${
        isExpired ? "text-red-600" : "text-gray-600"
      }`}
    >
      <Clock className="h-4 w-4" />
      <span>
        {label}: {isExpired ? expiredLabel : formatted}
      </span>
    </div>
  );
}
