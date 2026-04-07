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
import { useMockUSDC } from "../hooks/useMockUSDC";
import { JobStateBadge } from "../components/common/StatusBadge";
import { MilestoneTimeline } from "../components/job/MilestoneTimeline";
import { MilestoneActions } from "../components/job/MilestoneActions";
import { ApplicationList } from "../components/job/ApplicationList";
import { DisputeBanner } from "../components/dispute/DisputeBanner";
import { TransactionButton } from "../components/common/TransactionButton";
import { getGatewayUrl, retrieveBinaryFromIPFS, retrieveFromIPFS } from "../ipfs/gateway";
import {
  formatUSDC,
  formatDate,
  formatReviewTimeout,
  truncateAddress,
} from "../utils/format";
import { getJobKey, storeJobKey } from "../utils/storage";
import { getJobTitle, storeJobTitle } from "../utils/storage";
import { decrypt } from "../crypto/aes";
import { hexToBuffer } from "../crypto/jobKey";
import { encryptForRecipient, decryptWithPrivateKey, hexToEncryptedKey } from "../crypto/keyExchange";
import { JobState, MilestoneStatus, DisputePhase, T_ACCEPTANCE, T_STAKE, FREELANCER_DEPOSIT_BPS, Tier } from "../config/constants";
import { useReputation } from "../hooks/useReputation";
import { useBlockTimestamp } from "../hooks/useBlockTimestamp";
import { getContractAddresses } from "../config/contracts";
import toast from "react-hot-toast";

