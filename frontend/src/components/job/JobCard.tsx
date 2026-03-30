import React from "react";
import { Link } from "react-router-dom";
import { Clock, Users, DollarSign, ArrowRight } from "lucide-react";
import { JobStateBadge } from "../common/StatusBadge";
import { formatUSDC, formatDate, formatReviewTimeout, truncateAddress } from "../../utils/format";
import { getJobTitle } from "../../utils/storage";
import type { JobData } from "../../hooks/useJobList";

interface JobCardProps {
  job: JobData;
}

export function JobCard({ job }: JobCardProps) {
  const cachedTitle = getJobTitle(job.jobId);

  return (
    <Link
      to={`/job/${job.jobId}`}
      className="card hover:border-brand-300 hover:shadow-md transition-all group block"
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 group-hover:text-brand-600">
            {cachedTitle || `Job #${job.jobId}`}
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {cachedTitle ? `Job #${job.jobId} · ` : ""}by {truncateAddress(job.client)}
          </p>
        </div>
        <JobStateBadge state={job.state} />
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs text-gray-600">
        <div className="flex items-center gap-1.5">
          <DollarSign className="h-3.5 w-3.5 text-green-500" />
          <span className="font-medium">{formatUSDC(job.totalValue)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5 text-blue-500" />
          <span>{formatReviewTimeout(job.reviewTimeout)} review</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5 text-purple-500" />
          <span>{job.milestoneCount} milestones</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-gray-400">Created {formatDate(job.createdAt)}</span>
        </div>
      </div>

      {job.freelancer && job.freelancer !== "0x0000000000000000000000000000000000000000" && (
        <div className="mt-3 pt-3 border-t border-gray-100 text-xs text-gray-500">
          Freelancer: {truncateAddress(job.freelancer)}
          <span className="text-gray-300 mx-1">•</span>
          {job.milestonesCompleted}/{job.milestoneCount} completed
        </div>
      )}

      <div className="mt-3 flex justify-end">
        <span className="text-xs text-brand-600 group-hover:translate-x-0.5 transition-transform flex items-center gap-0.5">
          View Details <ArrowRight className="h-3 w-3" />
        </span>
      </div>
    </Link>
  );
}
