import React, { useState, useCallback, useEffect } from "react";
import { User, Star, ExternalLink, FileText, Loader2, X, CheckCircle, Clock, AlertTriangle, RefreshCw } from "lucide-react";
import { truncateAddress } from "../../utils/format";
import { useReputation, FreelancerProfile } from "../../hooks/useReputation";
import { TierBadge } from "../common/StatusBadge";
import { Tier } from "../../config/constants";
import { useContracts } from "../../contexts/ContractContext";
import { retrieveFromIPFS } from "../../ipfs/gateway";
import { eciesDecrypt } from "../../crypto/ecies";
import { decrypt } from "../../crypto/aes";
import { hexToBuffer, bufferToHex } from "../../crypto/jobKey";
import { getProposalKey } from "../../utils/storage";
import type { ApplicationData } from "../../hooks/useJobList";

interface ApplicationListProps {
  applications: ApplicationData[];
  onSelect: (freelancerAddr: string) => void;
  /** Called when the client reselects a different freelancer (after offer expired) */
  onReselect?: (freelancerAddr: string) => void;
  selectedFreelancer?: string;
  isSelecting: boolean;
  /** Current connected user address */
  userAddress?: string;
  /** Whether the current user is the client of this job */
  isClient?: boolean;
  /** The job ID (needed for local proposal key lookup) */
  jobId?: number;
  /** Timestamp when current freelancer was selected (epoch seconds) */
  selectedAt?: number;
  /** T_STAKE duration in seconds (default 3 days = 259200) */
  tStake?: number;
  /** Current timestamp in seconds (blockchain-aware). Falls back to Date.now()/1000 if not provided. */
  nowTimestamp?: number;
}

