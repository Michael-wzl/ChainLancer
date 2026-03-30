import React from "react";
import { Star, ThumbsUp, ThumbsDown, Briefcase, AlertTriangle } from "lucide-react";
import { Tier } from "../../config/constants";
import { ReputationBadge } from "./ReputationBadge";
import { formatBps } from "../../utils/format";

interface ScoreCardProps {
  address: string;
  tier: Tier;
  completedJobs: number;
  disputesFiled: number;
  disputesLost: number;
  totalScore: number;
  successRate: number; // in BPS
  isFreelancer?: boolean;
}

export function ScoreCard({
  address,
  tier,
  completedJobs,
  disputesFiled,
  disputesLost,
  totalScore,
  successRate,
  isFreelancer = true,
}: ScoreCardProps) {
  const stats = [
    {
      label: "Completed Jobs",
      value: completedJobs,
      icon: <Briefcase className="h-4 w-4 text-green-500" />,
    },
    {
      label: "Disputes Involved",
      value: disputesFiled,
      icon: <AlertTriangle className="h-4 w-4 text-yellow-500" />,
    },
    {
      label: "Disputes Lost",
      value: disputesLost,
      icon: <ThumbsDown className="h-4 w-4 text-red-500" />,
    },
    {
      label: "Success Rate",
      value: formatBps(successRate),
      icon: <ThumbsUp className="h-4 w-4 text-blue-500" />,
    },
  ];

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-700">
            {isFreelancer ? "Freelancer" : "Client"} Reputation
          </h3>
          <p className="text-xs text-gray-400 font-mono mt-0.5">
            {address.slice(0, 6)}…{address.slice(-4)}
          </p>
        </div>
        <ReputationBadge tier={tier} size="lg" />
      </div>

      {/* Score bar */}
      <div className="mb-4">
        <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
          <span className="flex items-center gap-1">
            <Star className="h-3.5 w-3.5 text-yellow-500" /> Total Score
          </span>
          <span className="font-medium text-gray-700">{totalScore}</span>
        </div>
        <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-brand-400 to-brand-600 rounded-full transition-all"
            style={{ width: `${Math.min(totalScore, 100)}%` }}
          />
        </div>
      </div>

      {/* Stat grid */}
      <div className="grid grid-cols-2 gap-3">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2"
          >
            {stat.icon}
            <div>
              <div className="text-xs text-gray-400">{stat.label}</div>
              <div className="text-sm font-semibold text-gray-700">
                {stat.value}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
