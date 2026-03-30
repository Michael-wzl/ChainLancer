import React from "react";
import { Star, Shield, Award, Trophy } from "lucide-react";
import { Tier, TIER_LABELS } from "../../config/constants";

interface ReputationBadgeProps {
  tier: Tier;
  size?: "sm" | "md" | "lg";
}

const tierConfig: Record<Tier, { icon: React.ReactNode; color: string; bg: string }> = {
  [Tier.New]: {
    icon: <Star className="h-full w-full" />,
    color: "text-gray-500",
    bg: "bg-gray-100",
  },
  [Tier.Bronze]: {
    icon: <Shield className="h-full w-full" />,
    color: "text-amber-700",
    bg: "bg-amber-100",
  },
  [Tier.Silver]: {
    icon: <Award className="h-full w-full" />,
    color: "text-gray-500",
    bg: "bg-gray-200",
  },
  [Tier.Gold]: {
    icon: <Trophy className="h-full w-full" />,
    color: "text-yellow-600",
    bg: "bg-yellow-100",
  },
};

const sizeMap = {
  sm: "h-5 w-5 p-0.5",
  md: "h-7 w-7 p-1",
  lg: "h-10 w-10 p-1.5",
};

const textSizeMap = {
  sm: "text-xs",
  md: "text-sm",
  lg: "text-base",
};

export function ReputationBadge({ tier, size = "md" }: ReputationBadgeProps) {
  const config = tierConfig[tier];

  return (
    <div className="inline-flex items-center gap-1.5">
      <span
        className={`inline-flex items-center justify-center rounded-full ${sizeMap[size]} ${config.bg} ${config.color}`}
      >
        {config.icon}
      </span>
      <span className={`font-medium ${textSizeMap[size]} ${config.color}`}>
        {TIER_LABELS[tier]}
      </span>
    </div>
  );
}
