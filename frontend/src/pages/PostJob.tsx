import React, { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ethers } from "ethers";
import { PlusCircle, Trash2, Info, Upload } from "lucide-react";
import toast from "react-hot-toast";
import { useWallet } from "../contexts/WalletContext";
import { useContracts } from "../contexts/ContractContext";
import { useJobEscrow } from "../hooks/useJobEscrow";
import { useMockUSDC } from "../hooks/useMockUSDC";
import { useReputation } from "../hooks/useReputation";
import { TransactionButton } from "../components/common/TransactionButton";
import { generateJobKey, generateSalt, bufferToHex } from "../crypto/jobKey";
import { encrypt } from "../crypto/aes";
import { computeAgreementHash } from "../crypto/hash";
import { recoverPublicKey } from "../crypto/ecies";
import { uploadFile } from "../ipfs/pinata";
import { parseContractError } from "../utils/errors";
import { storeJobKey } from "../utils/storage";
import { storeJobTitle } from "../utils/storage";
import { getBlockTimestamp } from "../hooks/useBlockTimestamp";
import { parseUSDC, formatUSDC } from "../utils/format";
import { getContractAddresses } from "../config/contracts";
import JobEscrowABI from "../abis/JobEscrow.json";
import {
  REVIEW_TIMEOUT_OPTIONS,
  PROTOCOL_FEE_BPS,
  FREELANCER_DEPOSIT_BPS,
  BEHAVIOR_BOND_BPS,
  Tier,
} from "../config/constants";

import { Wallet as WalletIcon } from "lucide-react";
import { NotebookPen as PostJobIcon } from "lucide-react";

interface MilestoneInput {
  description: string;
  value: string;
  deadlineDays: string;
}

