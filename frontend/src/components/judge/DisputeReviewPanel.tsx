import React, { useState, useEffect, useCallback } from "react";
import {
  Scale,
  Key,
  FileText,
  Lock,
  Unlock,
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
} from "lucide-react";
import { ethers } from "ethers";
import toast from "react-hot-toast";
import { useDispute } from "../../hooks/useDispute";
import { useContracts } from "../../contexts/ContractContext";
import { useWallet } from "../../contexts/WalletContext";
import { EvidenceDecryptor } from "./EvidenceDecryptor";
import { RulingForm } from "./RulingForm";
import { DisputePhaseBadge } from "../common/StatusBadge";
import { CountdownTimer } from "../job/CountdownTimer";
import { TransactionButton } from "../common/TransactionButton";
import { truncateAddress, formatUSDC } from "../../utils/format";
import { DisputePhase, Ruling, DISPUTE_PHASE_LABELS } from "../../config/constants";
import { decryptWithPrivateKey, hexToEncryptedKey } from "../../crypto/keyExchange";
import { retrieveFromIPFS, retrieveBinaryFromIPFS } from "../../ipfs/gateway";
import { decrypt } from "../../crypto/aes";
import { hexToBuffer } from "../../crypto/jobKey";
import type { DisputeDetails, DisputeDeadlines, EvidenceItem } from "../../hooks/useDispute";

// ─── Types ───

interface DisputeReviewPanelProps {
  disputeId: number;
  onRefresh?: () => void;
}

// ─── Component ───

