import React, { useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Send } from "lucide-react";
import toast from "react-hot-toast";
import { useWallet } from "../contexts/WalletContext";
import { useContracts } from "../contexts/ContractContext";
import { useJobEscrow } from "../hooks/useJobEscrow";
import { useJobDetail } from "../hooks/useJobList";
import { TransactionButton } from "../components/common/TransactionButton";
import { computeContentHash } from "../crypto/hash";
import { generateJobKey } from "../crypto/jobKey";
import { encrypt } from "../crypto/aes";
import { recoverPublicKey, eciesEncrypt } from "../crypto/ecies";
import { bufferToHex, hexToBuffer } from "../crypto/jobKey";
import { uploadFile } from "../ipfs/pinata";
import { storeProposalKey } from "../utils/storage";
import { parseContractError } from "../utils/errors";
import { formatUSDC, formatReviewTimeout } from "../utils/format";
import { JobState } from "../config/constants";
import { JobStateBadge } from "../components/common/StatusBadge";
import { useSingleFlight } from "../hooks/useSingleFlight";

export default function ApplyJob() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { address, isConnected } = useWallet();
  const { readContracts } = useContracts();
  const jobId = id !== undefined ? Number(id) : null;
  const { job, loading } = useJobDetail(jobId);
  const { applyForJob, registerEncryptionKey, isLoading } = useJobEscrow();
  const { runWithLock, isLocked } = useSingleFlight();

  const [proposalText, setProposalText] = useState("");
  const [experience, setExperience] = useState("");
  const [timeline, setTimeline] = useState("");
  const applyLockKey = `apply-job:${jobId ?? "unknown"}:${address ?? "disconnected"}`;
  const applyLocked = isLocked(applyLockKey);

  const handleApply = useCallback(async () => {
    return runWithLock(
      applyLockKey,
      async () => {
        if (!address || jobId === null || !readContracts.jobEscrow) {
          return;
        }

        if (!proposalText.trim()) {
          toast.error("Please write a proposal.");
          return;
        }

        try {
          const myPubKeyHex = await recoverPublicKey();
          const existingPubKey = await readContracts.jobEscrow.encryptionPubKeys(address);
          if (!existingPubKey || existingPubKey === "0x" || existingPubKey.toLowerCase() !== myPubKeyHex.toLowerCase()) {
            toast.loading("Registering encryption key…", { id: "regkey" });
            await registerEncryptionKey(myPubKeyHex);
            toast.success("Encryption key registered!", { id: "regkey" });
          }

          const clientPubKeyHex: string = await readContracts.jobEscrow.encryptionPubKeys(job!.client);
          if (!clientPubKeyHex || clientPubKeyHex === "0x") {
            toast.error("Client has not registered an encryption key. Cannot encrypt proposal.");
            return;
          }

          const proposal = {
            applicant: address,
            proposal: proposalText,
            experience,
            timeline,
            submittedAt: Date.now(),
          };
          const proposalJSON = JSON.stringify(proposal);

          const proposalKeyHex = await generateJobKey();
          const encryptedBody = await encrypt(proposalJSON, proposalKeyHex);

          const proposalKeyBytes = hexToBuffer(proposalKeyHex);
          const wrappedForClient = await eciesEncrypt(proposalKeyBytes, clientPubKeyHex);
          const myPubKey = await readContracts.jobEscrow.encryptionPubKeys(address);
          const wrappedForFreelancer = await eciesEncrypt(proposalKeyBytes, myPubKey as string);

          const envelope = {
            version: 1,
            encryptedBody: bufferToHex(encryptedBody),
            wrappedKeyForClient: bufferToHex(wrappedForClient),
            wrappedKeyForFreelancer: bufferToHex(wrappedForFreelancer),
            freelancer: address,
          };
          const envelopeJSON = JSON.stringify(envelope);
          const proposalHash = computeContentHash(proposalJSON);

          try {
            await readContracts.jobEscrow.applyForJob.estimateGas(
              jobId, proposalHash, "QmPlaceholderDryRun",
              { from: address }
            );
          } catch (dryRunErr) {
            const msg = parseContractError(dryRunErr);
            toast.error(`Transaction will fail: ${msg}`);
            return;
          }

          toast.loading("Uploading proposal…", { id: "apply-stage" });
          const envelopeBlob = new Blob([envelopeJSON], { type: "application/json" });
          const proposalCID = await uploadFile(envelopeBlob, `proposal-job-${jobId}-${Date.now()}`);
          toast.loading("Waiting for MetaMask…", { id: "apply-stage" });

          await applyForJob(jobId, proposalHash, proposalCID);
          storeProposalKey(jobId, address, proposalKeyHex);
          toast.success("Application submitted!", { id: "apply-stage" });
          navigate(`/job/${jobId}`);
        } catch (err) {
          toast.dismiss("apply-stage");
          console.error("Apply error:", err);
        }
      },
      () => toast("Request already in progress")
    );
  }, [address, jobId, proposalText, experience, timeline, applyForJob, navigate, readContracts.jobEscrow, job, registerEncryptionKey, runWithLock, applyLockKey]);

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
            isLoading={isLoading || applyLocked}
            variant="primary"
            disabled={applyLocked}
          >
            <Send className="mr-1.5 h-4 w-4" /> {applyLocked ? "Uploading…" : "Submit Application"}
          </TransactionButton>
        </div>
      )}
    </div>
  );
}
