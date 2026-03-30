import React from "react";
import { AlertTriangle, Clock, ExternalLink } from "lucide-react";
import { DisputePhase } from "../../config/constants";
import { DisputePhaseBadge } from "../common/StatusBadge";
import { CountdownTimer } from "../job/CountdownTimer";

interface DisputeBannerProps {
  milestoneIndex: number;
  disputePhase: DisputePhase;
  deadlineTimestamp?: number; // seconds
  onViewDispute?: () => void;
}

export function DisputeBanner({
  milestoneIndex,
  disputePhase,
  deadlineTimestamp,
  onViewDispute,
}: DisputeBannerProps) {
  const isActive =
    disputePhase === DisputePhase.Evidence ||
    disputePhase === DisputePhase.AwaitingJudge ||
    disputePhase === DisputePhase.KeyDistribution ||
    disputePhase === DisputePhase.UnderReview;

  const isFinished =
    disputePhase === DisputePhase.Ruled ||
    disputePhase === DisputePhase.Executed;

  return (
    <div
      className={`rounded-lg border px-4 py-3 flex items-start gap-3 ${
        isActive
          ? "bg-red-50 border-red-200"
          : isFinished
          ? "bg-green-50 border-green-200"
          : "bg-gray-50 border-gray-200"
      }`}
    >
      <AlertTriangle
        className={`h-5 w-5 mt-0.5 flex-shrink-0 ${
          isActive ? "text-red-500" : "text-gray-400"
        }`}
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm text-gray-900">
            Milestone #{milestoneIndex + 1} — Dispute
          </span>
          <DisputePhaseBadge phase={disputePhase} />
        </div>

        <p className="text-xs text-gray-600 mt-1">
          {disputePhase === DisputePhase.Evidence &&
            "Both parties may submit evidence during this phase."}
          {disputePhase === DisputePhase.AwaitingJudge &&
            "Evidence period has ended. Awaiting judge assignment."}
          {disputePhase === DisputePhase.KeyDistribution &&
            "Judge assigned. Awaiting decryption key distribution."}
          {disputePhase === DisputePhase.UnderReview &&
            "Judge is reviewing the evidence."}
          {disputePhase === DisputePhase.Ruled &&
            "A ruling has been issued."}
          {disputePhase === DisputePhase.Executed &&
            "Dispute has been resolved and funds distributed."}
        </p>

        {deadlineTimestamp && isActive && (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-gray-500">
            <Clock className="h-3.5 w-3.5" />
            <span>Deadline:</span>
            <CountdownTimer targetTimestamp={deadlineTimestamp} />
          </div>
        )}
      </div>

      {onViewDispute && (
        <button
          onClick={onViewDispute}
          className="flex-shrink-0 text-sm text-brand-600 hover:text-brand-700 flex items-center gap-1"
        >
          View <ExternalLink className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
