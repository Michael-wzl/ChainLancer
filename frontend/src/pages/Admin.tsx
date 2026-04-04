import React, { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import {
  Shield,
  PauseCircle,
  PlayCircle,
  DollarSign,
  ArrowDownCircle,
  Gavel,
  RefreshCw,
  AlertOctagon,
  ChevronRight,
} from "lucide-react";
import toast from "react-hot-toast";

import { useWallet } from "../contexts/WalletContext";
import { useContracts } from "../contexts/ContractContext";
import { TransactionButton } from "../components/common/TransactionButton";
import { formatUSDC, truncateAddress } from "../utils/format";
import { DisputePhase, DISPUTE_PHASE_LABELS } from "../config/constants";
import { parseContractError } from "../utils/errors";

interface AdminDispute {
  id: number;
  jobId: number;
  milestoneIdx: number;
  client: string;
  freelancer: string;
  milestoneValue: bigint;
  phase: DisputePhase;
}

export default function Admin() {
  const { address, isConnected } = useWallet();
  const { contracts, readContracts, isReady } = useContracts();

  const [loading, setLoading] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [treasuryAddr, setTreasuryAddr] = useState<string>("");
  const [treasuryBal, setTreasuryBal] = useState<bigint>(0n);
  const [disputes, setDisputes] = useState<AdminDispute[]>([]);

  // Forms state
  const [judgeForms, setJudgeForms] = useState<Record<number, { judgeAddress: string, ephemeralKey: string }>>({});
  const [assigningId, setAssigningId] = useState<number | null>(null);

  const fetchAdminData = useCallback(async () => {
    if (!readContracts.jobEscrow || !readContracts.dispute) return;

    setLoading(true);
    try {
      // Fetch platform pause state
      const paused = await readContracts.jobEscrow.paused();
      setIsPaused(paused);

      // Fetch treasury balance
      const treasury = await readContracts.jobEscrow.treasury();
      setTreasuryAddr(treasury);
      const bal = await readContracts.jobEscrow.withdrawableBalances(treasury);
      setTreasuryBal(bal as bigint);

      // Fetch all disputes
      const nextIdBig = await readContracts.dispute.nextDisputeId();
      const nextId = Number(nextIdBig);

      const loadedDisputes: AdminDispute[] = [];
      for (let i = 0; i < nextId; i++) {
        // getDisputeDetails returns:
        // (jobId, milestoneIdx, initiator, client, freelancer, milestoneValue, judge, phase, ruling)
        const details = await readContracts.dispute.getDisputeDetails(i);
        const phase = Number(details[7]) as DisputePhase;

        // We only care about active disputes needing an admin to act or oversee
        if (phase === DisputePhase.AwaitingJudge) {
          loadedDisputes.push({
            id: i,
            jobId: Number(details[0]),
            milestoneIdx: Number(details[1]),
            client: details[3],
            freelancer: details[4],
            milestoneValue: details[5] as bigint,
            phase: phase,
          });
        }
      }

      setDisputes(loadedDisputes);
    } catch (err) {
      console.error("Failed to fetch admin data:", err);
      toast.error("Could not fetch admin data");
    } finally {
      setLoading(false);
    }
  }, [readContracts.jobEscrow, readContracts.dispute]);

  useEffect(() => {
    if (isReady) {
      fetchAdminData();
    }
  }, [isReady, fetchAdminData]);

  const handlePauseToggle = async () => {
    if (!contracts.jobEscrow) return;
    toast.loading(isPaused ? "Unpausing..." : "Pausing...", { id: "pause" });
    try {
      let tx;
      if (isPaused) {
        tx = await contracts.jobEscrow.unpause();
      } else {
        tx = await contracts.jobEscrow.pause();
      }
      await tx.wait();
      toast.success(isPaused ? "Contract Unpaused" : "Contract Paused", { id: "pause" });
      fetchAdminData();
    } catch (err) {
      toast.error(parseContractError(err), { id: "pause" });
    }
  };

  const handleAssignJudge = async (disputeId: number) => {
    if (!contracts.dispute) return;

    const form = judgeForms[disputeId];
    if (!form || !form.judgeAddress || !form.ephemeralKey) {
      toast.error("Please fill in both fields");
      return;
    }

    // Validate inputs
    if (!ethers.isAddress(form.judgeAddress)) {
      toast.error("Invalid Judge Address");
      return;
    }

    let formattedKey = form.ephemeralKey;
    if (!formattedKey.startsWith("0x")) {
      formattedKey = "0x" + formattedKey;
    }

    setAssigningId(disputeId);
    toast.loading(`Assigning Judge to #${disputeId}...`, { id: "assign" });
    try {
      const tx = await contracts.dispute.assignJudge(disputeId, form.judgeAddress, formattedKey);
      await tx.wait();
      toast.success("Judge Assigned Successfully!", { id: "assign" });

      // Remove from form and refetch
      setJudgeForms(prev => {
        const next = { ...prev };
        delete next[disputeId];
        return next;
      });
      fetchAdminData();
    } catch (err) {
      toast.error(parseContractError(err), { id: "assign" });
    } finally {
      setAssigningId(null);
    }
  };

  const updateJudgeForm = (disputeId: number, field: 'judgeAddress' | 'ephemeralKey', value: string) => {
    setJudgeForms(prev => ({
      ...prev,
      [disputeId]: {
        ...(prev[disputeId] || { judgeAddress: "", ephemeralKey: "" }),
        [field]: value
      }
    }));
  };

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Shield className="h-16 w-16 text-gray-300 mb-4" />
        <h2 className="text-xl font-semibold text-gray-600">
          Connect your wallet to view Admin panel
        </h2>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="text-center py-20 text-gray-400">
        <RefreshCw className="h-8 w-8 text-brand-500 animate-spin mx-auto mb-4" />
        Loading Admin Dashboard...
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-extrabold text-gray-900 flex items-center gap-3">
          <Shield className="h-8 w-8 text-brand-600" />
          Admin Dashboard
        </h1>
        <p className="text-sm text-gray-500 mt-2">
          Manage system controls, treasury, and assign judges to pending disputes.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Treasury Control */}
        <div className="card border-t-4 border-t-green-500 shadow-md">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-green-500" />
              Treasury Overview
            </h2>
            <button
              onClick={fetchAdminData}
              className="text-gray-400 hover:text-gray-600"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>

          <div className="bg-green-50/50 rounded-lg p-4 mb-4">
            <p className="text-xs text-green-800 font-semibold mb-1 uppercase tracking-wider">Withdrawable Balance</p>
            <p className="text-3xl font-extrabold text-green-600">
              {formatUSDC(treasuryBal)}
            </p>
          </div>

          <div className="text-xs text-gray-500 font-mono space-y-1">
            <p>Treasury Address:</p>
            <p className="break-all bg-gray-100 p-1.5 rounded">{treasuryAddr || "Loading..."}</p>
          </div>
        </div>

        {/* Global Controls */}
        <div className={`card border-t-4 shadow-md ${isPaused ? "border-t-red-500" : "border-t-brand-500"}`}>
          <div className="flex items-center gap-2 mb-4">
            <AlertOctagon className={`h-5 w-5 ${isPaused ? "text-red-500" : "text-brand-500"}`} />
            <h2 className="text-lg font-bold text-gray-800">Global System Controls</h2>
          </div>

          <div className="mb-4">
            <span className="text-sm text-gray-600 font-medium mr-2">Status:</span>
            {isPaused ? (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                <PauseCircle className="h-3.5 w-3.5 mr-1" /> PAUSED
              </span>
            ) : (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                <PlayCircle className="h-3.5 w-3.5 mr-1" /> ACTIVE
              </span>
            )}
          </div>

          <p className="text-xs text-gray-500 mb-6">
            Pausing the contract prevents new jobs, applications, and transfers from occurring to protect the system. Only a Platform Admin can toggle this.
          </p>

          <TransactionButton
            onClick={handlePauseToggle}
            variant={isPaused ? "success" : "danger"}
            className="w-full justify-center"
          >
            {isPaused ? (
              <><PlayCircle className="mr-2 h-4 w-4" /> Unpause System</>
            ) : (
              <><PauseCircle className="mr-2 h-4 w-4" /> Pause System</>
            )}
          </TransactionButton>
        </div>
      </div>

      {/* Disputes Awaiting Judge */}
      <div className="card shadow-md">
        <div className="flex items-center gap-2 mb-6">
          <Gavel className="h-6 w-6 text-indigo-600" />
          <h2 className="text-xl font-bold text-gray-900">Disputes Awaiting Judge</h2>
          <span className="ml-2 bg-indigo-100 text-indigo-800 py-0.5 px-2.5 rounded-full text-xs font-semibold">
            {disputes.length}
          </span>
        </div>

        {disputes.length === 0 ? (
          <div className="text-center py-10 bg-gray-50 rounded-lg border border-gray-100 border-dashed">
            <Gavel className="h-10 w-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm font-medium text-gray-500">No disputes currently awaiting a judge.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {disputes.map((d) => (
              <div key={d.id} className="border border-gray-200 rounded-xl overflow-hidden transition hover:shadow-sm">
                <div className="bg-gray-50 p-4 border-b border-gray-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <h3 className="font-bold text-gray-900 flex items-center gap-2">
                      Dispute #{d.id} <ChevronRight className="h-4 w-4 text-gray-400" /> Job #{d.jobId} (Milestone {d.milestoneIdx + 1})
                    </h3>
                    <div className="mt-1.5 flex items-center gap-4 text-xs text-gray-500">
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                        C: <span className="font-mono">{truncateAddress(d.client)}</span>
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-purple-500"></span>
                        F: <span className="font-mono">{truncateAddress(d.freelancer)}</span>
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end">
                    <span className="text-xs font-medium text-gray-500 uppercase">Milestone Value</span>
                    <span className="font-bold text-gray-900">{formatUSDC(d.milestoneValue)}</span>
                  </div>
                </div>

                <div className="p-4 bg-white">
                  <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-4 items-end">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Judge Address</label>
                      <input
                        type="text"
                        placeholder="0x..."
                        className="input text-sm font-mono placeholder-gray-300"
                        value={judgeForms[d.id]?.judgeAddress || ""}
                        onChange={(e) => updateJudgeForm(d.id, "judgeAddress", e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Ephemeral Public Key (Hex)</label>
                      <input
                        type="text"
                        placeholder="0x..."
                        className="input text-sm font-mono placeholder-gray-300"
                        value={judgeForms[d.id]?.ephemeralKey || ""}
                        onChange={(e) => updateJudgeForm(d.id, "ephemeralKey", e.target.value)}
                      />
                    </div>
                    <div>
                      <TransactionButton
                        onClick={() => handleAssignJudge(d.id)}
                        isLoading={assigningId === d.id}
                        variant="primary"
                        className="w-full whitespace-nowrap"
                      >
                        Assign Judge
                      </TransactionButton>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
