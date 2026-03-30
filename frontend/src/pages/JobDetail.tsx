import React, { useMemo, useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  ArrowLeft,
  Users,
  Clock,
  DollarSign,
  XCircle,
  CheckCircle,
  AlertTriangle,
  ExternalLink,
  FileText,
  Loader2,
  X,
} from "lucide-react";
import { useWallet } from "../contexts/WalletContext";
import { useContracts } from "../contexts/ContractContext";
import { useJobDetail } from "../hooks/useJobList";
import { useJobEscrow } from "../hooks/useJobEscrow";
import { JobStateBadge } from "../components/common/StatusBadge";
import { MilestoneTimeline } from "../components/job/MilestoneTimeline";
import { MilestoneActions } from "../components/job/MilestoneActions";
import { ApplicationList } from "../components/job/ApplicationList";
import { DisputeBanner } from "../components/dispute/DisputeBanner";
import { TransactionButton } from "../components/common/TransactionButton";
import { getGatewayUrl, retrieveBinaryFromIPFS } from "../ipfs/gateway";
import {
  formatUSDC,
  formatDate,
  formatReviewTimeout,
  truncateAddress,
} from "../utils/format";
import { getJobKey } from "../utils/storage";
import { getJobTitle, storeJobTitle } from "../utils/storage";
import { decrypt } from "../crypto/aes";
import { encryptForRecipient } from "../crypto/keyExchange";
import { JobState, MilestoneStatus, DisputePhase } from "../config/constants";

