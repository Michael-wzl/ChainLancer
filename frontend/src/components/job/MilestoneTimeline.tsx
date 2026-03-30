import React from "react";
import { Check, Clock, AlertTriangle, Circle } from "lucide-react";
import { MilestoneStatus } from "../../config/constants";
import { MilestoneStatusBadge } from "../common/StatusBadge";
import { formatUSDC, formatDate } from "../../utils/format";
import type { MilestoneData } from "../../hooks/useJobList";

interface MilestoneTimelineProps {
  milestones: MilestoneData[];
  onSelect?: (index: number) => void;
  selectedIndex?: number;
}

export function MilestoneTimeline({
  milestones,
  onSelect,
  selectedIndex,
}: MilestoneTimelineProps) {
  return (
    <div className="space-y-0">
      {milestones.map((ms, idx) => {
        const isSelected = selectedIndex === idx;
        const icon = getStatusIcon(ms.status);
        const isLast = idx === milestones.length - 1;

        return (
          <div key={idx} className="relative flex gap-4">
            {/* Timeline line */}
            {!isLast && (
              <div className="absolute left-[15px] top-8 bottom-0 w-0.5 bg-gray-200" />
            )}

            {/* Icon */}
            <div
              className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${getIconBg(
                ms.status
              )}`}
            >
              {icon}
            </div>

            {/* Content */}
            <div
              onClick={() => onSelect?.(idx)}
              className={`flex-1 pb-6 cursor-pointer rounded-lg p-3 -mt-1 transition-colors ${
                isSelected
                  ? "bg-brand-50 border border-brand-200"
                  : "hover:bg-gray-50"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-900">
                    Milestone {idx + 1}
                  </span>
                  <MilestoneStatusBadge status={ms.status} />
                </div>
                <span className="text-sm font-medium text-gray-700">
                  {formatUSDC(ms.value)}
                </span>
              </div>

              <div className="mt-1 text-xs text-gray-500">
                Deadline: {formatDate(ms.deadline)}
                {ms.submittedAt > 0 && (
                  <span className="ml-3">
                    Submitted: {formatDate(ms.submittedAt)}
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function getStatusIcon(status: MilestoneStatus) {
  switch (status) {
    case MilestoneStatus.Approved:
    case MilestoneStatus.AutoApproved:
      return <Check className="h-4 w-4 text-white" />;
    case MilestoneStatus.InReview:
      return <Clock className="h-4 w-4 text-white" />;
    case MilestoneStatus.Disputed:
      return <AlertTriangle className="h-4 w-4 text-white" />;
    case MilestoneStatus.Resolved:
      return <Check className="h-4 w-4 text-white" />;
    default:
      return <Circle className="h-4 w-4 text-gray-400" />;
  }
}

function getIconBg(status: MilestoneStatus): string {
  switch (status) {
    case MilestoneStatus.Approved:
    case MilestoneStatus.AutoApproved:
      return "bg-green-500";
    case MilestoneStatus.InReview:
      return "bg-yellow-500";
    case MilestoneStatus.Disputed:
      return "bg-red-500";
    case MilestoneStatus.Resolved:
      return "bg-blue-500";
    default:
      return "bg-gray-200";
  }
}
