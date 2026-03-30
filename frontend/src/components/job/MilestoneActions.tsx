import React, { useState } from "react";
import {
  Check,
  Clock,
  AlertTriangle,
  Upload,
  XCircle,
} from "lucide-react";
import { MilestoneStatus, JobState } from "../../config/constants";
import { TransactionButton } from "../common/TransactionButton";
import { useJobEscrow } from "../../hooks/useJobEscrow";
import { useCountdown } from "../../hooks/useCountdown";
import { encrypt, computeContentHash, bufferToHex } from "../../crypto";
import { uploadFile } from "../../ipfs";
import { getJobKey } from "../../utils/storage";
import type { MilestoneData, JobData } from "../../hooks/useJobList";
import toast from "react-hot-toast";

interface MilestoneActionsProps {
  job: JobData;
  milestone: MilestoneData;
  milestoneIdx: number;
  userAddress: string | null;
  onRefresh: () => void;
}

export function MilestoneActions({
  job,
  milestone,
  milestoneIdx,
  userAddress,
  onRefresh,
}: MilestoneActionsProps) {
  const {
    approveMilestone,
    triggerAutoApprove,
    raiseDispute,
    submitMilestone,
    claimAbandonment,
    isLoading,
  } = useJobEscrow();

  const [deliverableText, setDeliverableText] = useState("");
  const [showSubmitForm, setShowSubmitForm] = useState(false);

  const isClient = userAddress?.toLowerCase() === job.client.toLowerCase();
  const isFreelancer = userAddress?.toLowerCase() === job.freelancer.toLowerCase();

  // Review timeout countdown
  const reviewDeadline =
    milestone.status === MilestoneStatus.InReview && milestone.submittedAt > 0
      ? milestone.submittedAt + job.reviewTimeout
      : null;
  const { formatted: reviewCountdown, isExpired: reviewExpired } = useCountdown(reviewDeadline);

  // Milestone deadline countdown
  const { isExpired: deadlineExpired } = useCountdown(
    milestone.status === MilestoneStatus.Pending ? milestone.deadline : null
  );

  // ─── Freelancer: Submit Milestone ───
  const handleSubmit = async () => {
    if (!deliverableText.trim()) {
      toast.error("Please enter deliverable content");
      return;
    }

    try {
      const jobKey = getJobKey(job.jobId);
      let contentBytes: Uint8Array;

      if (jobKey) {
        contentBytes = await encrypt(deliverableText, jobKey);
      } else {
        contentBytes = new TextEncoder().encode(deliverableText);
      }

      const deliverableHash = computeContentHash(
        bufferToHex(contentBytes)
      );
      const blob = new Blob([contentBytes.buffer as ArrayBuffer], { type: "application/octet-stream" });
      const cid = await uploadFile(blob, `job-${job.jobId}-ms-${milestoneIdx}`);
      await submitMilestone(job.jobId, milestoneIdx, deliverableHash, cid);
      setShowSubmitForm(false);
      setDeliverableText("");
      onRefresh();
    } catch {
      // Error handled by hook
    }
  };

  if (job.state !== JobState.Active) return null;

  return (
    <div className="space-y-3 mt-3">
      {/* Pending milestone — Freelancer can submit */}
      {milestone.status === MilestoneStatus.Pending && isFreelancer && (
        <div>
          {showSubmitForm ? (
            <div className="space-y-3">
              <textarea
                value={deliverableText}
                onChange={(e) => setDeliverableText(e.target.value)}
                placeholder="Enter deliverable description or content..."
                className="input min-h-[100px]"
              />
              <div className="flex gap-2">
                <TransactionButton
                  onClick={handleSubmit}
                  isLoading={isLoading}
                  variant="success"
                >
                  <Upload className="mr-1.5 h-4 w-4" /> Submit Milestone
                </TransactionButton>
                <button
                  onClick={() => setShowSubmitForm(false)}
                  className="btn-secondary"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <TransactionButton
              onClick={() => setShowSubmitForm(true)}
              variant="primary"
            >
              <Upload className="mr-1.5 h-4 w-4" /> Submit Deliverable
            </TransactionButton>
          )}
        </div>
      )}

      {/* Pending + deadline expired — Client can claim abandonment */}
      {milestone.status === MilestoneStatus.Pending && isClient && deadlineExpired && (
        <TransactionButton
          onClick={async () => {
            await claimAbandonment(job.jobId, milestoneIdx);
            onRefresh();
          }}
          isLoading={isLoading}
          variant="danger"
        >
          <XCircle className="mr-1.5 h-4 w-4" /> Claim Abandonment
        </TransactionButton>
      )}

      {/* In Review — Show countdown */}
      {milestone.status === MilestoneStatus.InReview && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Clock className="h-4 w-4" />
            <span>Review period: {reviewExpired ? "Expired" : reviewCountdown}</span>
          </div>

          {/* Client: Approve or Dispute */}
          {isClient && (
            <div className="flex gap-2">
              <TransactionButton
                onClick={async () => {
                  await approveMilestone(job.jobId, milestoneIdx);
                  onRefresh();
                }}
                isLoading={isLoading}
                variant="success"
              >
                <Check className="mr-1.5 h-4 w-4" /> Approve
              </TransactionButton>
              <TransactionButton
                onClick={async () => {
                  await raiseDispute(job.jobId, milestoneIdx);
                  onRefresh();
                }}
                isLoading={isLoading}
                variant="danger"
              >
                <AlertTriangle className="mr-1.5 h-4 w-4" /> Dispute
              </TransactionButton>
            </div>
          )}

          {/* Freelancer: Dispute option */}
          {isFreelancer && (
            <TransactionButton
              onClick={async () => {
                await raiseDispute(job.jobId, milestoneIdx);
                onRefresh();
              }}
              isLoading={isLoading}
              variant="danger"
            >
              <AlertTriangle className="mr-1.5 h-4 w-4" /> Raise Dispute
            </TransactionButton>
          )}

          {/* Anyone: Auto-approve if expired */}
          {reviewExpired && (
            <TransactionButton
              onClick={async () => {
                await triggerAutoApprove(job.jobId, milestoneIdx);
                onRefresh();
              }}
              isLoading={isLoading}
              variant="secondary"
            >
              <Clock className="mr-1.5 h-4 w-4" /> Trigger Auto-Approve
            </TransactionButton>
          )}
        </div>
      )}

      {/* Disputed */}
      {milestone.status === MilestoneStatus.Disputed && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4" />
          This milestone is currently under dispute.
        </div>
      )}
    </div>
  );
}