export function DisputeReviewPanel({ disputeId, onRefresh }: DisputeReviewPanelProps) {
  const { address } = useWallet();
  const { readContracts } = useContracts();
  const {
    fetchDisputeDetails,
    fetchDisputeDeadlines,
    fetchEvidence,
    fetchEncryptedKey,
  } = useDispute();

  // State
  const [details, setDetails] = useState<DisputeDetails | null>(null);
  const [deadlines, setDeadlines] = useState<DisputeDeadlines | null>(null);
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [jobKeyHex, setJobKeyHex] = useState<string | null>(null);
  const [decryptingKey, setDecryptingKey] = useState(false);
  const [decryptedAgreement, setDecryptedAgreement] = useState<string | null>(null);
  const [decryptedDeliverable, setDecryptedDeliverable] = useState<string | null>(null);
  const [loadingAgreement, setLoadingAgreement] = useState(false);
  const [loadingDeliverable, setLoadingDeliverable] = useState(false);

  // Fetch all data for this dispute
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [d, dl, ev] = await Promise.all([
        fetchDisputeDetails(disputeId),
        fetchDisputeDeadlines(disputeId),
        fetchEvidence(disputeId),
      ]);
      setDetails(d);
      setDeadlines(dl);
      setEvidence(ev);
    } catch (err) {
      console.error("Failed to load dispute data:", err);
    } finally {
      setLoading(false);
    }
  }, [disputeId, fetchDisputeDetails, fetchDisputeDeadlines, fetchEvidence]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Decrypt the job key from one of the party's encrypted submissions
  const handleDecryptJobKey = async () => {
    if (!details || !address) return;

    setDecryptingKey(true);
    try {
      // Try client's key first, then freelancer's
      let encryptedKeyHex = await fetchEncryptedKey(disputeId, details.client);
      let senderAddress = details.client;

      if (!encryptedKeyHex || encryptedKeyHex === "0x") {
        encryptedKeyHex = await fetchEncryptedKey(disputeId, details.freelancer);
        senderAddress = details.freelancer;
      }

      if (!encryptedKeyHex || encryptedKeyHex === "0x") {
        toast.error("No encrypted keys available yet.");
        setDecryptingKey(false);
        return;
      }

      const encryptedBytes = hexToEncryptedKey(encryptedKeyHex);
      // The judge decrypts using their own address as the recipient
      // because the party encrypted for the judge's address
      const decryptedKey = await decryptWithPrivateKey(encryptedBytes, address);
      setJobKeyHex(decryptedKey);
      toast.success("Job key decrypted!");
    } catch (err) {
      console.error("Failed to decrypt job key:", err);
      toast.error("Failed to decrypt job key. Ensure you are the assigned judge.");
    } finally {
      setDecryptingKey(false);
    }
  };

  // Decrypt agreement
  const handleDecryptAgreement = async () => {
    if (!jobKeyHex || !details || !readContracts.dataAvailability) return;

    setLoadingAgreement(true);
    try {
      // Agreement CID is stored in DataAvailability, NOT in the Job struct.
      // Fetch via getJobCIDs → getCIDRecord (same approach as JobDetail.tsx).
      const cidHashes: string[] = await readContracts.dataAvailability.getJobCIDs(details.jobId);
      let agreementCID: string | null = null;
      if (cidHashes.length > 0) {
        const record = await readContracts.dataAvailability.getCIDRecord(cidHashes[0]);
        agreementCID = record.cid as string;
      }

      if (!agreementCID) {
        setDecryptedAgreement("(No agreement CID found)");
        setLoadingAgreement(false);
        return;
      }

      // Try to fetch as text first to detect JSON envelope format
      const rawText = await retrieveFromIPFS(agreementCID);
      let encrypted: Uint8Array | null = null;

      try {
        const parsed = JSON.parse(rawText);
        // Handle Pinata-wrapped response
        const content = parsed.pinataContent ?? parsed;

        if (content.version && content.encrypted) {
          // New envelope format: { version, salt, encrypted (hex) }
          encrypted = hexToBuffer(content.encrypted);
        } else if (content.iv && content.ciphertext) {
          // Legacy JSON encrypted format {iv, ciphertext}
          const decrypted = await decrypt(content, jobKeyHex);
          setDecryptedAgreement(decrypted);
          return;
        } else {
          // Unknown JSON format — try binary fallback
          encrypted = await retrieveBinaryFromIPFS(agreementCID);
        }
      } catch {
        // Not JSON — legacy raw binary format (IV || ciphertext)
        encrypted = await retrieveBinaryFromIPFS(agreementCID);
      }

      if (encrypted) {
        const decrypted = await decrypt(encrypted, jobKeyHex);
        setDecryptedAgreement(decrypted);
      }
    } catch (err) {
      console.error("Failed to decrypt agreement:", err);
      toast.error("Failed to load agreement");
    } finally {
      setLoadingAgreement(false);
    }
  };

  // Decrypt deliverable
  const handleDecryptDeliverable = async () => {
    if (!jobKeyHex || !details || !readContracts.jobEscrow) return;

    setLoadingDeliverable(true);
    try {
      const milestones = await readContracts.jobEscrow.getMilestones(details.jobId);
      const ms = milestones[details.milestoneIdx];
      // Milestone struct: [0]=value, [1]=deadline, [2]=submittedAt, [3]=resolvedAt,
      // [4]=deliverableHash, [5]=deliverableCID, [6]=status, [7]=fundsProcessed
      const deliverableCID = ms.deliverableCID || ms[5];

      if (!deliverableCID) {
        setDecryptedDeliverable("(No deliverable submitted)");
        setLoadingDeliverable(false);
        return;
      }

      // Try to fetch as text first to detect JSON envelope format
      const rawText = await retrieveFromIPFS(deliverableCID);
      let encrypted: Uint8Array | null = null;

      try {
        const parsed = JSON.parse(rawText);
        const content = parsed.pinataContent ?? parsed;
        if (content.version && content.encrypted) {
          // New envelope format: { version, salt, encrypted (hex) }
          encrypted = hexToBuffer(content.encrypted);
        } else if (content.iv && content.ciphertext) {
          // Legacy JSON encrypted format {iv, ciphertext}
          const decrypted = await decrypt(content, jobKeyHex);
          setDecryptedDeliverable(decrypted);
          return;
        } else {
          // Unknown JSON format — try binary fallback
          encrypted = await retrieveBinaryFromIPFS(deliverableCID);
        }
      } catch {
        // Not JSON — raw binary format (IV || ciphertext)
        encrypted = await retrieveBinaryFromIPFS(deliverableCID);
      }

      if (encrypted) {
        const decrypted = await decrypt(encrypted, jobKeyHex);
        setDecryptedDeliverable(decrypted);
      }
    } catch (err) {
      console.error("Failed to decrypt deliverable:", err);
      toast.error("Failed to load deliverable");
    } finally {
      setLoadingDeliverable(false);
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="card text-center py-12 text-gray-400">
        <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
        Loading dispute details...
      </div>
    );
  }

  if (!details || !deadlines) {
    return (
      <div className="card text-center py-12 text-gray-400">
        Failed to load dispute data.
      </div>
    );
  }

  // G-12: Least-privilege CID filtering for the judge.
  // Only three categories of CIDs are exposed to the judge:
  //   1. Agreement CID   — fetched from `jobs(jobId).agreementCID`
  //   2. Deliverable CID — fetched from `getMilestones(jobId)[milestoneIdx]`
  //      (scoped to the disputed milestone only; other milestones' deliverables are never loaded)
  //   3. Evidence CIDs   — fetched from `fetchEvidence(disputeId)`
  //      (already scoped to this dispute by the contract)
  const evidenceForDecryptor = evidence.map((ev) => ({
    submitter: ev.submitter,
    evidenceCID: ev.evidenceCID,
    submittedAt: ev.submittedAt,
    isClient: ev.submitter.toLowerCase() === details.client.toLowerCase(),
  }));

  return (
    <div className="space-y-6 mt-6">
      {/* ─── Header ─── */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <Scale className="h-6 w-6 text-indigo-600" />
              Dispute #{disputeId} — Job #{details.jobId}, Milestone{" "}
              {details.milestoneIdx + 1}
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              Milestone value: {formatUSDC(details.milestoneValue)}
            </p>
          </div>
          <DisputePhaseBadge phase={details.phase} />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div>
            <p className="text-xs text-gray-400">Initiator</p>
            <p className="font-mono text-gray-700">{truncateAddress(details.initiator)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Client</p>
            <p className="font-mono text-gray-700">{truncateAddress(details.client)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Freelancer</p>
            <p className="font-mono text-gray-700">{truncateAddress(details.freelancer)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Judge</p>
            <p className="font-mono text-gray-700">
              {details.judge === ethers.ZeroAddress
                ? "Not assigned"
                : truncateAddress(details.judge)}
            </p>
          </div>
        </div>
      </div>

      {/* ─── Deadline Countdowns ─── */}
      <div className="card">
        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5 mb-3">
          <Clock className="h-4 w-4" />
          Deadlines
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {deadlines.evidenceDeadline > 0 && (
            <div className="rounded-lg bg-gray-50 p-3">
              <p className="text-xs text-gray-500 mb-1">Evidence Deadline</p>
              <CountdownTimer targetTimestamp={deadlines.evidenceDeadline} label="" />
            </div>
          )}
          {deadlines.keyDistributionDeadline > 0 && (
            <div className="rounded-lg bg-gray-50 p-3">
              <p className="text-xs text-gray-500 mb-1">Key Distribution Deadline</p>
              <CountdownTimer targetTimestamp={deadlines.keyDistributionDeadline} label="" />
            </div>
          )}
          {deadlines.rulingDeadline > 0 && (
            <div className="rounded-lg bg-gray-50 p-3">
              <p className="text-xs text-gray-500 mb-1">Ruling Deadline</p>
              <CountdownTimer targetTimestamp={deadlines.rulingDeadline} label="" />
            </div>
          )}
        </div>
      </div>

      {/* ─── Key Decryption ─── */}
      {(details.phase === DisputePhase.KeyDistribution ||
        details.phase === DisputePhase.UnderReview ||
        details.phase === DisputePhase.Ruled) && (
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5 mb-3">
            <Key className="h-4 w-4" />
            Key Status & Decryption
          </h3>

          <div className="flex gap-4 text-sm mb-4">
            <span className="flex items-center gap-1">
              {details.clientKeySubmitted ? (
                <CheckCircle className="h-4 w-4 text-green-500" />
              ) : (
                <XCircle className="h-4 w-4 text-red-400" />
              )}
              Client key: {details.clientKeySubmitted ? "Received" : "Pending"}
            </span>
            <span className="flex items-center gap-1">
              {details.freelancerKeySubmitted ? (
                <CheckCircle className="h-4 w-4 text-green-500" />
              ) : (
                <XCircle className="h-4 w-4 text-red-400" />
              )}
              Freelancer key: {details.freelancerKeySubmitted ? "Received" : "Pending"}
            </span>
          </div>

          {jobKeyHex ? (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-center gap-2 text-sm text-green-800">
              <Unlock className="h-4 w-4" />
              🔓 Job key decrypted — you can now view encrypted content below.
            </div>
          ) : (
            <TransactionButton
              onClick={handleDecryptJobKey}
              isLoading={decryptingKey}
              disabled={!details.clientKeySubmitted && !details.freelancerKeySubmitted}
              variant="primary"
            >
              <Key className="mr-2 h-4 w-4" />
              Decrypt Job Key
            </TransactionButton>
          )}
        </div>
      )}

      {/* ─── Agreement ─── */}
      {jobKeyHex && (
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5 mb-3">
            <FileText className="h-4 w-4" />
            Agreement
          </h3>
          {decryptedAgreement ? (
            <pre className="max-h-60 overflow-auto rounded bg-gray-50 p-3 text-xs text-gray-700 border whitespace-pre-wrap">
              {decryptedAgreement}
            </pre>
          ) : (
            <button
              onClick={handleDecryptAgreement}
              disabled={loadingAgreement}
              className="btn-secondary text-sm"
            >
              {loadingAgreement ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Unlock className="h-4 w-4 mr-1" />
              )}
              Decrypt Agreement
            </button>
          )}
        </div>
      )}

      {/* ─── Deliverable (disputed milestone only — G-12 least-privilege) ─── */}
      {jobKeyHex && (
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5 mb-3">
            <FileText className="h-4 w-4" />
            Deliverable
          </h3>
          {decryptedDeliverable ? (
            <pre className="max-h-60 overflow-auto rounded bg-gray-50 p-3 text-xs text-gray-700 border whitespace-pre-wrap">
              {decryptedDeliverable}
            </pre>
          ) : (
            <button
              onClick={handleDecryptDeliverable}
              disabled={loadingDeliverable}
              className="btn-secondary text-sm"
            >
              {loadingDeliverable ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Unlock className="h-4 w-4 mr-1" />
              )}
              Decrypt Deliverable
            </button>
          )}
        </div>
      )}

      {/* ─── Evidence ─── */}
      <div className="card">
        <EvidenceDecryptor evidenceItems={evidenceForDecryptor} jobKeyHex={jobKeyHex} />
      </div>

      {/* ─── Ruling Form ─── */}
      {(details.phase === DisputePhase.UnderReview ||
        details.phase === DisputePhase.Ruled ||
        details.phase === DisputePhase.Executed) && (
        <RulingForm
          disputeId={disputeId}
          phase={details.phase}
          onRulingSubmitted={() => {
            loadData();
            onRefresh?.();
          }}
          onRulingExecuted={() => {
            loadData();
            onRefresh?.();
          }}
        />
      )}

      {/* ─── Ruling Result (if already ruled) ─── */}
      {(details.phase === DisputePhase.Ruled || details.phase === DisputePhase.Executed) &&
        details.ruling !== Ruling.Inconclusive && (
          <div className="card">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Ruling Details</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-gray-400">Outcome</p>
                <p className="font-medium">
                  {details.ruling === Ruling.FreelancerWins
                    ? "Freelancer Wins"
                    : details.ruling === Ruling.ClientWins
                    ? "Client Wins"
                    : "Inconclusive"}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Freelancer Share</p>
                <p className="font-medium">{formatUSDC(details.milestoneValue * BigInt(details.freelancerShareBps) / 10000n)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Deposit Slash</p>
                <p className="font-medium">{details.depositSlashBps} BPS</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Status</p>
                <p className="font-medium">
                  {details.phase === DisputePhase.Executed ? "✅ Executed" : "⏳ Awaiting Execution"}
                </p>
              </div>
            </div>
          </div>
        )}
    </div>
  );
}
