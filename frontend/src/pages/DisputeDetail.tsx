import React, { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Scale, Upload, AlertTriangle } from "lucide-react";
import { ethers } from "ethers";
import toast from "react-hot-toast";
import { useWallet } from "../contexts/WalletContext";
import { useContracts } from "../contexts/ContractContext";
import { useJobDetail } from "../hooks/useJobList";
import { TransactionButton } from "../components/common/TransactionButton";
import { DisputeBanner } from "../components/dispute/DisputeBanner";
import { EvidenceList } from "../components/dispute/EvidenceList";
import { uploadJSON } from "../ipfs/pinata";
import { parseContractError } from "../utils/errors";
import { formatUSDC, truncateAddress, formatDate } from "../utils/format";
import { getJobKey } from "../utils/storage";
import { encryptForRecipient } from "../crypto/keyExchange";
import {
  DisputePhase,
  Ruling,
  DISPUTE_PHASE_LABELS,
  MilestoneStatus,
} from "../config/constants";

interface DisputeInfo {
  phase: DisputePhase;
  ruling: Ruling;
  initiator: string;
  judge: string;
  ephemeralPubKey: string;
  evidenceDeadline: number;
  clientKeySubmitted: boolean;
  freelancerKeySubmitted: boolean;
}

interface EvidenceSubmission {
  submitter: string;
  evidenceHash: string;
  evidenceCID: string;
  submittedAt: number;
}

