import React, { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import {
  Shield,
  PauseCircle,
  PlayCircle,
  DollarSign,
  Gavel,
  RefreshCw,
  AlertOctagon,
  ShieldAlert,
  Loader2,
  BarChart3,
  Users,
  Settings,
} from "lucide-react";
import toast from "react-hot-toast";

import { useWallet } from "../contexts/WalletContext";
import { useContracts } from "../contexts/ContractContext";
import { useAdmin } from "../hooks/useAdmin";
import { TransactionButton } from "../components/common/TransactionButton";
import { PlatformStats } from "../components/admin/PlatformStats";
import { RoleManager } from "../components/admin/RoleManager";
import { JudgeAssigner } from "../components/admin/JudgeAssigner";
import { formatUSDC } from "../utils/format";
import { ROLES } from "../config/constants";
import { parseContractError } from "../utils/errors";
import type { PendingDispute } from "../hooks/useAdmin";

// ─── Tab config ───
type AdminTab = "stats" | "roles" | "disputes" | "controls";

const TABS: { key: AdminTab; label: string; icon: React.ElementType }[] = [
  { key: "stats", label: "Platform Stats", icon: BarChart3 },
  { key: "roles", label: "Role Management", icon: Users },
  { key: "disputes", label: "Judge Assignment", icon: Gavel },
  { key: "controls", label: "Contract Controls", icon: Settings },
];

export default function Admin() {
  const { address, isConnected } = useWallet();
  const { contracts, readContracts, isReady } = useContracts();
  const { fetchPendingDisputes } = useAdmin();

  // Role gate
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  // Tab state
  const [activeTab, setActiveTab] = useState<AdminTab>("stats");

  // Controls state
  const [isPaused, setIsPaused] = useState(false);
  const [treasuryAddr, setTreasuryAddr] = useState<string>("");
  const [treasuryBal, setTreasuryBal] = useState<bigint>(0n);
  const [controlsLoading, setControlsLoading] = useState(true);

  // Disputes state
  const [pendingDisputes, setPendingDisputes] = useState<PendingDispute[]>([]);

  // ─── Role check ───
  useEffect(() => {
    const checkAdmin = async () => {
      if (!readContracts.dispute || !readContracts.jobEscrow || !address) {
        setIsAdmin(null);
        return;
      }

      try {
        const DEFAULT_ADMIN = "0x0000000000000000000000000000000000000000000000000000000000000000";
        const [hasAdmin, hasDefault, hasJobAdmin, hasJobDefault] = await Promise.all([
          readContracts.dispute.hasRole(ROLES.PLATFORM_ADMIN, address),
          readContracts.dispute.hasRole(DEFAULT_ADMIN, address),
          readContracts.jobEscrow.hasRole(ROLES.PLATFORM_ADMIN, address),
          readContracts.jobEscrow.hasRole(DEFAULT_ADMIN, address),
        ]);
        setIsAdmin(hasAdmin || hasDefault || hasJobAdmin || hasJobDefault);
      } catch (err) {
        console.error("Admin role check failed:", err);
        setIsAdmin(false);
      }
    };

    if (isReady) checkAdmin();
  }, [readContracts.dispute, readContracts.jobEscrow, address, isReady]);

  // ─── Fetch controls data ───
  const fetchControlsData = useCallback(async () => {
    if (!readContracts.jobEscrow) return;

    setControlsLoading(true);
    try {
      const paused = await readContracts.jobEscrow.paused();
      setIsPaused(paused);

      const treasury = await readContracts.jobEscrow.treasury();
      setTreasuryAddr(treasury);
      const bal = await readContracts.jobEscrow.withdrawableBalances(treasury);
      setTreasuryBal(bal as bigint);
    } catch (err) {
      console.error("Failed to fetch controls data:", err);
    } finally {
      setControlsLoading(false);
    }
  }, [readContracts.jobEscrow]);

  // ─── Fetch pending disputes ───
  const loadPendingDisputes = useCallback(async () => {
    const pd = await fetchPendingDisputes();
    setPendingDisputes(pd);
  }, [fetchPendingDisputes]);

  // Load data on mount
  useEffect(() => {
    if (isReady && isAdmin) {
      fetchControlsData();
      loadPendingDisputes();
    }
  }, [isReady, isAdmin, fetchControlsData, loadPendingDisputes]);

  const handlePauseToggle = async () => {
    if (!contracts.jobEscrow) return;
    toast.loading(isPaused ? "Unpausing..." : "Pausing...", { id: "pause" });
    try {
      const tx = isPaused
        ? await contracts.jobEscrow.unpause()
        : await contracts.jobEscrow.pause();
      await tx.wait();
      toast.success(isPaused ? "Contract Unpaused" : "Contract Paused", {
        id: "pause",
      });
      fetchControlsData();
    } catch (err) {
      toast.error(parseContractError(err), { id: "pause" });
    }
  };

  // ─── Access states ───
  if (!isConnected) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Shield className="h-16 w-16 text-gray-300 mb-4" />
          <h2 className="text-xl font-semibold text-gray-600">
            Connect your wallet to view Admin panel
          </h2>
        </div>
      </div>
    );
  }

  if (isAdmin === null) {
    return (
      <div className="max-w-5xl mx-auto p-6 text-center py-20">
        <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 text-gray-400" />
        <p className="text-gray-400">Checking admin access...</p>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <div className="card text-center py-12">
          <ShieldAlert className="h-10 w-10 mx-auto mb-3 text-red-400" />
          <p className="text-lg font-semibold text-gray-900">Access Denied</p>
          <p className="text-sm text-gray-500 mt-1">
            You are not a platform administrator.
          </p>
        </div>
      </div>
    );
  }

  // ─── Main Dashboard ───
  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-extrabold text-gray-900 flex items-center gap-3">
          <Shield className="h-8 w-8 text-brand-600" />
          Admin Dashboard
        </h1>
        <p className="text-sm text-gray-500 mt-2">
          Manage platform roles, stats, judges, and system controls.
        </p>
      </div>

      {/* Tab Bar */}
      <div className="flex border-b border-gray-200 gap-1 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition whitespace-nowrap ${
              activeTab === tab.key
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            }`}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === "stats" && <PlatformStats />}

      {activeTab === "roles" && <RoleManager />}

      {activeTab === "disputes" && (
        <JudgeAssigner
          pendingDisputes={pendingDisputes}
          onAssigned={() => loadPendingDisputes()}
        />
      )}

      {activeTab === "controls" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Treasury Control */}
          <div className="card border-t-4 border-t-green-500 shadow-md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                <DollarSign className="h-5 w-5 text-green-500" />
                Treasury Overview
              </h2>
              <button
                onClick={fetchControlsData}
                className="text-gray-400 hover:text-gray-600"
              >
                <RefreshCw className={`h-4 w-4 ${controlsLoading ? "animate-spin" : ""}`} />
              </button>
            </div>

            <div className="bg-green-50/50 rounded-lg p-4 mb-4">
              <p className="text-xs text-green-800 font-semibold mb-1 uppercase tracking-wider">
                Withdrawable Balance
              </p>
              <p className="text-3xl font-extrabold text-green-600">
                {formatUSDC(treasuryBal)}
              </p>
            </div>

            <div className="text-xs text-gray-500 font-mono space-y-1">
              <p>Treasury Address:</p>
              <p className="break-all bg-gray-100 p-1.5 rounded">
                {treasuryAddr || "Loading..."}
              </p>
            </div>
          </div>

          {/* Global Controls */}
          <div
            className={`card border-t-4 shadow-md ${
              isPaused ? "border-t-red-500" : "border-t-brand-500"
            }`}
          >
            <div className="flex items-center gap-2 mb-4">
              <AlertOctagon
                className={`h-5 w-5 ${
                  isPaused ? "text-red-500" : "text-brand-500"
                }`}
              />
              <h2 className="text-lg font-bold text-gray-800">
                Global System Controls
              </h2>
            </div>

            <div className="mb-4">
              <span className="text-sm text-gray-600 font-medium mr-2">
                Status:
              </span>
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
              Pausing the contract prevents new jobs, applications, and
              transfers from occurring to protect the system. Only a Platform
              Admin can toggle this.
            </p>

            <TransactionButton
              onClick={handlePauseToggle}
              variant={isPaused ? "success" : "danger"}
              className="w-full justify-center"
            >
              {isPaused ? (
                <>
                  <PlayCircle className="mr-2 h-4 w-4" /> Unpause System
                </>
              ) : (
                <>
                  <PauseCircle className="mr-2 h-4 w-4" /> Pause System
                </>
              )}
            </TransactionButton>
          </div>
        </div>
      )}
    </div>
  );
}
