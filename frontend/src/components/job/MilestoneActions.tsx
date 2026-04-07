import React, { useState, useCallback } from "react";
import {
  Check,
  Clock,
  AlertTriangle,
  Upload,
  XCircle,
  Eye,
  FileText,
  Loader2,
  X,
  ExternalLink,
} from "lucide-react";
import { MilestoneStatus, JobState } from "../../config/constants";
import { TransactionButton } from "../common/TransactionButton";
import { useJobEscrow } from "../../hooks/useJobEscrow";
import { useCountdown } from "../../hooks/useCountdown";
import { encrypt, computeContentHash, bufferToHex, decrypt, hexToBuffer } from "../../crypto";
import { uploadFile } from "../../ipfs";
import { retrieveFromIPFS, retrieveBinaryFromIPFS, getGatewayUrl } from "../../ipfs/gateway";
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

  // View deliverable state
  const [showDeliverableModal, setShowDeliverableModal] = useState(false);
  const [deliverableContent, setDeliverableContent] = useState<string | null>(null);
  const [deliverableLoading, setDeliverableLoading] = useState(false);
  const [deliverableError, setDeliverableError] = useState<string | null>(null);

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

  // Whether this milestone has a submitted deliverable that can be viewed
  const hasDeliverable =
    milestone.deliverableCID &&
    milestone.deliverableCID.length > 0 &&
    milestone.status !== MilestoneStatus.Pending;

  // ─── View Deliverable ───
  const handleViewDeliverable = useCallback(async () => {
    if (!milestone.deliverableCID) return;
    setShowDeliverableModal(true);
    if (deliverableContent) return; // already loaded
    setDeliverableLoading(true);
    setDeliverableError(null);
    try {
      const jobKey = getJobKey(job.jobId, userAddress ?? undefined);

      // Try to fetch as text first to detect JSON envelope format
      const rawText = await retrieveFromIPFS(milestone.deliverableCID);
      let encrypted: Uint8Array | null = null;

      try {
        const parsed = JSON.parse(rawText);
        // Handle Pinata-wrapped response
        const envelopeContent = (parsed.pinataContent ?? parsed) as Record<string, unknown>;
        if (envelopeContent.version && envelopeContent.encrypted) {
          // New envelope format: { version, salt, encrypted (hex) }
          encrypted = hexToBuffer(envelopeContent.encrypted as string);
        } else {
          // Unknown JSON format — try binary fallback
          encrypted = await retrieveBinaryFromIPFS(milestone.deliverableCID);
        }
      } catch {
        // Not JSON — legacy raw binary format (IV || ciphertext)
        encrypted = await retrieveBinaryFromIPFS(milestone.deliverableCID);
      }

      if (jobKey && encrypted) {
        const plaintext = await decrypt(encrypted, jobKey);
        setDeliverableContent(plaintext);
      } else {
        setDeliverableError(
          "No decryption key found for this job. The deliverable content is encrypted."
        );
      }
    } catch (err) {
      console.error("Failed to fetch/decrypt deliverable:", err);
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes("400") || errMsg.includes("404") || errMsg.includes("NetworkError")) {
        setDeliverableError(
          "The deliverable could not be found on IPFS. The CID may be invalid or the content is no longer pinned."
        );
      } else {
        setDeliverableError("Failed to fetch or decrypt the deliverable.");
      }
    } finally {
      setDeliverableLoading(false);
    }
  }, [milestone.deliverableCID, deliverableContent, job.jobId, userAddress]);

  // ─── Freelancer: Submit Milestone ───
  const handleSubmit = async () => {
    if (!deliverableText.trim()) {
      toast.error("Please enter deliverable content");
      return;
    }

    try {
      const jobKey = getJobKey(job.jobId, userAddress ?? undefined);

      // Block submission if no encryption key is available — uploading
      // plaintext deliverables to IPFS would be a privacy leak.
      if (!jobKey) {
        toast.error(
          "No encryption key found for this job. Cannot submit deliverable without it. " +
          "Try viewing the Job Agreement first to restore the key, or check if you have the key stored locally."
        );
        return;
      }

      const contentBytes = await encrypt(deliverableText, jobKey);

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
      {/* View Deliverable — available for any submitted milestone */}
      {hasDeliverable && (
        <button
          onClick={handleViewDeliverable}
          className="flex items-center gap-1.5 text-sm text-brand-600 hover:text-brand-700 font-medium"
        >
          <Eye className="h-4 w-4" /> View Milestone {milestoneIdx + 1} Deliverable
        </button>
      )}

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
                if (!userAddress) {
                  toast.error("Please connect your wallet to trigger auto-approve.");
                  return;
                }
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

      {/* Deliverable Modal */}
      {showDeliverableModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="relative w-full max-w-2xl rounded-xl bg-white shadow-xl flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <FileText className="h-5 w-5 text-brand-600" /> Milestone {milestoneIdx + 1} — Deliverable
              </h2>
              <div className="flex items-center gap-3">
                {milestone.deliverableCID && (
                  <a
                    href={getGatewayUrl(milestone.deliverableCID)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"
                    title="View raw encrypted file on IPFS"
                  >
                    <ExternalLink className="h-3.5 w-3.5" /> Raw IPFS
                  </a>
                )}
                <button
                  onClick={() => setShowDeliverableModal(false)}
                  className="rounded p-1 hover:bg-gray-100"
                >
                  <X className="h-5 w-5 text-gray-500" />
                </button>
              </div>
            </div>
            <div className="overflow-y-auto px-6 py-4 flex-1">
              {deliverableLoading && (
                <div className="flex items-center justify-center py-12 text-gray-400">
                  <Loader2 className="h-6 w-6 animate-spin mr-2" /> Decrypting deliverable…
                </div>
              )}
              {deliverableError && (
                <p className="text-sm text-red-600">{deliverableError}</p>
              )}
              {deliverableContent && !deliverableLoading && (
                <pre className="whitespace-pre-wrap break-all text-sm text-gray-700 font-mono bg-gray-50 rounded-lg p-4">
                  {deliverableContent}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
