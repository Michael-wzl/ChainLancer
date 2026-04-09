import React, { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Scale, Upload, AlertTriangle, Clock, Gavel } from "lucide-react";
import { ethers } from "ethers";
import toast from "react-hot-toast";
import { useWallet } from "../contexts/WalletContext";
import { useContracts } from "../contexts/ContractContext";
import { useJobDetail } from "../hooks/useJobList";
import { useDispute } from "../hooks/useDispute";
import { TransactionButton } from "../components/common/TransactionButton";
import { DisputeBanner } from "../components/dispute/DisputeBanner";
import { EvidenceList } from "../components/dispute/EvidenceList";
import { KeyDistributionPanel } from "../components/dispute/KeyDistributionPanel";
import { CountdownTimer } from "../components/job/CountdownTimer";
import { RulingForm } from "../components/judge/RulingForm";
import { useBlockTimestamp } from "../hooks/useBlockTimestamp";
import { uploadJSON } from "../ipfs/pinata";
import { parseContractError } from "../utils/errors";
import { formatUSDC, truncateAddress, formatDate } from "../utils/format";
import { getJobKey } from "../utils/storage";
import {
  DisputePhase,
  Ruling,
  DISPUTE_PHASE_LABELS,
  MilestoneStatus,
  ROLES,
} from "../config/constants";

interface DisputeInfo {
  phase: DisputePhase;
  ruling: Ruling;
  initiator: string;
  judge: string;
  ephemeralPubKey: string;
  evidenceDeadline: number;
  keyDistributionDeadline: number;
  rulingDeadline: number;
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
  const blockNow = useBlockTimestamp();
  const isJudge =
    address?.toLowerCase() === dispute?.judge?.toLowerCase() &&
    dispute?.judge !== "0x0000000000000000000000000000000000000000";