export default function DisputeDetail() {
  const { jobId: jobIdStr, milestoneIdx: msIdxStr } = useParams<{
    jobId: string;
    milestoneIdx: string;
  }>();
  const navigate = useNavigate();
  const { address } = useWallet();
  const { contracts, readContracts } = useContracts();

  const jobId = jobIdStr !== undefined ? Number(jobIdStr) : null;
  const milestoneIdx = msIdxStr !== undefined ? Number(msIdxStr) : 0;
  const { job, milestones, loading: jobLoading } = useJobDetail(jobId);

  const [disputeId, setDisputeId] = useState<number | null>(null);
  const [dispute, setDispute] = useState<DisputeInfo | null>(null);
  const [evidences, setEvidences] = useState<EvidenceSubmission[]>([]);
  const [loading, setLoading] = useState(false);
  const [txLoading, setTxLoading] = useState(false);
  const [evidenceText, setEvidenceText] = useState("");

  const isClient = address?.toLowerCase() === job?.client?.toLowerCase();
  const isFreelancer =
    address?.toLowerCase() === job?.freelancer?.toLowerCase();

  // Fetch dispute info — first resolve disputeId from JobEscrow, then query Dispute contract
  const fetchDispute = useCallback(async () => {
    if (!readContracts.dispute || !readContracts.jobEscrow || jobId === null) return;
    setLoading(true);
    try {
      // Bug #4 fix: look up disputeId from JobEscrow.disputeIds(jobId)
      const dId = Number(await readContracts.jobEscrow.disputeIds(jobId));
      setDisputeId(dId);

      // Bug #3 fix: disputes mapping takes 1 arg (disputeId), not 2
      const info = await readContracts.dispute.disputes(dId);

      // Bug #7 fix: If the initiator is the zero address, no dispute exists.
      if (info.initiator === "0x0000000000000000000000000000000000000000") {
        setDispute(null);
        setLoading(false);
        return;
      }

      setDispute({
        phase: Number(info.phase) as DisputePhase,
        ruling: Number(info.ruling) as Ruling,
        initiator: info.initiator,
        judge: info.judge,
        ephemeralPubKey: info.ephemeralPubKey,
        evidenceDeadline: Number(info.evidenceDeadline),
        clientKeySubmitted: info.clientKeySubmitted,
        freelancerKeySubmitted: info.freelancerKeySubmitted,
      });

      // Bug #11 fix: fetch evidence from getEvidenceCount/getEvidence
      const evidenceCount = Number(await readContracts.dispute.getEvidenceCount(dId));
      const fetchedEvidences: EvidenceSubmission[] = [];
      for (let i = 0; i < evidenceCount; i++) {
        const ev = await readContracts.dispute.getEvidence(dId, i);
        fetchedEvidences.push({
          submitter: ev.submitter,
          evidenceHash: ev.evidenceHash,
          evidenceCID: ev.evidenceCID,
          submittedAt: Number(ev.submittedAt),
        });
      }
      setEvidences(fetchedEvidences);
    } catch (err) {
      console.error("Failed to fetch dispute:", err);
    } finally {
      setLoading(false);
    }
  }, [readContracts.dispute, readContracts.jobEscrow, jobId]);

  useEffect(() => {
    fetchDispute();
  }, [fetchDispute]);

  // Submit evidence
  const handleSubmitEvidence = async () => {
    if (!contracts.dispute || jobId === null || disputeId === null || !address) return;
    if (!evidenceText.trim()) {
      toast.error("Please enter evidence details.");
      return;
    }

    setTxLoading(true);
    try {
      const evidenceDoc = {
        submitter: address,
        jobId,
        milestoneIdx,
        content: evidenceText,
        timestamp: Date.now(),
      };
      const cid = await uploadJSON(
        evidenceDoc,
        `evidence-${jobId}-${milestoneIdx}-${Date.now()}`
      );

      // Bug #1 fix: use disputeId (not jobId), compute evidenceHash (keccak256)
      const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(evidenceDoc)));
      const tx = await contracts.dispute.submitEvidence(disputeId, evidenceHash, cid);
      toast.loading("Submitting evidence...", { id: "evidence" });
      await tx.wait();
      toast.success("Evidence submitted!", { id: "evidence" });
      setEvidenceText("");
      fetchDispute();
    } catch (err) {
      toast.error(parseContractError(err), { id: "evidence" });
    } finally {
      setTxLoading(false);
    }
  };

  // Submit key for judge review
  const handleSubmitKey = async () => {
    if (!contracts.dispute || jobId === null || disputeId === null || !dispute) return;
    setTxLoading(true);
    try {
      // Retrieve the actual job key from local storage
      const keyHex = getJobKey(jobId);
      if (!keyHex) {
        toast.error("No decryption key found for this job. Cannot submit.");
        setTxLoading(false);
        return;
      }

      // Bug #2 fix: encrypt key with judge's ephemeral public key, use distributeKeyToJudge
      const encryptedKey = await encryptForRecipient(keyHex, dispute.judge);
      const tx = await contracts.dispute.distributeKeyToJudge(
        disputeId,
        encryptedKey
      );
      toast.loading("Submitting key...", { id: "key" });
      await tx.wait();
      toast.success("Key submitted!", { id: "key" });
      fetchDispute();
    } catch (err) {
      toast.error(parseContractError(err), { id: "key" });
    } finally {
      setTxLoading(false);
    }
  };

  if (jobLoading || loading) {
    return (
      <div className="text-center py-20 text-gray-400">
        Loading dispute details...
      </div>
    );
  }

  if (!job) {
    return (
      <div className="text-center py-20 text-gray-400">
        Job not found.
      </div>
    );
  }

  if (!dispute) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-400 mb-2">No dispute has been raised for this milestone.</p>
        <p className="text-sm text-gray-400">Job #{jobId}, Milestone #{milestoneIdx + 1}</p>
      </div>
    );
  }

  const milestone = milestones[milestoneIdx];

  // Bug #11 fix: Build evidence list from fetched evidenceSubmissions
  const evidenceList = evidences.map((ev) => ({
    submitter: ev.submitter,
    ipfsCid: ev.evidenceCID,
    timestamp: ev.submittedAt,
    isClient: ev.submitter.toLowerCase() === job.client.toLowerCase(),
  }));

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      {/* Header */}
      <div className="card">
        <div className="flex items-center gap-3 mb-3">
          <Scale className="h-6 w-6 text-red-500" />
          <h1 className="text-2xl font-bold text-gray-900">
            Dispute — Job #{jobId}, Milestone #{milestoneIdx + 1}
          </h1>
        </div>

        <DisputeBanner
          milestoneIndex={milestoneIdx}
          disputePhase={dispute.phase}
          deadlineTimestamp={dispute.evidenceDeadline}
        />

        <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
          <div>
            <p className="text-xs text-gray-400">Raised By</p>
            <p className="font-mono text-gray-700">
              {truncateAddress(dispute.initiator)}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Judge</p>
            <p className="font-mono text-gray-700">
              {dispute.judge === "0x0000000000000000000000000000000000000000"
                ? "Not assigned"
                : truncateAddress(dispute.judge)}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Evidence Deadline</p>
            <p className="text-gray-700">
              {dispute.evidenceDeadline > 0 ? formatDate(dispute.evidenceDeadline) : "—"}
            </p>
          </div>
        </div>

        {milestone && (
          <div className="mt-3 rounded-lg bg-gray-50 p-3 text-sm">
            <span className="text-gray-400">Milestone Value: </span>
            <span className="font-medium">{formatUSDC(milestone.value)}</span>
          </div>
        )}

        {/* Ruling */}
        {dispute.phase >= DisputePhase.Ruled && (
          <div
            className={`mt-4 rounded-lg p-3 text-sm ${
              dispute.ruling === Ruling.FreelancerWins
                ? "bg-green-50 text-green-800"
                : dispute.ruling === Ruling.ClientWins
                ? "bg-blue-50 text-blue-800"
                : "bg-gray-50 text-gray-800"
            }`}
          >
            <p className="font-semibold">
              Ruling:{" "}
              {dispute.ruling === Ruling.FreelancerWins
                ? "Freelancer Wins"
                : dispute.ruling === Ruling.ClientWins
                ? "Client Wins"
                : "Inconclusive"}
            </p>
          </div>
        )}
      </div>

      {/* Evidence */}
      <div className="card">
        <EvidenceList evidences={evidenceList} currentUser={address ?? undefined} />
      </div>

      {/* Submit evidence (during evidence phase) */}
      {dispute.phase === DisputePhase.Evidence &&
        (isClient || isFreelancer) && (
          <div className="card">
            <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
              <Upload className="h-4 w-4" /> Submit Evidence
            </h3>
            <textarea
              value={evidenceText}
              onChange={(e) => setEvidenceText(e.target.value)}
              rows={4}
              placeholder="Describe your evidence..."
              className="input resize-y mb-3"
            />
            <TransactionButton
              onClick={handleSubmitEvidence}
              isLoading={txLoading}
              variant="primary"
            >
              <Upload className="mr-1.5 h-4 w-4" /> Submit Evidence
            </TransactionButton>
          </div>
        )}

      {/* Key submission (during key distribution phase) */}
      {dispute.phase === DisputePhase.KeyDistribution && (
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4" /> Key Submission
          </h3>
          <p className="text-sm text-gray-500 mb-3">
            Submit your decryption key so the judge can review the deliverables.
          </p>
          <div className="flex gap-2 text-xs text-gray-400 mb-3">
            <span>
              Client key:{" "}
              {dispute.clientKeySubmitted ? "✅ Submitted" : "❌ Pending"}
            </span>
            <span>
              Freelancer key:{" "}
              {dispute.freelancerKeySubmitted ? "✅ Submitted" : "❌ Pending"}
            </span>
          </div>

          {((isClient && !dispute.clientKeySubmitted) ||
            (isFreelancer && !dispute.freelancerKeySubmitted)) && (
            <TransactionButton
              onClick={handleSubmitKey}
              isLoading={txLoading}
              variant="primary"
            >
              Submit Decryption Key
            </TransactionButton>
          )}
        </div>
      )}
    </div>
  );
}
