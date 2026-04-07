import React, { useState } from "react";
import {
  Key,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Clock,
  Loader2,
} from "lucide-react";
import toast from "react-hot-toast";
import { useDispute } from "../../hooks/useDispute";
import { useContracts } from "../../contexts/ContractContext";
import { useWallet } from "../../contexts/WalletContext";
import { TransactionButton } from "../common/TransactionButton";
import { CountdownTimer } from "../job/CountdownTimer";
import { getJobKey } from "../../utils/storage";
import { encryptForRecipient } from "../../crypto/keyExchange";

// ─── Types ───

interface KeyDistributionPanelProps {
  disputeId: number;
  judgeAddress: string;
  isClientKeySubmitted: boolean;
  isFreelancerKeySubmitted: boolean;
  keyDistributionDeadline: number;
  jobId: number;
  userRole: "client" | "freelancer" | "none";
  onKeyDistributed: () => void;
  /** Current blockchain timestamp in seconds (from useBlockTimestamp) */
  blockNow?: number;
}

// ─── Component ───

export function KeyDistributionPanel({
  disputeId,
  judgeAddress,
  isClientKeySubmitted,
  isFreelancerKeySubmitted,
  keyDistributionDeadline,
  jobId,
  userRole,
  onKeyDistributed,
  blockNow: blockNowProp,
}: KeyDistributionPanelProps) {
  const { distributeKeyToJudge, claimKeyDefault, loading } = useDispute();
  const { readContracts } = useContracts();
  const { address } = useWallet();
  const [submitting, setSubmitting] = useState(false);
  const [claiming, setClaiming] = useState(false);

  const now = blockNowProp ?? Math.floor(Date.now() / 1000);
  const deadlinePassed = keyDistributionDeadline > 0 && now > keyDistributionDeadline;
  const aMissing = !isClientKeySubmitted || !isFreelancerKeySubmitted;

  const hasAlreadySubmitted =
    (userRole === "client" && isClientKeySubmitted) ||
    (userRole === "freelancer" && isFreelancerKeySubmitted);

  const canSubmitKey = userRole !== "none" && !hasAlreadySubmitted;
  const canClaimDefault = deadlinePassed && aMissing;

  const handleDistributeKey = async () => {
    const keyHex = getJobKey(jobId, address ?? undefined);
    if (!keyHex) {
      toast.error("No decryption key found for this job in local storage.");
      return;
    }

    setSubmitting(true);
    try {
      // Look up the judge's encryption public key from the contract
      if (!readContracts.jobEscrow) {
        toast.error("Contract not ready.");
        return;
      }
      const judgePubKey: string = await readContracts.jobEscrow.encryptionPubKeys(judgeAddress);
      if (!judgePubKey || judgePubKey === "0x") {
        toast.error("Judge has not registered an encryption key.");
        return;
      }
      const encryptedKey = await encryptForRecipient(keyHex, judgePubKey);
      await distributeKeyToJudge(disputeId, encryptedKey);
      onKeyDistributed();
    } catch {
      // Error toasted by useDispute
    } finally {
      setSubmitting(false);
    }
  };

  const handleClaimDefault = async () => {
    setClaiming(true);
    try {
      await claimKeyDefault(disputeId);
      onKeyDistributed();
    } catch {
      // Error toasted by useDispute
    } finally {
      setClaiming(false);
    }
  };

  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
        <Key className="h-4 w-4" /> Key Distribution
      </h3>

      <p className="text-sm text-gray-500 mb-3">
        Submit your decryption key so the judge can review the deliverables.
      </p>

      {/* Deadline countdown */}
      {keyDistributionDeadline > 0 && (
        <div className="mb-4">
          <CountdownTimer
            targetTimestamp={keyDistributionDeadline}
            label="Key distribution deadline"
            expiredLabel="Deadline passed"
          />
        </div>
      )}

      {/* Key status */}
      <div className="flex gap-4 text-sm mb-4">
        <span className="flex items-center gap-1">
          {isClientKeySubmitted ? (
            <CheckCircle className="h-4 w-4 text-green-500" />
          ) : (
            <XCircle className="h-4 w-4 text-red-400" />
          )}
          Client key: {isClientKeySubmitted ? "Submitted" : "Pending"}
        </span>
        <span className="flex items-center gap-1">
          {isFreelancerKeySubmitted ? (
            <CheckCircle className="h-4 w-4 text-green-500" />
          ) : (
            <XCircle className="h-4 w-4 text-red-400" />
          )}
          Freelancer key: {isFreelancerKeySubmitted ? "Submitted" : "Pending"}
        </span>
      </div>

      {/* Submit key button */}
      {canSubmitKey && (
        <TransactionButton
          onClick={handleDistributeKey}
          isLoading={submitting}
          variant="primary"
          className="mb-3"
        >
          <Key className="mr-1.5 h-4 w-4" />
          Distribute Key to Judge
        </TransactionButton>
      )}

      {hasAlreadySubmitted && (
        <p className="text-sm text-green-600 flex items-center gap-1 mb-3">
          <CheckCircle className="h-4 w-4" />
          You have already submitted your key.
        </p>
      )}

      {/* Claim key default button */}
      {canClaimDefault && (
        <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
          <p className="text-sm text-yellow-800 mb-2 flex items-center gap-1">
            <AlertTriangle className="h-4 w-4" />
            Deadline has passed and{" "}
            {!isClientKeySubmitted && !isFreelancerKeySubmitted
              ? "neither party"
              : !isClientKeySubmitted
              ? "the client"
              : "the freelancer"}{" "}
            has not submitted their key.
          </p>
          <TransactionButton
            onClick={handleClaimDefault}
            isLoading={claiming}
            variant="danger"
          >
            <AlertTriangle className="mr-1.5 h-4 w-4" />
            Claim Key Default
          </TransactionButton>
        </div>
      )}
    </div>
  );
}
