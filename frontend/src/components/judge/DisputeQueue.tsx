import React from "react";
import { Scale, ChevronRight, Clock } from "lucide-react";
import { DisputePhaseBadge } from "../common/StatusBadge";
import { CountdownTimer } from "../job/CountdownTimer";
import { truncateAddress, formatUSDC } from "../../utils/format";
import { DisputePhase } from "../../config/constants";

// ─── Types ───

export interface DisputeQueueItem {
  disputeId: number;
  jobId: number;
  milestoneIdx: number;
  client: string;
  freelancer: string;
  milestoneValue: bigint;
  phase: DisputePhase;
  deadlines: {
    evidenceDeadline: number;
    keyDistributionDeadline: number;
    rulingDeadline: number;
  };
}

interface DisputeQueueProps {
  disputes: DisputeQueueItem[];
  selectedId: number | null;
  onSelect: (disputeId: number) => void;
}

// ─── Component ───

export function DisputeQueue({ disputes, selectedId, onSelect }: DisputeQueueProps) {
  const [phaseFilter, setPhaseFilter] = React.useState<DisputePhase | "all">("all");

  const filtered =
    phaseFilter === "all"
      ? disputes
      : disputes.filter((d) => d.phase === phaseFilter);

  const getActiveDeadline = (d: DisputeQueueItem): number => {
    switch (d.phase) {
      case DisputePhase.Evidence:
        return d.deadlines.evidenceDeadline;
      case DisputePhase.KeyDistribution:
        return d.deadlines.keyDistributionDeadline;
      case DisputePhase.UnderReview:
        return d.deadlines.rulingDeadline;
      default:
        return 0;
    }
  };

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
          <Scale className="h-5 w-5 text-indigo-600" />
          Assigned Disputes
          <span className="ml-1 bg-indigo-100 text-indigo-800 py-0.5 px-2 rounded-full text-xs font-semibold">
            {disputes.length}
          </span>
        </h2>
      </div>

      {/* Phase filter tabs */}
      <div className="flex gap-1 mb-4 flex-wrap">
        {(
          [
            { label: "All", value: "all" as const },
            { label: "Key Distribution", value: DisputePhase.KeyDistribution },
            { label: "Under Review", value: DisputePhase.UnderReview },
            { label: "Ruled", value: DisputePhase.Ruled },
            { label: "Executed", value: DisputePhase.Executed },
          ] as const
        ).map((tab) => (
          <button
            key={String(tab.value)}
            onClick={() => setPhaseFilter(tab.value)}
            className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
              phaseFilter === tab.value
                ? "bg-indigo-100 text-indigo-800"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Dispute list */}
      {filtered.length === 0 ? (
        <div className="text-center py-10 bg-gray-50 rounded-lg border border-dashed border-gray-200">
          <Scale className="h-8 w-8 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500">
            {disputes.length === 0
              ? "No disputes assigned to you."
              : "No disputes match this filter."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((d) => {
            const isSelected = selectedId === d.disputeId;
            const activeDeadline = getActiveDeadline(d);
            return (
              <button
                key={d.disputeId}
                onClick={() => onSelect(d.disputeId)}
                className={`w-full text-left rounded-xl border p-4 transition hover:shadow-sm ${
                  isSelected
                    ? "border-indigo-300 bg-indigo-50 ring-1 ring-indigo-200"
                    : "border-gray-200 bg-white hover:border-gray-300"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                      Dispute #{d.disputeId}
                      <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
                      Job #{d.jobId}, Milestone {d.milestoneIdx + 1}
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-xs text-gray-500">
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-blue-500" />
                        Client: {truncateAddress(d.client)}
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-purple-500" />
                        Freelancer: {truncateAddress(d.freelancer)}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <DisputePhaseBadge phase={d.phase} />
                    <span className="text-xs text-gray-500">
                      {formatUSDC(d.milestoneValue)}
                    </span>
                  </div>
                </div>

                {activeDeadline > 0 && (
                  <div className="mt-2">
                    <CountdownTimer
                      targetTimestamp={activeDeadline}
                      label="Deadline"
                    />
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