export default function JobDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { address } = useWallet();
  const jobId = id !== undefined ? Number(id) : null;
  const { job, milestones, applications, loading, refresh } = useJobDetail(jobId);
  const {
    selectFreelancer,
    reselectFreelancer,
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
  const { readContracts, contracts } = useContracts();
  const { getBalance, getAllowance } = useMockUSDC();

  const { getFreelancerProfile } = useReputation();

  // BUG-005 fix: Use blockchain time instead of Date.now() for time-dependent conditions
  const nowTimestamp = useBlockTimestamp();

  // Estimate freelancer deposit from tier when on-chain value is still 0 (before confirmAndStake)
  const [estimatedDeposit, setEstimatedDeposit] = useState<bigint | null>(null);
  useEffect(() => {
    async function estimateDeposit() {
      if (!job || !readContracts.reputation) return;
      // Only estimate when deposit hasn't been set on-chain yet
      if (job.freelancerDeposit > 0n) {
        setEstimatedDeposit(null);
        return;
      }
      // Determine whose tier to look up
      const freelancerAddr = job.freelancer;
      if (!freelancerAddr || freelancerAddr === "0x0000000000000000000000000000000000000000") {
        // No freelancer selected yet — estimate with "New" tier as default
        const bps = BigInt(FREELANCER_DEPOSIT_BPS.New);
        setEstimatedDeposit((job.totalValue * bps) / 10000n);
        return;
      }
      try {
        const tier = Number(await readContracts.reputation.getFreelancerTier(freelancerAddr)) as Tier;
        const tierKey = (["New", "Bronze", "Silver", "Gold"] as const)[tier];
        const bps = BigInt(FREELANCER_DEPOSIT_BPS[tierKey]);
        setEstimatedDeposit((job.totalValue * bps) / 10000n);
      } catch {
        const bps = BigInt(FREELANCER_DEPOSIT_BPS.New);
        setEstimatedDeposit((job.totalValue * bps) / 10000n);
      }
    }
    estimateDeposit();
  }, [job, readContracts.reputation]);

  // The display deposit: use on-chain value if set, otherwise use estimate
  const displayDeposit = job ? (job.freelancerDeposit > 0n ? job.freelancerDeposit : (estimatedDeposit ?? 0n)) : 0n;

  // Bug #3: Fetch the actual IPFS CID from DataAvailability contract
  const [agreementCID, setAgreementCID] = useState<string | null>(null);

  // BUG FIX: Use state for jobKeyHex so it updates reactively after auto-decryption
  const [jobKeyHex, setJobKeyHex] = useState<string | null>(
    jobId !== null && address ? getJobKey(jobId, address) : null
  );
  const cachedTitle = jobId !== null ? getJobTitle(jobId) : null;

  // Keep jobKeyHex in sync when jobId or address changes
  useEffect(() => {
    setJobKeyHex(jobId !== null && address ? getJobKey(jobId, address) : null);
  }, [jobId, address]);

  // Auto-decrypt job key for selected freelancer who doesn't have it locally
  useEffect(() => {
    async function autoDecryptJobKey() {
      if (jobKeyHex) return; // already have it
      if (!job || !address || !readContracts.jobEscrow) return;
      if (job.freelancer.toLowerCase() !== address.toLowerCase()) return;
      // Only attempt in states where the freelancer is confirmed
      if (job.state !== JobState.Active && job.state !== JobState.Applications) return;

      try {
        const raw = await readContracts.jobEscrow.jobs(jobId);
        const encKeyHex = raw.encryptedKeyForFreelancer;
        if (!encKeyHex || encKeyHex === "0x") return;

        const encryptedBytes = hexToEncryptedKey(encKeyHex);
        if (encryptedBytes.length === 0) return;

        const decryptedKeyHex = await decryptWithPrivateKey(encryptedBytes);
        if (decryptedKeyHex && jobId !== null) {
          storeJobKey(jobId, decryptedKeyHex, address);
          // Update reactive state so UI immediately reflects the new key
          setJobKeyHex(decryptedKeyHex);
          refresh();
        }
      } catch (err) {
        console.debug("Auto-decrypt job key failed (expected if not selected):", err);
      }
    }
    autoDecryptJobKey();
  }, [job, address, jobId, jobKeyHex, readContracts.jobEscrow]);

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
      // BUG FIX: Re-read key from localStorage as a fallback,
      // in case the state hasn't updated yet after auto-decryption
      const effectiveKey = jobKeyHex ?? (jobId !== null && address ? getJobKey(jobId, address) : null);
      if (effectiveKey && !jobKeyHex) {
        setJobKeyHex(effectiveKey);
      }

      // Try to fetch as text first to detect JSON envelope format
      const rawText = await retrieveFromIPFS(agreementCID);
      let encrypted: Uint8Array | null = null;
      let envelopeContent: Record<string, unknown> | null = null;

      try {
        const parsed = JSON.parse(rawText);
        // Handle Pinata-wrapped response
        envelopeContent = (parsed.pinataContent ?? parsed) as Record<string, unknown>;
        if (envelopeContent.version && envelopeContent.encrypted) {
          // New envelope format: { version, salt, encrypted (hex), publicSummary? }
          encrypted = hexToBuffer(envelopeContent.encrypted as string);
        } else {
          // Unknown JSON format — try binary fallback
          encrypted = await retrieveBinaryFromIPFS(agreementCID);
        }
      } catch {
        // Not JSON — legacy raw binary format (IV || ciphertext)
        encrypted = await retrieveBinaryFromIPFS(agreementCID);
      }

      if (effectiveKey && encrypted) {
        const plaintext = await decrypt(encrypted, effectiveKey);
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
      } else if (envelopeContent?.publicSummary) {
        // No decryption key — show the unencrypted publicSummary from the envelope
        const summary = envelopeContent.publicSummary;
        setAgreementText(JSON.stringify(summary));
        // Cache title from public summary
        try {
          const s = summary as Record<string, unknown>;
          if (s.title && jobId !== null) {
            storeJobTitle(jobId, s.title as string);
          }
        } catch { /* ignore */ }
      } else {
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
  }, [agreementCID, agreementText, jobKeyHex, jobId, address]);
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
    for (const { idx } of disputed) {
      try {
        // Resolve disputeId per milestone from the nested mapping disputeIds(jobId, milestoneIdx)
        const disputeId = Number(await readContracts.jobEscrow.disputeIds(jobId, idx));
        const info = await readContracts.dispute.disputes(disputeId);
        phases[idx] = Number(info.phase) as DisputePhase;
      } catch {
        phases[idx] = DisputePhase.Evidence;
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
            <p className="text-xs text-gray-400">
              Freelancer Deposit{job.freelancerDeposit === 0n && estimatedDeposit ? " (est.)" : ""}
            </p>
            <p className="font-semibold text-blue-700 text-sm">
              {formatUSDC(displayDeposit)}
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

      {/* BUG-004 fix: Cancellation status banner */}
      {job.state === JobState.Active && job.cancellationRequested && (
        <div className="rounded-lg border border-yellow-300 bg-yellow-50 p-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-600" />
            <p className="text-sm font-medium text-yellow-800">
              {job.cancellationRequestor?.toLowerCase() === address?.toLowerCase()
                ? "You have requested cancellation. Waiting for the counterparty to accept."
                : job.cancellationRequestor?.toLowerCase() === job.client.toLowerCase()
                  ? "The client has requested cancellation. You may accept or continue working."
                  : "The freelancer has requested cancellation. You may accept or continue working."}
            </p>
          </div>
        </div>
      )}

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
                // Encrypt the job key for the freelancer using their on-chain pubkey
                const keyHex = getJobKey(job.jobId, address ?? undefined);
                if (!keyHex) {
                  throw new Error("No job key found. Cannot select freelancer without encryption key.");
                }
                // Look up freelancer's encryption public key from contract
                const freelancerPubKey: string = await readContracts.jobEscrow!.encryptionPubKeys(freelancerAddr);
                if (!freelancerPubKey || freelancerPubKey === "0x") {
                  throw new Error("Freelancer has not registered an encryption key.");
                }
                const encryptedKey = await encryptForRecipient(keyHex, freelancerPubKey);
                await selectFreelancer(job.jobId, freelancerAddr, encryptedKey);
                refresh();
              }}
              onReselect={async (freelancerAddr) => {
                const keyHex = getJobKey(job.jobId, address ?? undefined);
                if (!keyHex) {
                  throw new Error("No job key found. Cannot reselect freelancer without encryption key.");
                }
                const freelancerPubKey: string = await readContracts.jobEscrow!.encryptionPubKeys(freelancerAddr);
                if (!freelancerPubKey || freelancerPubKey === "0x") {
                  throw new Error("Freelancer has not registered an encryption key.");
                }
                const encryptedKey = await encryptForRecipient(keyHex, freelancerPubKey);
                await reselectFreelancer(job.jobId, freelancerAddr, encryptedKey);
                refresh();
              }}
              selectedFreelancer={job.freelancer}
              isSelecting={txLoading}
              userAddress={address ?? undefined}
              isClient={true}
              jobId={job.jobId}
              selectedAt={job.selectedAt}
              nowTimestamp={nowTimestamp}
            />
          </div>
        )}

      {/* Applications visible to freelancer who applied (can see own proposal) */}
      {(job.state === JobState.Open || job.state === JobState.Applications) &&
        !isClient &&
        alreadyApplied && (
          <div className="card">
            <h2 className="text-lg font-semibold text-gray-800 mb-3">
              Your Application
            </h2>
            <ApplicationList
              applications={applications.filter(
                (a) => a.freelancer.toLowerCase() === address?.toLowerCase()
              )}
              onSelect={() => {}}
              isSelecting={false}
              userAddress={address ?? undefined}
              isClient={false}
              jobId={job.jobId}
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
            Stake your freelancer deposit ({formatUSDC(displayDeposit)}) to activate the job.
          </p>
          <div className="flex gap-3">
            <TransactionButton
              onClick={async () => {
                // Pre-flight: check stake window hasn't expired
                if (nowTimestamp > job.selectedAt + T_STAKE) {
                  toast.error(
                    "The stake window has expired. The client may need to reselect you."
                  );
                  refresh();
                  return;
                }
                // Use estimated deposit for pre-flight checks (on-chain value is 0 until confirmAndStake executes)
                const depositAmount = displayDeposit;
                const balance = await getBalance();
                if (balance < depositAmount) {
                  toast.error(
                    `Insufficient USDC balance. You have ${formatUSDC(balance)} but need ${formatUSDC(depositAmount)}. Visit the Wallet page to get test USDC.`
                  );
                  return;
                }
                const contractAddresses = getContractAddresses();
                const allowance = await getAllowance(contractAddresses.JobEscrow);
                if (allowance < depositAmount) {
                  toast.error(
                    `Insufficient USDC allowance. Please approve JobEscrow to spend your USDC first via the Wallet page.`
                  );
                  return;
                }
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
            {/* Cancel (client, pre-active) — disabled when a freelancer has a pending offer */}
            {isClient &&
              (job.state === JobState.Open ||
                job.state === JobState.Applications) && (() => {
                const hasPendingOffer =
                  job.freelancer !== "0x0000000000000000000000000000000000000000" &&
                  job.selectedAt > 0 &&
                  nowTimestamp <= job.selectedAt + T_STAKE;
                return (
                  <div className="flex flex-col">
                    <TransactionButton
                      onClick={async () => {
                        if (hasPendingOffer) {
                          toast.error(
                            "Cannot cancel while a freelancer has a pending offer. Wait for them to confirm or for the offer to expire."
                          );
                          return;
                        }
                        const confirmed = window.confirm(
                          "Are you sure you want to cancel this job? This action cannot be undone."
                        );
                        if (!confirmed) return;
                        await cancelJob(job.jobId);
                        refresh();
                      }}
                      isLoading={txLoading}
                      variant="danger"
                      disabled={hasPendingOffer}
                    >
                      <XCircle className="mr-1.5 h-4 w-4" /> Cancel Job
                    </TransactionButton>
                    {hasPendingOffer && (
                      <p className="text-xs text-yellow-600 mt-1">
                        A freelancer has a pending offer — cancellation is blocked until the offer expires or is rejected.
                      </p>
                    )}
                  </div>
                );
              })()}

            {/* Request cancellation (active) — BUG-003 fix: hide when request already pending */}
            {job.state === JobState.Active && !job.cancellationRequested && (
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

            {/* Accept cancellation — BUG-001/002 fix: only show when cancellation is pending AND user is counterparty */}
            {job.state === JobState.Active &&
              job.cancellationRequested &&
              job.cancellationRequestor?.toLowerCase() !== address?.toLowerCase() && (
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

            {/* Withdraw expired job — only for Open/Applications that exceeded T_ACCEPTANCE (14 days) */}
            {/* BUG-005 fix: use blockchain time instead of Date.now() */}
            {isClient &&
              (job.state === JobState.Open || job.state === JobState.Applications) &&
              (nowTimestamp > job.createdAt + T_ACCEPTANCE) && (
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
      {/* Public actions — callable by anyone */}
      {/* BUG-006 fix: use blockchain time instead of Date.now() */}
      {address &&
        job.state === JobState.Applications &&
        job.freelancer !== "0x0000000000000000000000000000000000000000" &&
        job.selectedAt > 0 &&
        nowTimestamp > job.selectedAt + T_STAKE && (
        <div className="card">
          <h2 className="text-lg font-semibold text-gray-800 mb-3">Public Actions</h2>
          <p className="text-sm text-gray-500 mb-3">
            The offer to the selected freelancer has expired. Anyone can clear the stale selection.
          </p>
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