export function ApplicationList({
  applications,
  onSelect,
  onReselect,
  selectedFreelancer,
  isSelecting,
  userAddress,
  isClient,
  jobId,
  selectedAt,
  tStake = 259200, // 3 days default
  nowTimestamp,
}: ApplicationListProps) {
  const [viewingProposal, setViewingProposal] = useState<string | null>(null);
  const [proposalContent, setProposalContent] = useState<string | null>(null);
  const [proposalLoading, setProposalLoading] = useState(false);
  const [proposalError, setProposalError] = useState<string | null>(null);
  // Confirmation dialog state
  const [confirmTarget, setConfirmTarget] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<"select" | "reselect" | null>(null);

  // Reputation data for each applicant
  const { getFreelancerProfile } = useReputation();
  const { readContracts } = useContracts();
  const [reputationData, setReputationData] = useState<
    Record<string, { profile: FreelancerProfile | null; tier: Tier }>
  >({});

  useEffect(() => {
    let cancelled = false;
    async function fetchReputation() {
      const entries: Record<string, { profile: FreelancerProfile | null; tier: Tier }> = {};
      await Promise.all(
        applications.map(async (app) => {
          const [profile, tier] = await Promise.all([
            getFreelancerProfile(app.freelancer),
            readContracts.reputation
              ? readContracts.reputation
                  .getFreelancerTier(app.freelancer)
                  .then((t: any) => Number(t) as Tier)
                  .catch(() => Tier.New)
              : Promise.resolve(Tier.New),
          ]);
          entries[app.freelancer.toLowerCase()] = { profile, tier };
        })
      );
      if (!cancelled) setReputationData(entries);
    }
    if (applications.length > 0) fetchReputation();
    return () => { cancelled = true; };
  }, [applications, getFreelancerProfile, readContracts.reputation]);

  const hasSelection = selectedFreelancer && selectedFreelancer !== "0x0000000000000000000000000000000000000000";
  const now = nowTimestamp ?? Math.floor(Date.now() / 1000);
  const offerExpired = hasSelection && selectedAt ? now > selectedAt + tStake : false;

  const handleViewProposal = useCallback(
    async (app: ApplicationData) => {
      if (!app.proposalCID) {
        setProposalError("No proposal CID stored for this application.");
        setViewingProposal(app.freelancer);
        return;
      }

      setViewingProposal(app.freelancer);
      setProposalContent(null);
      setProposalError(null);
      setProposalLoading(true);

      try {
        // 1. Fetch envelope from IPFS
        const raw = await retrieveFromIPFS(app.proposalCID);
        let envelope: any;
        try {
          const parsed = JSON.parse(raw);
          envelope = parsed.pinataContent ?? parsed;
        } catch {
          setProposalError("Failed to parse proposal envelope from IPFS.");
          return;
        }

        // 2. Determine which wrapped key to use
        let wrappedKeyHex: string;
        if (isClient) {
          wrappedKeyHex = envelope.wrappedKeyForClient;
        } else if (
          userAddress &&
          app.freelancer.toLowerCase() === userAddress.toLowerCase()
        ) {
          wrappedKeyHex = envelope.wrappedKeyForFreelancer;
        } else {
          setProposalError("You do not have access to this proposal.");
          return;
        }

        if (!wrappedKeyHex) {
          setProposalError("No wrapped key found in the proposal envelope.");
          return;
        }

        // 3. Try local key first (freelancer stored it at apply time)
        let proposalKeyHex: string | null = null;
        if (
          jobId !== undefined &&
          userAddress &&
          app.freelancer.toLowerCase() === userAddress.toLowerCase()
        ) {
          proposalKeyHex = getProposalKey(jobId, userAddress);
        }

        // 4. If no local key, ECIES-decrypt the wrapped key
        if (!proposalKeyHex) {
          const wrappedKeyBytes = hexToBuffer(wrappedKeyHex);
          const proposalKeyBytes = await eciesDecrypt(wrappedKeyBytes);
          proposalKeyHex = bufferToHex(proposalKeyBytes);
        }

        // 5. AES-decrypt the proposal body
        const encryptedBody = hexToBuffer(envelope.encryptedBody);
        const plaintext = await decrypt(encryptedBody, proposalKeyHex);
        setProposalContent(plaintext);
      } catch (err) {
        console.error("Failed to decrypt proposal:", err);
        setProposalError("Failed to decrypt proposal. Ensure your wallet is connected.");
      } finally {
        setProposalLoading(false);
      }
    },
    [isClient, userAddress, jobId]
  );

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

      {/* Guidance banner when a freelancer is already selected */}
      {isClient && hasSelection && (
        <div className={`rounded-lg border p-3 text-sm ${offerExpired ? "bg-amber-50 border-amber-200" : "bg-blue-50 border-blue-200"}`}>
          {offerExpired ? (
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium text-amber-800">Offer expired</p>
                <p className="text-amber-700 text-xs mt-0.5">
                  The selected freelancer did not confirm within the staking window.
                  You can now <strong>reselect</strong> a different applicant.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2">
              <Clock className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium text-blue-800">Waiting for freelancer confirmation</p>
                <p className="text-blue-700 text-xs mt-0.5">
                  {truncateAddress(selectedFreelancer!)} has been selected and has{" "}
                  {selectedAt
                    ? (() => {
                        const remaining = selectedAt + tStake - now;
                        if (remaining <= 0) return "0s";
                        const days = Math.floor(remaining / 86400);
                        const hours = Math.floor((remaining % 86400) / 3600);
                        const mins = Math.floor((remaining % 3600) / 60);
                        return days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
                      })()
                    : "3 days"}{" "}
                  to stake and confirm. You cannot select another applicant until the offer expires or is rejected.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {applications.map((app) => {
        const canView =
          isClient ||
          (userAddress &&
            app.freelancer.toLowerCase() === userAddress?.toLowerCase());

        const isSelected = selectedFreelancer?.toLowerCase() === app.freelancer.toLowerCase();

        // Determine button state for this applicant
        let buttonContent: React.ReactNode = null;
        if (isClient) {
          if (isSelected && !offerExpired) {
            // Currently selected, waiting for confirmation
            buttonContent = (
              <span className="inline-flex items-center gap-1 text-xs py-1.5 px-3 rounded-lg bg-green-100 text-green-700 font-medium">
                <CheckCircle className="h-3.5 w-3.5" /> Selected
              </span>
            );
          } else if (isSelected && offerExpired) {
            // Selected but expired — show as expired badge
            buttonContent = (
              <span className="inline-flex items-center gap-1 text-xs py-1.5 px-3 rounded-lg bg-gray-100 text-gray-500 font-medium">
                <Clock className="h-3.5 w-3.5" /> Expired
              </span>
            );
          } else if (hasSelection && !offerExpired) {
            // Another freelancer is selected and not expired — disabled
            buttonContent = (
              <button
                disabled
                title="Another freelancer is currently selected. Wait for the offer to expire or be rejected."
                className="btn-secondary text-xs py-1.5 px-3 opacity-50 cursor-not-allowed"
              >
                Select
              </button>
            );
          } else if (hasSelection && offerExpired) {
            // Another freelancer's offer expired — allow reselect
            buttonContent = (
              <button
                onClick={() => {
                  setConfirmTarget(app.freelancer);
                  setConfirmAction("reselect");
                }}
                disabled={isSelecting}
                className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Reselect
              </button>
            );
          } else {
            // No one selected — normal select
            buttonContent = (
              <button
                onClick={() => {
                  setConfirmTarget(app.freelancer);
                  setConfirmAction("select");
                }}
                disabled={isSelecting}
                className="btn-primary text-xs py-1.5 px-3"
              >
                Select
              </button>
            );
          }
        }

        return (
          <div
            key={app.freelancer}
            className={`rounded-lg border p-3 transition-colors ${
              selectedFreelancer?.toLowerCase() === app.freelancer.toLowerCase()
                ? "border-brand-300 bg-brand-50"
                : "border-gray-200 hover:border-gray-300"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100">
                  <User className="h-4 w-4 text-gray-500" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium font-mono">
                      {truncateAddress(app.freelancer)}
                    </p>
                    {reputationData[app.freelancer.toLowerCase()] && (
                      <TierBadge tier={reputationData[app.freelancer.toLowerCase()].tier} />
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-gray-400">
                      Applied {new Date(app.appliedAt * 1000).toLocaleDateString()}
                    </p>
                    {reputationData[app.freelancer.toLowerCase()]?.profile && (
                      <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                        <Star className="h-3 w-3 text-yellow-500" />
                        {Number(
                          reputationData[app.freelancer.toLowerCase()].profile!.reputationScore
                        ).toLocaleString()}
                        <span className="text-gray-300">·</span>
                        {reputationData[app.freelancer.toLowerCase()].profile!.jobsCompleted} jobs
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {canView && app.proposalCID && (
                  <button
                    onClick={() => handleViewProposal(app)}
                    className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1"
                  >
                    <FileText className="h-3.5 w-3.5" /> View Proposal
                  </button>
                )}
                {buttonContent}
              </div>
            </div>

            {/* Inline proposal display */}
            {viewingProposal === app.freelancer && (
              <div className="mt-3 border-t pt-3">
                {proposalLoading && (
                  <div className="flex items-center gap-2 text-gray-400 text-sm py-3">
                    <Loader2 className="h-4 w-4 animate-spin" /> Decrypting proposal…
                  </div>
                )}
                {proposalError && (
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-red-600">{proposalError}</p>
                    <button onClick={() => setViewingProposal(null)}>
                      <X className="h-4 w-4 text-gray-400" />
                    </button>
                  </div>
                )}
                {proposalContent && !proposalLoading && (() => {
                  let parsed: Record<string, unknown> | null = null;
                  try { parsed = JSON.parse(proposalContent); } catch {}
                  return (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-gray-500">Proposal Content</span>
                        <button onClick={() => setViewingProposal(null)}>
                          <X className="h-4 w-4 text-gray-400 hover:text-gray-600" />
                        </button>
                      </div>
                      {parsed ? (
                        <div className="space-y-2 text-sm text-gray-700">
                          {Object.entries(parsed)
                            .filter(([k]) => k !== "applicant" && k !== "submittedAt")
                            .map(([key, value]) => (
                              <div key={key} className="rounded-lg bg-gray-50 p-2">
                                <p className="text-xs text-gray-400 mb-0.5 capitalize">
                                  {key.replace(/([A-Z])/g, " $1")}
                                </p>
                                <p className="break-all text-sm">
                                  {typeof value === "object"
                                    ? JSON.stringify(value, null, 2)
                                    : String(value)}
                                </p>
                              </div>
                            ))}
                        </div>
                      ) : (
                        <pre className="whitespace-pre-wrap break-all text-sm text-gray-700 font-mono bg-gray-50 rounded-lg p-3">
                          {proposalContent}
                        </pre>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        );
      })}

      {/* Confirmation dialog */}
      {confirmTarget && confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="relative w-full max-w-md rounded-xl bg-white shadow-xl p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              {confirmAction === "reselect" ? "Reselect Freelancer?" : "Select Freelancer?"}
            </h3>
            <p className="text-sm text-gray-600 mb-1">
              {confirmAction === "reselect"
                ? "This will replace the expired selection and notify the previously selected freelancer."
                : "This freelancer will be offered the job and given 3 days to stake their deposit and confirm."}
            </p>
            <div className="rounded-lg bg-gray-50 p-3 mb-4">
              <p className="text-xs text-gray-400 mb-0.5">Freelancer Address</p>
              <p className="font-mono text-sm text-gray-700">{confirmTarget}</p>
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => {
                  setConfirmTarget(null);
                  setConfirmAction(null);
                }}
                className="btn-secondary text-sm py-2 px-4"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const target = confirmTarget;
                  const action = confirmAction;
                  setConfirmTarget(null);
                  setConfirmAction(null);
                  if (action === "reselect" && onReselect) {
                    onReselect(target);
                  } else {
                    onSelect(target);
                  }
                }}
                disabled={isSelecting}
                className="btn-primary text-sm py-2 px-4"
              >
                {confirmAction === "reselect" ? "Confirm Reselect" : "Confirm Selection"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
