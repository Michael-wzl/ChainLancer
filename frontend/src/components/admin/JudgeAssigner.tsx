import React, { useState } from "react";
import {
  Gavel,
  ChevronRight,
  Loader2,
  Clock,
} from "lucide-react";
import { ethers } from "ethers";
import toast from "react-hot-toast";
import { useAdmin, type PendingDispute } from "../../hooks/useAdmin";
import { useDispute } from "../../hooks/useDispute";
import { useContracts } from "../../contexts/ContractContext";
import { TransactionButton } from "../common/TransactionButton";
import { truncateAddress, formatUSDC } from "../../utils/format";
import { DisputePhase } from "../../config/constants";

// ─── Types ───

interface JudgeAssignerProps {
  pendingDisputes: PendingDispute[];
  onAssigned: () => void;
}

// ─── Component ───

export function JudgeAssigner({ pendingDisputes, onAssigned }: JudgeAssignerProps) {
  const { assignJudge, loading } = useAdmin();
  const { closeEvidencePhase } = useDispute();
  const { readContracts } = useContracts();

  const [forms, setForms] = useState<
    Record<number, { judgeAddress: string }>
  >({});
  const [assigningId, setAssigningId] = useState<number | null>(null);
  const [closingId, setClosingId] = useState<number | null>(null);

  const updateForm = (
    disputeId: number,
    value: string
  ) => {
    setForms((prev) => ({
      ...prev,
      [disputeId]: { judgeAddress: value },
    }));
  };

  /** Fetch the judge's registered encryption public key from the contract */
  const fetchJudgePubKey = async (judgeAddr: string): Promise<string | null> => {
    if (!readContracts.jobEscrow) return null;
    try {
      const pubKey: string = await readContracts.jobEscrow.encryptionPubKeys(judgeAddr);
      if (!pubKey || pubKey === "0x" || pubKey.length < 4) return null;
      return pubKey;
    } catch {
      return null;
    }
  };

  const handleAssign = async (disputeId: number) => {
    const form = forms[disputeId];
    if (!form || !form.judgeAddress) {
      toast.error("Please enter a judge address");
      return;
    }

    if (!ethers.isAddress(form.judgeAddress)) {
      toast.error("Invalid judge address");
      return;
    }

    // Fetch the judge's registered encryption public key
    const judgePubKey = await fetchJudgePubKey(form.judgeAddress);
    if (!judgePubKey) {
      toast.error(
        "Judge has not registered an encryption key. The judge must visit the Judge Dashboard and register their key first."
      );
      return;
    }

    setAssigningId(disputeId);
    try {
      await assignJudge(disputeId, form.judgeAddress, judgePubKey);
      // Clear the form
      setForms((prev) => {
        const next = { ...prev };
        delete next[disputeId];
        return next;
      });
      onAssigned();
    } catch {
      // Error already toasted by useAdmin
    } finally {
      setAssigningId(null);
    }
  };

  const handleCloseEvidence = async (disputeId: number) => {
    setClosingId(disputeId);
    try {
      await closeEvidencePhase(disputeId);
      onAssigned(); // Refresh the list — dispute will now be in AwaitingJudge phase
    } catch {
      // Error already toasted by useDispute
    } finally {
      setClosingId(null);
    }
  };

  if (pendingDisputes.length === 0) {
    return (
      <div className="text-center py-10 bg-gray-50 rounded-lg border border-gray-100 border-dashed">
        <Gavel className="h-10 w-10 text-gray-300 mx-auto mb-3" />
        <p className="text-sm font-medium text-gray-500">
          No disputes currently awaiting a judge.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <Gavel className="h-5 w-5 text-indigo-600" />
        <h3 className="text-lg font-bold text-gray-900">
          Disputes Awaiting Judge
        </h3>
        <span className="ml-1 bg-indigo-100 text-indigo-800 py-0.5 px-2.5 rounded-full text-xs font-semibold">
          {pendingDisputes.length}
        </span>
      </div>

      {pendingDisputes.map((d) => (
        <div
          key={d.disputeId}
          className="border border-gray-200 rounded-xl overflow-hidden transition hover:shadow-sm"
        >
          {/* Header */}
          <div className="bg-gray-50 p-4 border-b border-gray-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h4 className="font-bold text-gray-900 flex items-center gap-2">
                Dispute #{d.disputeId}
                <ChevronRight className="h-4 w-4 text-gray-400" />
                Job #{d.jobId} (Milestone {d.milestoneIdx + 1})
              </h4>
              <div className="mt-1.5 flex items-center gap-4 text-xs text-gray-500">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-blue-500" />
                  C:{" "}
                  <span className="font-mono">
                    {truncateAddress(d.client)}
                  </span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-purple-500" />
                  F:{" "}
                  <span className="font-mono">
                    {truncateAddress(d.freelancer)}
                  </span>
                </span>
              </div>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-xs font-medium text-gray-500 uppercase">
                Milestone Value
              </span>
              <span className="font-bold text-gray-900">
                {formatUSDC(d.milestoneValue)}
              </span>
            </div>
          </div>

          {/* Form */}
          <div className="p-4 bg-white">
            {d.phase === DisputePhase.Evidence ? (
              /* Evidence deadline expired — admin must close evidence phase first */
              <div className="space-y-3">
                <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200">
                  <Clock className="h-4 w-4 text-amber-600 flex-shrink-0" />
                  <p className="text-sm text-amber-800">
                    Evidence deadline has expired. Close the evidence phase first before assigning a judge.
                  </p>
                </div>
                <TransactionButton
                  onClick={() => handleCloseEvidence(d.disputeId)}
                  isLoading={closingId === d.disputeId}
                  variant="primary"
                  className="w-full justify-center"
                >
                  <Clock className="mr-1.5 h-4 w-4" /> Close Evidence Phase
                </TransactionButton>
              </div>
            ) : (
              /* AwaitingJudge — show judge assignment form */
              <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-end">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Judge Address
                  </label>
                  <input
                    type="text"
                    placeholder="0x..."
                    className="input text-sm font-mono placeholder-gray-300"
                    value={forms[d.disputeId]?.judgeAddress || ""}
                    onChange={(e) =>
                      updateForm(d.disputeId, e.target.value)
                    }
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    Judge must have registered their encryption key first
                  </p>
                </div>
                <div>
                  <TransactionButton
                    onClick={() => handleAssign(d.disputeId)}
                    isLoading={assigningId === d.disputeId}
                    variant="primary"
                    className="w-full whitespace-nowrap"
                  >
                    Assign Judge
                  </TransactionButton>
                </div>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