export default function PostJob() {
  const navigate = useNavigate();
  const { address, isConnected } = useWallet();
  const { contracts } = useContracts();
  const { postJob, registerEncryptionKey, isLoading } = useJobEscrow();
  const { approveJobEscrow, isLoading: approveLoading } = useMockUSDC();
  const { getClientTier } = useReputation();

  // ─── Client tier for bond calculation ───
  const [clientTier, setClientTier] = useState<Tier>(Tier.New);
  React.useEffect(() => {
    if (address) {
      getClientTier(address).then(setClientTier);
    }
  }, [address, getClientTier]);

  // ─── Form state ───
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [requirements, setRequirements] = useState("");
  const [reviewTimeout, setReviewTimeout] = useState(
    REVIEW_TIMEOUT_OPTIONS[2].value,
  ); // 7 days default
  const [milestones, setMilestones] = useState<MilestoneInput[]>([
    { description: "Milestone 1", value: "1000", deadlineDays: "30" },
  ]);

  // ─── Derived values ───
  const totalValue = milestones.reduce((sum, ms) => {
    try {
      return sum + parseUSDC(ms.value || "0");
    } catch {
      return sum;
    }
  }, 0n);

  const tierKey = (["New", "Bronze", "Silver", "Gold"] as const)[clientTier];
  const bondBps = BEHAVIOR_BOND_BPS[tierKey];
  const behaviorBond = (totalValue * BigInt(bondBps)) / 10000n;
  const totalRequired = totalValue + behaviorBond;

  // ─── Milestone management ───
  const addMilestone = () => {
    setMilestones([
      ...milestones,
      {
        description: `Milestone ${milestones.length + 1}`,
        value: "",
        deadlineDays: "30",
      },
    ]);
  };

  const removeMilestone = (idx: number) => {
    if (milestones.length <= 1) return;
    setMilestones(milestones.filter((_, i) => i !== idx));
  };

  const updateMilestone = (
    idx: number,
    field: keyof MilestoneInput,
    val: string,
  ) => {
    const updated = [...milestones];
    updated[idx] = { ...updated[idx], [field]: val };
    setMilestones(updated);
  };

  // ─── Milestone validation helpers ───
  const MIN_MILESTONE_BPS = 1000n; // 10%

  /**
   * Returns the list of milestone indices that are below the 10% minimum.
   * Only checks when totalValue > 0 so we don't divide by zero.
   */
  const milestoneBelowMinimum: boolean[] = milestones.map((ms) => {
    if (totalValue === 0n) return false;
    try {
      const val = parseUSDC(ms.value || "0");
      return (val * 10_000n) / totalValue < MIN_MILESTONE_BPS;
    } catch {
      return false;
    }
  });

  const hasMilestoneBelowMinimum = milestoneBelowMinimum.some(Boolean);

  // ─── Submit ───
  const handleSubmit = useCallback(async () => {
    if (!address) {
      toast.error("Please connect your wallet first.");
      return;
    }

    // Validate
    if (!title.trim()) {
      toast.error("Please provide a job title.");
      return;
    }
    if (milestones.some((ms) => !ms.value || parseUSDC(ms.value) === 0n)) {
      toast.error("All milestones must have a value greater than 0.");
      return;
    }
    // Check minimum milestone percentage (must be ≥ 10% of total value)
    if (totalValue > 0n) {
      const violating = milestones
        .map((ms, i) => ({ ms, i }))
        .filter(({ ms }) => {
          try {
            const val = parseUSDC(ms.value || "0");
            return (val * 10_000n) / totalValue < MIN_MILESTONE_BPS;
          } catch {
            return false;
          }
        });
      if (violating.length > 0) {
        const names = violating.map(({ i }) => `#${i + 1}`).join(", ");
        toast.error(
          `Milestone ${names} ${violating.length === 1 ? "is" : "are"} below the 10% minimum. Each milestone must be at least 10% of the total job value.`
        );
        return;
      }
    }

    try {
      // 0) Ensure our encryption public key is registered on-chain
      if (contracts.jobEscrow) {
        const myPubKeyHex = await recoverPublicKey();
        const existingPubKey = await contracts.jobEscrow.encryptionPubKeys(address);
        if (!existingPubKey || existingPubKey === "0x" || existingPubKey.toLowerCase() !== myPubKeyHex.toLowerCase()) {
          toast.loading("Registering encryption key…", { id: "regkey" });
          await registerEncryptionKey(myPubKeyHex);
          toast.success("Encryption key registered!", { id: "regkey" });
        }
      }

      // 1) Generate job key + salt
      const jobKeyHex = await generateJobKey();
      const saltHex = generateSalt();

      // 2) Build agreement document
      const agreement = {
        title,
        description,
        requirements,
        milestones: milestones.map((ms, i) => ({
          index: i,
          description: ms.description,
          value: ms.value,
          deadlineDays: ms.deadlineDays,
        })),
        reviewTimeout,
        postedBy: address,
        timestamp: Date.now(),
      };

      const agreementText = JSON.stringify(agreement);

      // 3) Compute agreement hash (salt || plaintext)
      const agreementHash = computeAgreementHash(saltHex, agreementText);

      // 4) Encrypt the agreement
      const encryptedBytes = await encrypt(agreementText, jobKeyHex);

      // 5) Check USDC balance and allowance BEFORE uploading to IPFS
      if (contracts.mockUSDC) {
        const contractAddresses = getContractAddresses();
        const balance = await contracts.mockUSDC.balanceOf(address);
        if (balance < totalRequired) {
          toast.error(
            `Insufficient USDC balance. You have ${formatUSDC(
              balance,
            )} but need ${formatUSDC(
              totalRequired,
            )}. Visit the Wallet page to get test USDC.`,
          );
          return;
        }
        const allowance = await contracts.mockUSDC.allowance(
          address,
          contractAddresses.JobEscrow,
        );
        if (allowance < totalRequired) {
          toast.error(
            `Insufficient USDC allowance. Please click "Approve USDC" first to allow JobEscrow to spend your USDC.`,
          );
          return;
        }
      }

      // 6) Prepare on-chain params
      const milestoneValues = milestones.map((ms) => parseUSDC(ms.value));
      // BUG FIX: Use blockchain time instead of Date.now() so that
      // deadlines are correctly computed after evm_increaseTime (time forwarding).
      const now = await getBlockTimestamp();
      const milestoneDeadlines = milestones.map(
        (ms) => now + Number(ms.deadlineDays) * 86400,
      );

      // 7) Dry-run the transaction to catch reverts BEFORE uploading to IPFS
      //    Use a placeholder CID for the dry-run — the actual CID doesn't affect
      //    gas estimation or revert checks (balance, allowance, parameters).
      if (contracts.jobEscrow) {
        try {
          await contracts.jobEscrow.postJob.estimateGas(
            agreementHash,
            milestoneValues,
            milestoneDeadlines,
            reviewTimeout,
            "QmPlaceholderDryRun",
          );
        } catch (dryRunErr) {
          const msg = parseContractError(dryRunErr);
          toast.error(`Transaction will fail: ${msg}`);
          return;
        }
      }

      // 8) Upload encrypted agreement envelope (including salt) to IPFS
      //    Salt is embedded in the envelope so it can always be retrieved from
      //    the same CID as the encrypted agreement.
      //    publicSummary is an UNENCRYPTED summary so that anyone browsing
      //    the job can read the agreement details without needing the job key.
      const envelope = {
        version: 1,
        salt: saltHex,
        encrypted: bufferToHex(encryptedBytes),
        publicSummary: {
          title,
          description,
          requirements,
          milestones: milestones.map((ms, i) => ({
            index: i,
            description: ms.description,
            value: ms.value,
            deadlineDays: ms.deadlineDays,
          })),
          reviewTimeout,
          postedBy: address,
          timestamp: Date.now(),
        },
      };
      const envelopeJSON = JSON.stringify(envelope);
      const envelopeBlob = new Blob([envelopeJSON], { type: "application/json" });
      const agreementCID = await uploadFile(
        envelopeBlob,
        `job-agreement-${Date.now()}`,
      );
      toast.success("Agreement uploaded to IPFS!");

      // 9) Post the job on-chain
      const { receipt } = await postJob(
        agreementHash,
        milestoneValues,
        milestoneDeadlines,
        reviewTimeout,
        agreementCID,
      );

      // 10) Extract jobId from events using ethers Interface
      let jobId: number | null = null;
      if (receipt?.logs) {
        const iface = new ethers.Interface(JobEscrowABI);
        for (const log of receipt.logs) {
          try {
            const parsed = iface.parseLog({
              topics: log.topics as string[],
              data: log.data,
            });
            if (parsed && parsed.name === "JobPosted") {
              jobId = Number(parsed.args.jobId);
              break;
            }
          } catch {
            // skip non-matching logs
          }
        }
      }

      if (jobId === null) {
        console.error("Failed to determine jobId from transaction logs");
      }

      // 11) Store the job key + title locally
      if (jobId !== null) {
        storeJobKey(jobId, jobKeyHex, address);
        storeJobTitle(jobId, title);
        toast.success(`Job #${jobId} created! Key saved locally.`);
      } else {
        toast.success(
          "Job created! Could not determine job ID for key storage.",
        );
      }

      navigate(jobId !== null ? `/job/${jobId}` : "/");
    } catch (err) {
      console.error("PostJob error:", err);
    }
  }, [
    address,
    title,
    description,
    requirements,
    milestones,
    reviewTimeout,
    postJob,
    navigate,
    contracts.jobEscrow,
  ]);

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <PostJobIcon className="h-16 w-16 text-gray-300 mb-4" />
        <h2 className="text-xl font-semibold text-gray-600">
          Please connect your wallet to post a job.
        </h2>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Post a New Job</h1>
      <p className="text-sm text-gray-500 mb-6">
        Define your project milestones and escrow requirements.
      </p>

      <div className="space-y-6">
        {/* Title */}
        <div>
          <label className="label">Job Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Build DeFi Dashboard"
            className="input"
            required
          />
        </div>

        {/* Description */}
        <div>
          <label className="label">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            placeholder="Describe the project scope and deliverables..."
            className="input resize-y"
          />
        </div>

        {/* Requirements */}
        <div>
          <label className="label">Technical Requirements</label>
          <textarea
            value={requirements}
            onChange={(e) => setRequirements(e.target.value)}
            rows={3}
            placeholder="Technologies, frameworks, or skills required..."
            className="input resize-y"
          />
        </div>

        {/* Review Timeout */}
        <div>
          <label className="label">Review Timeout</label>
          <select
            value={reviewTimeout}
            onChange={(e) => setReviewTimeout(Number(e.target.value))}
            className="input w-auto"
          >
            {REVIEW_TIMEOUT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-gray-400 mt-1">
            Time the client has to review each milestone before auto-approval.
          </p>
        </div>

        {/* Milestones */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <label className="label mb-0">Milestones</label>
            <button
              type="button"
              onClick={addMilestone}
              className="btn-secondary text-sm flex items-center gap-1"
            >
              <PlusCircle className="h-3.5 w-3.5" /> Add Milestone
            </button>
          </div>

          <div className="space-y-3">
            {milestones.map((ms, idx) => (
              <div key={idx} className="card border border-gray-200 !p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-gray-700">
                    Milestone #{idx + 1}
                  </span>
                  {milestones.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeMilestone(idx)}
                      className="text-red-400 hover:text-red-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-1">
                    <label className="label">Value (USDC)</label>
                    <input
                      type="text"
                      value={ms.value}
                      onChange={(e) =>
                        updateMilestone(idx, "value", e.target.value)
                      }
                      placeholder="1000"
                      className={`input ${
                        milestoneBelowMinimum[idx]
                          ? "border-red-400 focus:border-red-500 focus:ring-red-200"
                          : ""
                      }`}
                      required
                    />
                    {milestoneBelowMinimum[idx] && (
                      <p className="text-xs text-red-500 mt-1">
                        Must be ≥ 10% of total job value (
                        {formatUSDC(totalValue / 10n)} USDC)
                      </p>
                    )}
                  </div>
                  <div className="sm:col-span-1">
                    <label className="label">Deadline (days)</label>
                    <input
                      type="number"
                      value={ms.deadlineDays}
                      onChange={(e) =>
                        updateMilestone(idx, "deadlineDays", e.target.value)
                      }
                      min={1}
                      className="input"
                      required
                    />
                  </div>
                  <div className="sm:col-span-1">
                    <label className="label">Description</label>
                    <input
                      type="text"
                      value={ms.description}
                      onChange={(e) =>
                        updateMilestone(idx, "description", e.target.value)
                      }
                      placeholder="Deliverable description"
                      className="input"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Milestone validation warning */}
        {hasMilestoneBelowMinimum && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 flex items-start gap-2">
            <Info className="h-4 w-4 mt-0.5 flex-shrink-0 text-red-400" />
            <span>
              <strong>Invalid milestone allocation:</strong> Each milestone must
              represent at least <strong>10%</strong> of the total job value.
              Please adjust the highlighted milestone values.
            </span>
          </div>
        )}

        {/* Cost Summary */}
        <div className="card bg-gray-50 border border-gray-200">
          <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
            <Info className="h-4 w-4" /> Cost Summary
          </h3>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Total Job Value</span>
              <span className="font-medium">{formatUSDC(totalValue)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">
                Behavior Bond ({bondBps / 100}% — {tierKey} tier)
              </span>
              <span className="font-medium">{formatUSDC(behaviorBond)}</span>
            </div>
            <div className="flex justify-between border-t pt-1 mt-1">
              <span className="text-gray-700 font-medium">
                Total Required (Client)
              </span>
              <span className="font-bold text-brand-600">
                {formatUSDC(totalRequired)}
              </span>
            </div>
            <div className="mt-3 pt-2 border-t border-gray-200">
              <p className="text-xs text-gray-500 mb-1.5 font-medium">Freelancer Deposit (paid by freelancer, varies by their tier):</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-gray-400">
                <span>New — {FREELANCER_DEPOSIT_BPS.New / 100}%</span>
                <span>{formatUSDC((totalValue * BigInt(FREELANCER_DEPOSIT_BPS.New)) / 10000n)}</span>
                <span>Bronze — {FREELANCER_DEPOSIT_BPS.Bronze / 100}%</span>
                <span>{formatUSDC((totalValue * BigInt(FREELANCER_DEPOSIT_BPS.Bronze)) / 10000n)}</span>
                <span>Silver — {FREELANCER_DEPOSIT_BPS.Silver / 100}%</span>
                <span>{formatUSDC((totalValue * BigInt(FREELANCER_DEPOSIT_BPS.Silver)) / 10000n)}</span>
                <span>Gold — {FREELANCER_DEPOSIT_BPS.Gold / 100}%</span>
                <span>{formatUSDC((totalValue * BigInt(FREELANCER_DEPOSIT_BPS.Gold)) / 10000n)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Approve + Submit */}
        <div className="flex flex-col sm:flex-row gap-3">
          <TransactionButton
            onClick={() => approveJobEscrow()}
            isLoading={approveLoading}
            variant="secondary"
          >
            <Upload className="mr-1.5 h-4 w-4" /> Approve USDC
          </TransactionButton>

          <TransactionButton
            onClick={handleSubmit}
            isLoading={isLoading}
            variant="primary"
            disabled={hasMilestoneBelowMinimum}
          >
            <PlusCircle className="mr-1.5 h-4 w-4" /> Post Job
          </TransactionButton>
        </div>
      </div>
    </div>
  );
}
