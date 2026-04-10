import React, { useState, useEffect } from "react";
import { Gavel, AlertTriangle, CheckCircle, Play } from "lucide-react";
import { ethers } from "ethers";
import { useDispute } from "../../hooks/useDispute";
import { TransactionButton } from "../common/TransactionButton";
import { DisputePhase, Ruling } from "../../config/constants";
import { formatBps } from "../../utils/format";
import toast from "react-hot-toast";

// ─── Types ───

interface RulingFormProps {
  disputeId: number;
  phase: DisputePhase;
  onRulingSubmitted: () => void;
  onRulingExecuted: () => void;
}

// ─── Component ───

export function RulingForm({
  disputeId,
  phase,
  onRulingSubmitted,
  onRulingExecuted,
}: RulingFormProps) {
  const { submitRuling, executeRuling, loading } = useDispute();

  const [ruling, setRuling] = useState<Ruling>(Ruling.Inconclusive);
  const [freelancerShareBps, setFreelancerShareBps] = useState(5000);
  const [depositSlashBps, setDepositSlashBps] = useState(0);
  const [reasoning, setReasoning] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  // Auto-fill defaults when ruling changes
  useEffect(() => {
    switch (ruling) {
      case Ruling.FreelancerWins:
        setFreelancerShareBps(10000);
        setDepositSlashBps(0);
        break;
      case Ruling.ClientWins:
        setFreelancerShareBps(0);
        setDepositSlashBps(2500);
        break;
      case Ruling.Inconclusive:
        setFreelancerShareBps(5000);
        setDepositSlashBps(0);
        break;
    }
  }, [ruling]);

  // Validate inputs
  useEffect(() => {
    if (freelancerShareBps < 0 || freelancerShareBps > 10000) {
      setValidationError("Freelancer share must be between 0 and 10000 BPS");
      return;
    }
    if (depositSlashBps < 0 || depositSlashBps > 5000) {
      setValidationError("Deposit slash must be between 0 and 5000 BPS (max 50%)");
      return;
    }
    if (ruling === Ruling.FreelancerWins && freelancerShareBps <= 5000) {
      setValidationError("Freelancer wins: share must be >50% (>5000 BPS)");
      return;
    }
    if (ruling === Ruling.ClientWins && freelancerShareBps >= 5000) {
      setValidationError("Client wins: freelancer share must be <50% (<5000 BPS)");
      return;
    }
    if (reasoning.trim().length < 10) {
      setValidationError("Reasoning must be at least 10 characters");
      return;
    }
    setValidationError(null);
  }, [ruling, freelancerShareBps, depositSlashBps, reasoning]);

  const handleSubmitRuling = async () => {
    if (validationError) {
      toast.error(validationError);
      return;
    }

    try {
      const reasoningHash = ethers.keccak256(ethers.toUtf8Bytes(reasoning));

      // FE-6 fix: Persist the ruling reasoning to IPFS (encrypted if possible)
      // so there is an auditable record of the judge's rationale.
      try {
        const { uploadJSON } = await import("../../ipfs/pinata");
        const reasoningDoc = {
          disputeId,
          ruling,
          reasoning,
          reasoningHash,
          timestamp: Date.now(),
        };
        const cid = await uploadJSON(reasoningDoc, `ruling-reasoning-${disputeId}-${Date.now()}`);
        console.log("Ruling reasoning persisted to IPFS:", cid);
      } catch (ipfsErr) {
        // Non-blocking: reasoning hash still goes on-chain even if IPFS fails
        console.warn("Failed to persist ruling reasoning to IPFS:", ipfsErr);
      }

      await submitRuling(
        disputeId,
        ruling,
        reasoningHash,
        freelancerShareBps,
        depositSlashBps
      );
      onRulingSubmitted();
    } catch {
      // Error already handled in hook
    }
  };

  const handleExecuteRuling = async () => {
    try {
      await executeRuling(disputeId);
      onRulingExecuted();
    } catch {
      // Error already handled in hook
    }
  };

  // Phase: UnderReview → show ruling form
  if (phase === DisputePhase.UnderReview) {
    return (
      <div className="card border-t-4 border-t-indigo-500">
        <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2 mb-4">
          <Gavel className="h-5 w-5 text-indigo-600" />
          Submit Ruling
        </h3>

        <div className="space-y-4">
          {/* Ruling outcome */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Ruling Outcome
            </label>
            <select
              value={ruling}
              onChange={(e) => setRuling(Number(e.target.value) as Ruling)}
              className="input"
            >
              <option value={Ruling.Inconclusive}>Inconclusive (50/50 split)</option>
              <option value={Ruling.FreelancerWins}>Freelancer Wins</option>
              <option value={Ruling.ClientWins}>Client Wins</option>
            </select>
          </div>

          {/* Freelancer share */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Freelancer Share (BPS)
              <span className="ml-2 text-xs text-gray-400">
                = {formatBps(freelancerShareBps)} of milestone value
              </span>
            </label>
            <input
              type="number"
              min={0}
              max={10000}
              value={freelancerShareBps}
              onChange={(e) => setFreelancerShareBps(Number(e.target.value))}
              className="input"
            />
            <p className="text-xs text-gray-400 mt-1">
              0 = 100% to client, 10000 = 100% to freelancer
            </p>
          </div>

          {/* Deposit slash */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Deposit Slash (BPS)
              <span className="ml-2 text-xs text-gray-400">
                = {formatBps(depositSlashBps)} of freelancer deposit
              </span>
            </label>
            <input
              type="number"
              min={0}
              max={5000}
              value={depositSlashBps}
              onChange={(e) => setDepositSlashBps(Number(e.target.value))}
              className="input"
            />
            <p className="text-xs text-gray-400 mt-1">
              Max 5000 BPS (50%). Only applicable when client wins.
            </p>
          </div>

          {/* Reasoning */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Reasoning
            </label>
            <textarea
              value={reasoning}
              onChange={(e) => setReasoning(e.target.value)}
              rows={4}
              placeholder="Provide detailed reasoning for your ruling (min 10 characters)..."
              className="input resize-y"
            />
            <p className="text-xs text-gray-400 mt-1">
              Reasoning hash will be stored on-chain. Full text is not persisted.
            </p>
          </div>

          {/* Validation error */}
          {validationError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2 text-sm text-red-700">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              {validationError}
            </div>
          )}

          {/* Submit button */}
          <TransactionButton
            onClick={handleSubmitRuling}
            isLoading={loading}
            disabled={!!validationError}
            variant="primary"
            className="w-full justify-center"
          >
            <Gavel className="mr-2 h-4 w-4" />
            Submit Ruling
          </TransactionButton>
        </div>
      </div>
    );
  }

  // Phase: Ruled → show execute button
  if (phase === DisputePhase.Ruled) {
    return (
      <div className="card border-t-4 border-t-green-500">
        <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2 mb-4">
          <CheckCircle className="h-5 w-5 text-green-600" />
          Ruling Submitted
        </h3>
        <p className="text-sm text-gray-600 mb-4">
          The ruling has been submitted and is awaiting execution. Execute the
          ruling to redistribute funds according to the decision.
        </p>
        <TransactionButton
          onClick={handleExecuteRuling}
          isLoading={loading}
          variant="success"
          className="w-full justify-center"
        >
          <Play className="mr-2 h-4 w-4" />
          Execute Ruling
        </TransactionButton>
      </div>
    );
  }

  // Phase: Executed → show completed
  if (phase === DisputePhase.Executed) {
    return (
      <div className="card border-t-4 border-t-gray-400">
        <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2 mb-2">
          <CheckCircle className="h-5 w-5 text-gray-400" />
          Ruling Executed
        </h3>
        <p className="text-sm text-gray-600">
          Funds have been redistributed according to the ruling. This dispute is closed.
        </p>
      </div>
    );
  }

  // Other phases: ruling not yet available
  return null;
}
