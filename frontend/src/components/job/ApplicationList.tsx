import React from "react";
import { User, Star, ExternalLink } from "lucide-react";
import { truncateAddress } from "../../utils/format";
import { useReputation } from "../../hooks/useReputation";
import { TierBadge } from "../common/StatusBadge";
import type { ApplicationData } from "../../hooks/useJobList";

interface ApplicationListProps {
  applications: ApplicationData[];
  onSelect: (freelancerAddr: string) => void;
  selectedFreelancer?: string;
  isSelecting: boolean;
}

export function ApplicationList({
  applications,
  onSelect,
  selectedFreelancer,
  isSelecting,
}: ApplicationListProps) {
  if (applications.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500 text-sm">
        <User className="h-8 w-8 mx-auto mb-2 text-gray-300" />
        No applications yet.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-gray-700">
        Applications ({applications.length})
      </h3>
      {applications.map((app) => (
        <div
          key={app.freelancer}
          className={`flex items-center justify-between rounded-lg border p-3 transition-colors ${
            selectedFreelancer?.toLowerCase() === app.freelancer.toLowerCase()
              ? "border-brand-300 bg-brand-50"
              : "border-gray-200 hover:border-gray-300"
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100">
              <User className="h-4 w-4 text-gray-500" />
            </div>
            <div>
              <p className="text-sm font-medium font-mono">
                {truncateAddress(app.freelancer)}
              </p>
              <p className="text-xs text-gray-400">
                Applied {new Date(app.appliedAt * 1000).toLocaleDateString()}
              </p>
            </div>
          </div>

          <button
            onClick={() => onSelect(app.freelancer)}
            disabled={isSelecting}
            className="btn-primary text-xs py-1.5 px-3"
          >
            Select
          </button>
        </div>
      ))}
    </div>
  );
}