  // Admin role check for closing evidence phase
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    const checkAdmin = async () => {
      if (!readContracts.dispute || !address) {
        setIsAdmin(false);
        return;
      }
      try {
        const DEFAULT_ADMIN = "0x0000000000000000000000000000000000000000000000000000000000000000";
        const [hasAdmin, hasDefault] = await Promise.all([
          readContracts.dispute.hasRole(ROLES.PLATFORM_ADMIN, address),
          readContracts.dispute.hasRole(DEFAULT_ADMIN, address),
        ]);
        setIsAdmin(hasAdmin || hasDefault);
      } catch {
        setIsAdmin(false);
      }
    };
    checkAdmin();
  }, [readContracts.dispute, address]);

  const isAuthorizedViewer = isClient || isFreelancer || isJudge || isAdmin;

  // Fetch dispute info — first resolve disputeId from JobEscrow, then query Dispute contract
  const fetchDispute = useCallback(async () => {
    if (!readContracts.dispute || !readContracts.jobEscrow || jobId === null) return;
    setLoading(true);
    try {
      // Look up disputeId from JobEscrow.disputeIds(jobId, milestoneIdx)
      const dId = Number(await readContracts.jobEscrow.disputeIds(jobId, milestoneIdx));
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
        keyDistributionDeadline: Number(info.keyDistributionDeadline),
        rulingDeadline: Number(info.rulingDeadline),
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
  }, [readContracts.dispute, readContracts.jobEscrow, jobId, milestoneIdx]);

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

      // Bug #1 fix: use disputeId (not jobId), compute evidenceHash (keccak256)
      const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(evidenceDoc)));

      // Dry-run the transaction to catch reverts BEFORE uploading to IPFS
      try {
        await contracts.dispute.submitEvidence.estimateGas(disputeId, evidenceHash, "QmPlaceholderDryRun");
      } catch (dryRunErr) {
        toast.error(`Transaction will fail: ${parseContractError(dryRunErr)}`, { id: "evidence" });
        setTxLoading(false);
        return;
      }

      // Upload to IPFS only after dry-run passes
      const cid = await uploadJSON(
        evidenceDoc,
        `evidence-${jobId}-${milestoneIdx}-${Date.now()}`
      );

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

  // Hooks
  const { closeEvidencePhase, claimRulingDefault, executeRuling: execRuling, loading: disputeHookLoading } = useDispute();

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
        <EvidenceList evidences={evidenceList} currentUser={address ?? undefined} isAuthorized={isAuthorizedViewer} />
      </div>

      {/* Submit evidence (during evidence phase) */}
      {dispute.phase === DisputePhase.Evidence &&
        (isClient || isFreelancer) && (() => {
          const mySubmissions = evidenceList.filter(
            (ev) => ev.submitter.toLowerCase() === address?.toLowerCase()
          ).length;
          const remaining = 20 - mySubmissions;
          return (
          <div className="card">
            <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
              <Upload className="h-4 w-4" /> Submit Evidence
            </h3>
            {remaining > 0 ? (
              <>
                <textarea
                  value={evidenceText}
                  onChange={(e) => setEvidenceText(e.target.value)}
                  rows={4}
                  placeholder="Describe your evidence..."
                  className="input resize-y mb-2"
                />
                <p className="text-xs text-gray-400 mb-3">
                  {remaining} of 20 submissions remaining
                </p>
                <TransactionButton
                  onClick={handleSubmitEvidence}
                  isLoading={txLoading}
                  variant="primary"
                >
                  <Upload className="mr-1.5 h-4 w-4" /> Submit Evidence
                </TransactionButton>
              </>
            ) : (
              <p className="text-sm text-amber-600">
                You have reached the maximum of 20 evidence submissions for this dispute.
              </p>
            )}
          </div>
          );
        })()}

      {/* Close Evidence Phase button — only client, freelancer, or admin can close */}
      {dispute.phase === DisputePhase.Evidence &&
        dispute.evidenceDeadline > 0 &&
        blockNow > dispute.evidenceDeadline &&
        (isClient || isFreelancer || isAdmin) && (
          <div className="card">
            <div className="flex items-center gap-2 mb-3">
              <Clock className="h-4 w-4 text-orange-500" />
              <p className="text-sm text-orange-700 font-medium">
                Evidence deadline has passed. The evidence phase can be closed.
              </p>
            </div>
            <TransactionButton
              onClick={async () => {
                if (disputeId === null) return;
                setTxLoading(true);
                try {
                  await closeEvidencePhase(disputeId);
                  fetchDispute();
                } catch {
                  // Error toasted by hook
                } finally {
                  setTxLoading(false);
                }
              }}
              isLoading={txLoading}
              variant="primary"
            >
              <Clock className="mr-1.5 h-4 w-4" /> Close Evidence Phase
            </TransactionButton>
          </div>
        )}

      {/* Evidence deadline countdown */}
      {dispute.phase === DisputePhase.Evidence && dispute.evidenceDeadline > 0 && (
        <div className="card">
          <CountdownTimer
            targetTimestamp={dispute.evidenceDeadline}
            label="Evidence deadline"
            expiredLabel="Expired — phase can be closed"
          />
        </div>
      )}

      {/* Key distribution (using extracted component) */}
      {dispute.phase === DisputePhase.KeyDistribution && disputeId !== null && jobId !== null && (
        <KeyDistributionPanel
          disputeId={disputeId}
          judgeAddress={dispute.judge}
          isClientKeySubmitted={dispute.clientKeySubmitted}
          isFreelancerKeySubmitted={dispute.freelancerKeySubmitted}
          keyDistributionDeadline={dispute.keyDistributionDeadline}
          jobId={jobId}
          userRole={isClient ? "client" : isFreelancer ? "freelancer" : "none"}
          onKeyDistributed={fetchDispute}
          blockNow={blockNow}
        />
      )}

      {/* Ruling deadline countdown (during UnderReview phase) */}
      {dispute.phase === DisputePhase.UnderReview && dispute.rulingDeadline > 0 && (
        <div className="card">
          <CountdownTimer
            targetTimestamp={dispute.rulingDeadline}
            label="Ruling deadline"
            expiredLabel="Ruling deadline expired"
          />
        </div>
      )}

      {/* Judge Ruling Form (judge sees this during UnderReview) */}
      {dispute.phase === DisputePhase.UnderReview && isJudge && disputeId !== null && (
        <RulingForm
          disputeId={disputeId}
          phase={dispute.phase}
          onRulingSubmitted={fetchDispute}
          onRulingExecuted={fetchDispute}
        />
      )}

      {/* Claim Ruling Default (when judge missed the ruling deadline) */}
      {dispute.phase === DisputePhase.UnderReview &&
        dispute.rulingDeadline > 0 &&
        blockNow > dispute.rulingDeadline && (
          <div className="card">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="h-4 w-4 text-orange-500" />
              <p className="text-sm text-orange-700 font-medium">
                The judge has missed the ruling deadline. You can claim a ruling
                default to remove the judge and reset the dispute for reassignment.
              </p>
            </div>
            <TransactionButton
              onClick={async () => {
                if (disputeId === null) return;
                setTxLoading(true);
                try {
                  await claimRulingDefault(disputeId);
                  fetchDispute();
                } catch {
                  // Error toasted by hook
                } finally {
                  setTxLoading(false);
                }
              }}
              isLoading={txLoading}
              variant="danger"
            >
              <AlertTriangle className="mr-1.5 h-4 w-4" /> Claim Ruling Default
            </TransactionButton>
          </div>
        )}

      {/* Execute Ruling button (when phase is Ruled) */}
      {dispute.phase === DisputePhase.Ruled && disputeId !== null && (
        <div className="card">
          <div className="flex items-center gap-2 mb-3">
            <Gavel className="h-4 w-4 text-indigo-600" />
            <p className="text-sm text-gray-700 font-medium">
              A ruling has been submitted. Execute it to redistribute funds.
            </p>
          </div>
          <TransactionButton
            onClick={async () => {
              setTxLoading(true);
              try {
                await execRuling(disputeId);
                fetchDispute();
              } catch {
                // Error toasted by hook
              } finally {
                setTxLoading(false);
              }
            }}
            isLoading={txLoading}
            variant="primary"
          >
            <Gavel className="mr-1.5 h-4 w-4" /> Execute Ruling
          </TransactionButton>
        </div>
      )}
    </div>
  );
}
