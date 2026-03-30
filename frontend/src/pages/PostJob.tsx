import React, { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ethers } from "ethers";
import { PlusCircle, Trash2, Info, Upload } from "lucide-react";
import toast from "react-hot-toast";
import { useWallet } from "../contexts/WalletContext";
import { useContracts } from "../contexts/ContractContext";
import { useJobEscrow } from "../hooks/useJobEscrow";
import { useMockUSDC } from "../hooks/useMockUSDC";
import { TransactionButton } from "../components/common/TransactionButton";
import { generateJobKey, generateSalt } from "../crypto/jobKey";
import { encrypt } from "../crypto/aes";
import { computeAgreementHash } from "../crypto/hash";
import { uploadFile, uploadJSON } from "../ipfs/pinata";
import { storeJobKey } from "../utils/storage";
import { storeJobTitle } from "../utils/storage";
import { parseUSDC, formatUSDC } from "../utils/format";
import { getContractAddresses } from "../config/contracts";
import JobEscrowABI from "../abis/JobEscrow.json";
import {
  REVIEW_TIMEOUT_OPTIONS,
  PROTOCOL_FEE_BPS,
  FREELANCER_DEPOSIT_BPS,
  BEHAVIOR_BOND_BPS,
} from "../config/constants";

interface MilestoneInput {
  description: string;
  value: string;
  deadlineDays: string;
}

export default function PostJob() {
  const navigate = useNavigate();
  const { address, isConnected } = useWallet();
  const { contracts } = useContracts();
  const { postJob, isLoading } = useJobEscrow();
  const { approveJobEscrow, isLoading: approveLoading } = useMockUSDC();

  // ─── Form state ───
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [requirements, setRequirements] = useState("");
  const [reviewTimeout, setReviewTimeout] = useState(REVIEW_TIMEOUT_OPTIONS[2].value); // 7 days default
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

  const behaviorBond = (totalValue * BigInt(BEHAVIOR_BOND_BPS.New)) / 10000n;
  const freelancerDeposit = (totalValue * BigInt(FREELANCER_DEPOSIT_BPS)) / 10000n;
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

  const updateMilestone = (idx: number, field: keyof MilestoneInput, val: string) => {
    const updated = [...milestones];
    updated[idx] = { ...updated[idx], [field]: val };
    setMilestones(updated);
  };

  // ─── Submit ───
  const handleSubmit = useCallback(
    async () => {
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

      try {
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

        // 5) Upload encrypted agreement (binary) + salt metadata to IPFS
        const encryptedBlob = new Blob([encryptedBytes.buffer as ArrayBuffer], { type: "application/octet-stream" });
        const agreementCID = await uploadFile(
          encryptedBlob,
          `job-agreement-${Date.now()}`
        );

        // Also upload the salt as a small JSON sidecar
        await uploadJSON(
          { salt: saltHex },
          `job-salt-${Date.now()}`
        );
        toast.success("Agreement uploaded to IPFS!");

        // 6) Prepare on-chain params
        const milestoneValues = milestones.map((ms) => parseUSDC(ms.value));
        const now = Math.floor(Date.now() / 1000);
        const milestoneDeadlines = milestones.map(
          (ms) => now + Number(ms.deadlineDays) * 86400
        );

        // Bug #3 fix: Check USDC balance and allowance before posting
        if (contracts.mockUSDC) {
          const contractAddresses = getContractAddresses();
          const balance = await contracts.mockUSDC.balanceOf(address);
          if (balance < totalRequired) {
            toast.error(
              `Insufficient USDC balance. You have ${formatUSDC(balance)} but need ${formatUSDC(totalRequired)}. Visit the Wallet page to mint USDC.`
            );
            return;
          }
          const allowance = await contracts.mockUSDC.allowance(address, contractAddresses.JobEscrow);
          if (allowance < totalRequired) {
            toast.error(
              `Insufficient USDC allowance. Please click "Approve USDC" first to allow JobEscrow to spend your USDC.`
            );
            return;
          }
        }

        // 7) Post the job on-chain
        const { receipt } = await postJob(
          agreementHash,
          milestoneValues,
          milestoneDeadlines,
          reviewTimeout,
          agreementCID
        );

        // 8) Extract jobId from events using ethers Interface
        let jobId: number | null = null;
        if (receipt?.logs) {
          const iface = new ethers.Interface(JobEscrowABI);
          for (const log of receipt.logs) {
            try {
              const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
              if (parsed && parsed.name === "JobPosted") {
                jobId = Number(parsed.args.jobId);
                break;
              }
            } catch {
              // skip non-matching logs
            }
          }
        }

        // Fallback: query nextJobId and subtract 1
        if (jobId === null && contracts.jobEscrow) {
          try {
            const nextId = await contracts.jobEscrow.nextJobId();
            jobId = Number(nextId) - 1;
          } catch {
            // last resort — should not happen
            console.error("Failed to determine jobId");
          }
        }

        // 9) Store the job key + title locally
        if (jobId !== null) {
          storeJobKey(jobId, jobKeyHex);
          storeJobTitle(jobId, title);
          toast.success(`Job #${jobId} created! Key saved locally.`);
        } else {
          toast.success("Job created! Could not determine job ID for key storage.");
        }

        navigate(jobId !== null ? `/job/${jobId}` : "/");
      } catch (err) {
        console.error("PostJob error:", err);
      }
    },
    [address, title, description, requirements, milestones, reviewTimeout, postJob, navigate, contracts.jobEscrow]
  );

  if (!isConnected) {
    return (
      <div className="text-center py-20 text-gray-400">
        Please connect your wallet to post a job.
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
                      onChange={(e) => updateMilestone(idx, "value", e.target.value)}
                      placeholder="1000"
                      className="input"
                      required
                    />
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
                Behavior Bond ({BEHAVIOR_BOND_BPS.New / 100}%)
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
            <div className="flex justify-between text-xs text-gray-400 mt-2">
              <span>Freelancer Deposit ({FREELANCER_DEPOSIT_BPS / 100}%)</span>
              <span>{formatUSDC(freelancerDeposit)}</span>
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
          >
            <PlusCircle className="mr-1.5 h-4 w-4" /> Post Job
          </TransactionButton>
        </div>
      </div>
    </div>
  );
}
