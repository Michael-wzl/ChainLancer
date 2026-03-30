import React, { useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Send } from "lucide-react";
import toast from "react-hot-toast";
import { useWallet } from "../contexts/WalletContext";
import { useJobEscrow } from "../hooks/useJobEscrow";
import { useJobDetail } from "../hooks/useJobList";
import { TransactionButton } from "../components/common/TransactionButton";
import { computeContentHash } from "../crypto/hash";
import { uploadJSON } from "../ipfs/pinata";
import { formatUSDC, formatReviewTimeout } from "../utils/format";
import { JobState } from "../config/constants";
import { JobStateBadge } from "../components/common/StatusBadge";

export default function ApplyJob() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { address, isConnected } = useWallet();
  const jobId = id !== undefined ? Number(id) : null;
  const { job, loading } = useJobDetail(jobId);
  const { applyForJob, isLoading } = useJobEscrow();

  const [proposalText, setProposalText] = useState("");
  const [experience, setExperience] = useState("");
  const [timeline, setTimeline] = useState("");

  const handleApply = useCallback(async () => {
    if (!address || jobId === null) return;

    if (!proposalText.trim()) {
      toast.error("Please write a proposal.");
      return;
    }

    try {
      // Build proposal document
      const proposal = {
        applicant: address,
        proposal: proposalText,
        experience,
        timeline,
        submittedAt: Date.now(),
      };

      // Upload to IPFS and compute hash
      const proposalJSON = JSON.stringify(proposal);
      const proposalHash = computeContentHash(proposalJSON);
      await uploadJSON(proposal, `proposal-job-${jobId}-${Date.now()}`);

      // Submit on-chain (toast is shown by the hook)
      await applyForJob(jobId, proposalHash);
      navigate(`/job/${jobId}`);
    } catch (err) {
      console.error("Apply error:", err);
    }
  }, [address, jobId, proposalText, experience, timeline, applyForJob, navigate]);

  if (!isConnected) {
    return (
      <div className="text-center py-20 text-gray-400">
        Connect your wallet to apply.
      </div>
    );
  }

  if (loading) {
    return <div className="text-center py-20 text-gray-400">Loading...</div>;
  }

  if (!job) {
    return (
      <div className="text-center py-20 text-gray-400">Job not found.</div>
    );
  }

  const canApply =
    job.state === JobState.Open || job.state === JobState.Applications;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Job
      </button>

      {/* Job summary */}
      <div className="card">
        <div className="flex items-center gap-3 mb-2">
          <h2 className="text-lg font-bold text-gray-900">
            Apply for Job #{job.jobId}
          </h2>
          <JobStateBadge state={job.state} />
        </div>
        <div className="flex gap-4 text-sm text-gray-500">
          <span>Value: {formatUSDC(job.totalValue)}</span>
          <span>Review: {formatReviewTimeout(job.reviewTimeout)}</span>
          <span>{job.milestoneCount} milestones</span>
        </div>
      </div>

      {!canApply ? (
        <div className="card bg-yellow-50 border-yellow-200 text-yellow-800 text-sm">
          This job is no longer accepting applications.
        </div>
      ) : (
        <div className="space-y-5">
          <div>
            <label className="label">Your Proposal *</label>
            <textarea
              value={proposalText}
              onChange={(e) => setProposalText(e.target.value)}
              rows={5}
              placeholder="Describe how you would approach this project..."
              className="input resize-y"
              required
            />
          </div>

          <div>
            <label className="label">Relevant Experience</label>
            <textarea
              value={experience}
              onChange={(e) => setExperience(e.target.value)}
              rows={3}
              placeholder="Share your relevant experience and past work..."
              className="input resize-y"
            />
          </div>

          <div>
            <label className="label">Estimated Timeline</label>
            <input
              type="text"
              value={timeline}
              onChange={(e) => setTimeline(e.target.value)}
              placeholder="e.g. 4 weeks"
              className="input"
            />
          </div>

          <TransactionButton
            onClick={handleApply}
            isLoading={isLoading}
            variant="primary"
          >
            <Send className="mr-1.5 h-4 w-4" /> Submit Application
          </TransactionButton>
        </div>
      )}
    </div>
  );
}