export default function JobDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { address } = useWallet();
  const jobId = id !== undefined ? Number(id) : null;
  const { job, milestones, applications, loading, refresh } = useJobDetail(jobId);
  const {
    selectFreelancer,
    confirmAndStake,
    rejectOffer,
    cancelJob,
    requestCancellation,
    acceptCancellation,
    withdraw,
    withdrawExpiredJob,
    expireOffer,
    isLoading: txLoading,
  } = useJobEscrow();
  const { readContracts } = useContracts();

  // Bug #3: Fetch the actual IPFS CID from DataAvailability contract
  const [agreementCID, setAgreementCID] = useState<string | null>(null);

  const jobKeyHex = jobId !== null ? getJobKey(jobId) : null;
  const cachedTitle = jobId !== null ? getJobTitle(jobId) : null;

  // Agreement viewer state
  const [showAgreementModal, setShowAgreementModal] = useState(false);
  const [agreementText, setAgreementText] = useState<string | null>(null);
  const [agreementLoading, setAgreementLoading] = useState(false);
  const [agreementError, setAgreementError] = useState<string | null>(null);

  const handleViewAgreement = useCallback(async () => {
    if (!agreementCID) return;
    setShowAgreementModal(true);
    if (agreementText) return; // already loaded
    setAgreementLoading(true);
    setAgreementError(null);
    try {
      const encrypted = await retrieveBinaryFromIPFS(agreementCID);
      if (jobKeyHex) {
        const plaintext = await decrypt(encrypted, jobKeyHex);
        setAgreementText(plaintext);
        // Bug #4 fix: cache the title from the decrypted agreement
        try {
          const parsed = JSON.parse(plaintext);
          if (parsed.title && jobId !== null) {
            storeJobTitle(jobId, parsed.title);
          }
        } catch {
          // not JSON, skip title caching
        }
      } else {
        // No key available — offer raw IPFS link as fallback
        setAgreementError("No decryption key found for this job. The agreement is encrypted.");
      }
    } catch (err) {
      console.error("Failed to fetch/decrypt agreement:", err);
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes("400") || errMsg.includes("404") || errMsg.includes("NetworkError")) {
        setAgreementError(
          "The agreement document could not be found on IPFS. The CID may be invalid or the content is no longer pinned."
        );
      } else {
        setAgreementError("Failed to fetch or decrypt the agreement.");
      }
    } finally {
      setAgreementLoading(false);
    }
  }, [agreementCID, agreementText, jobKeyHex]);
  useEffect(() => {
    async function fetchAgreementCID() {
      if (!readContracts.dataAvailability || jobId === null) return;
      try {
        const cidHashes: string[] = await readContracts.dataAvailability.getJobCIDs(jobId);
        if (cidHashes.length > 0) {
          const record = await readContracts.dataAvailability.getCIDRecord(cidHashes[0]);
          setAgreementCID(record.cid as string);
        }
      } catch (err) {
        console.error("Failed to fetch agreement CID:", err);
      }
    }
    fetchAgreementCID();
  }, [readContracts.dataAvailability, jobId]);

  // Bug #6: Fetch actual dispute phases for disputed milestones
  const [disputePhases, setDisputePhases] = useState<Record<number, DisputePhase>>({});
  const fetchDisputePhases = useCallback(async () => {
    if (!readContracts.dispute || !readContracts.jobEscrow || jobId === null) return;
    const disputed = milestones
      .map((ms, idx) => ({ ms, idx }))
      .filter((m) => m.ms.status === MilestoneStatus.Disputed);
    const phases: Record<number, DisputePhase> = {};
    if (disputed.length > 0) {
      try {
        // Bug #3 fix: resolve disputeId from JobEscrow, then query disputes(disputeId)
        const disputeId = Number(await readContracts.jobEscrow.disputeIds(jobId));
        const info = await readContracts.dispute.disputes(disputeId);
        const phase = Number(info.phase) as DisputePhase;
        for (const { idx } of disputed) {
          phases[idx] = phase;
        }
      } catch {
        for (const { idx } of disputed) {
          phases[idx] = DisputePhase.Evidence;
        }
      }
    }
    setDisputePhases(phases);
  }, [readContracts.dispute, readContracts.jobEscrow, jobId, milestones]);

  useEffect(() => {
    fetchDisputePhases();
  }, [fetchDisputePhases]);

  const isClient = useMemo(
    () => address?.toLowerCase() === job?.client?.toLowerCase(),
    [address, job]
  );
  const isFreelancer = useMemo(
    () => address?.toLowerCase() === job?.freelancer?.toLowerCase(),
    [address, job]
  );

  // Bug #9 fix: Check if the current user has already applied
  const alreadyApplied = useMemo(
    () =>
      applications.some(
        (a) => a.freelancer.toLowerCase() === address?.toLowerCase()
      ),
    [applications, address]
  );

  if (loading) {
    return <div className="text-center py-20 text-gray-400">Loading job details...</div>;
  }

  if (!job) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-400 mb-4">Job not found.</p>
        <Link to="/browse" className="text-brand-600 hover:underline">
          Browse Jobs
        </Link>
      </div>
    );
  }

  const disputedMilestones = milestones
    .map((ms, idx) => ({ ms, idx }))
    .filter((m) => m.ms.status === MilestoneStatus.Disputed);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Back */}
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      {/* Header */}
      <div className="card">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-2xl font-bold text-gray-900">
                {cachedTitle || `Job #${job.jobId}`}
              </h1>
              <JobStateBadge state={job.state} />
            </div>
            {cachedTitle && (
              <p className="text-xs text-gray-400 mb-1">Job #{job.jobId}</p>
            )}
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-500">
              <span className="flex items-center gap-1">
                <DollarSign className="h-3.5 w-3.5" />
                {formatUSDC(job.totalValue)}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                Review: {formatReviewTimeout(job.reviewTimeout)}
              </span>
              <span className="flex items-center gap-1">
                <Users className="h-3.5 w-3.5" />
                {job.milestoneCount} milestones
              </span>
            </div>
          </div>

          {/* Agreement link */}
          {agreementCID && (
            <button
              onClick={handleViewAgreement}
              className="text-sm text-brand-600 hover:text-brand-700 flex items-center gap-1"
            >
              <FileText className="h-3.5 w-3.5" /> View Agreement
            </button>
          )}
        </div>

        {/* Parties */}
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-lg bg-gray-50 p-3">
            <p className="text-xs text-gray-400 mb-0.5">Client</p>
            <p className="font-mono text-sm text-gray-700">
              {truncateAddress(job.client)}
              {isClient && (
                <span className="ml-1 text-brand-600 text-xs">(you)</span>
              )}
            </p>
          </div>
          <div className="rounded-lg bg-gray-50 p-3">
            <p className="text-xs text-gray-400 mb-0.5">Freelancer</p>
            <p className="font-mono text-sm text-gray-700">
              {job.freelancer ===
              "0x0000000000000000000000000000000000000000"
                ? "Not assigned"
                : truncateAddress(job.freelancer)}
              {isFreelancer && (
                <span className="ml-1 text-brand-600 text-xs">(you)</span>
              )}
            </p>
          </div>
        </div>

        {/* Key dates */}
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-400">
          <span>Created: {formatDate(job.createdAt)}</span>
          {job.selectedAt > 0 && <span>Selected: {formatDate(job.selectedAt)}</span>}
          {job.activatedAt > 0 && <span>Activated: {formatDate(job.activatedAt)}</span>}
        </div>

        {/* Financial details */}
        <div className="mt-4 grid grid-cols-3 gap-3 text-center">
          <div className="rounded-lg bg-green-50 p-2">
            <p className="text-xs text-gray-400">Total Value</p>
            <p className="font-semibold text-green-700 text-sm">
              {formatUSDC(job.totalValue)}
            </p>
          </div>
          <div className="rounded-lg bg-blue-50 p-2">
            <p className="text-xs text-gray-400">Freelancer Deposit</p>
            <p className="font-semibold text-blue-700 text-sm">
              {formatUSDC(job.freelancerDeposit)}
            </p>
          </div>
          <div className="rounded-lg bg-purple-50 p-2">
            <p className="text-xs text-gray-400">Behavior Bond</p>
            <p className="font-semibold text-purple-700 text-sm">
              {formatUSDC(job.behaviorBond)}
            </p>
          </div>
        </div>
      </div>

      {/* Dispute banners */}
      {disputedMilestones.map(({ ms, idx }) => (
        <DisputeBanner
          key={idx}
          milestoneIndex={idx}
          disputePhase={disputePhases[idx] ?? DisputePhase.Evidence}
          onViewDispute={() => navigate(`/dispute/${job.jobId}/${idx}`)}
        />
      ))}

      {/* Applications (visible to client when in Open/Applications state) */}
      {(job.state === JobState.Open || job.state === JobState.Applications) &&
        isClient && (
          <div className="card">
            <h2 className="text-lg font-semibold text-gray-800 mb-3">
              Freelancer Applications
            </h2>
            <ApplicationList
              applications={applications}
              onSelect={async (freelancerAddr) => {
                // Bug #8 fix: encrypt the job key for the freelancer
                const keyHex = getJobKey(job.jobId);
                if (!keyHex) {
                  throw new Error("No job key found. Cannot select freelancer without encryption key.");
                }
                const encryptedKey = await encryptForRecipient(keyHex, freelancerAddr);
                await selectFreelancer(job.jobId, freelancerAddr, encryptedKey);
                refresh();
              }}
              isSelecting={txLoading}
            />
          </div>
        )}

      {/* Apply button for non-client, non-freelancer */}
      {(job.state === JobState.Open || job.state === JobState.Applications) &&
        !isClient &&
        !isFreelancer && (
          alreadyApplied ? (
            <span className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-100 text-gray-500 text-sm cursor-not-allowed">
              <CheckCircle className="h-4 w-4" /> Already Applied
            </span>
          ) : (
            <Link
              to={`/apply/${job.jobId}`}
              className="btn-primary inline-flex items-center gap-2"
            >
              <Users className="h-4 w-4" /> Apply for this Job
            </Link>
          )
        )}

      {/* Freelancer: confirm & stake */}
      {job.state === JobState.Applications && isFreelancer && (
        <div className="card bg-blue-50 border-blue-200">
          <h3 className="font-semibold text-blue-900 mb-2">You&apos;ve been selected!</h3>
          <p className="text-sm text-blue-700 mb-3">
            Stake your freelancer deposit ({formatUSDC(job.freelancerDeposit)}) to activate the job.
          </p>
          <div className="flex gap-3">
            <TransactionButton
              onClick={async () => {
                await confirmAndStake(job.jobId);
                refresh();
              }}
              isLoading={txLoading}
              variant="primary"
            >
              <CheckCircle className="mr-1.5 h-4 w-4" /> Confirm & Stake
            </TransactionButton>
            <TransactionButton
              onClick={async () => {
                await rejectOffer(job.jobId);
                refresh();
              }}
              isLoading={txLoading}
              variant="danger"
            >
              <XCircle className="mr-1.5 h-4 w-4" /> Reject Offer
            </TransactionButton>
          </div>
        </div>
      )}

      {/* Milestones */}
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Milestones</h2>
        <MilestoneTimeline milestones={milestones} />

        {job.state === JobState.Active && (
          <div className="mt-6 space-y-4">
            {milestones.map((ms, idx) => (
              <MilestoneActions
                key={idx}
                job={job}
                milestoneIdx={idx}
                milestone={ms}
                userAddress={address}
                onRefresh={refresh}
              />
            ))}
          </div>
        )}
      </div>

      {/* Job actions */}
      {(isClient || isFreelancer) && (
        <div className="card">
          <h2 className="text-lg font-semibold text-gray-800 mb-3">Job Actions</h2>
          <div className="flex flex-wrap gap-3">
            {/* Cancel (client, pre-active) */}
            {isClient &&
              (job.state === JobState.Open ||
                job.state === JobState.Applications) && (
                <TransactionButton
                  onClick={async () => {
                    await cancelJob(job.jobId);
                    refresh();
                  }}
                  isLoading={txLoading}
                  variant="danger"
                >
                  <XCircle className="mr-1.5 h-4 w-4" /> Cancel Job
                </TransactionButton>
              )}

            {/* Request cancellation (active) */}
            {job.state === JobState.Active && (
              <TransactionButton
                onClick={async () => {
                  await requestCancellation(job.jobId);
                  refresh();
                }}
                isLoading={txLoading}
                variant="secondary"
              >
                Request Cancellation
              </TransactionButton>
            )}

            {/* Accept cancellation */}
            {job.state === JobState.Active && (
              <TransactionButton
                onClick={async () => {
                  await acceptCancellation(job.jobId);
                  refresh();
                }}
                isLoading={txLoading}
                variant="danger"
              >
                Accept Cancellation
              </TransactionButton>
            )}

            {/* Withdraw */}
            <TransactionButton
              onClick={async () => {
                await withdraw();
              }}
              isLoading={txLoading}
              variant="success"
            >
              <DollarSign className="mr-1.5 h-4 w-4" /> Withdraw Funds
            </TransactionButton>

            {/* Expire offer */}
            {isClient && job.state === JobState.Applications && (
              <TransactionButton
                onClick={async () => {
                  await expireOffer(job.jobId);
                  refresh();
                }}
                isLoading={txLoading}
                variant="secondary"
              >
                <AlertTriangle className="mr-1.5 h-4 w-4" /> Expire Offer
              </TransactionButton>
            )}

            {/* Withdraw expired job */}
            {isClient && job.state === JobState.Cancelled && (
              <TransactionButton
                onClick={async () => {
                  await withdrawExpiredJob(job.jobId);
                  refresh();
                }}
                isLoading={txLoading}
                variant="secondary"
              >
                Withdraw Expired Job
              </TransactionButton>
            )}
          </div>
        </div>
      )}
      {/* Agreement Modal */}
      {showAgreementModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="relative w-full max-w-2xl rounded-xl bg-white shadow-xl flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <FileText className="h-5 w-5 text-brand-600" /> Job Agreement
              </h2>
              <div className="flex items-center gap-3">
                {agreementCID && (
                  <a
                    href={getGatewayUrl(agreementCID)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"
                    title="View raw encrypted file on IPFS"
                  >
                    <ExternalLink className="h-3.5 w-3.5" /> Raw IPFS
                  </a>
                )}
                <button
                  onClick={() => setShowAgreementModal(false)}
                  className="rounded p-1 hover:bg-gray-100"
                >
                  <X className="h-5 w-5 text-gray-500" />
                </button>
              </div>
            </div>
            <div className="overflow-y-auto px-6 py-4 flex-1">
              {agreementLoading && (
                <div className="flex items-center justify-center py-12 text-gray-400">
                  <Loader2 className="h-6 w-6 animate-spin mr-2" /> Decrypting agreement…
                </div>
              )}
              {agreementError && (
                <p className="text-sm text-red-600">{agreementError}</p>
              )}
              {agreementText && !agreementLoading && (() => {
                let parsed: Record<string, unknown> | null = null;
                try { parsed = JSON.parse(agreementText); } catch {}
                if (parsed) {
                  return (
                    <div className="space-y-2 text-sm text-gray-700">
                      {Object.entries(parsed).map(([key, value]) => (
                        <div key={key} className="rounded-lg bg-gray-50 p-3">
                          <p className="text-xs text-gray-400 mb-0.5 capitalize">{key.replace(/([A-Z])/g, ' $1')}</p>
                          <p className="font-mono break-all">
                            {typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}
                          </p>
                        </div>
                      ))}
                    </div>
                  );
                }
                return (
                  <pre className="whitespace-pre-wrap break-all text-sm text-gray-700 font-mono bg-gray-50 rounded-lg p-4">
                    {agreementText}
                  </pre>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
