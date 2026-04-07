import React, { useState, useEffect } from "react";
import { Scale, Loader2, ShieldAlert, Key } from "lucide-react";
import toast from "react-hot-toast";
import { useWallet } from "../contexts/WalletContext";
import { useContracts } from "../contexts/ContractContext";
import { useAssignedDisputes } from "../hooks/useAssignedDisputes";
import { useJobEscrow } from "../hooks/useJobEscrow";
import { ROLES } from "../config/constants";
import { DisputeQueue, DisputeQueueItem } from "../components/judge/DisputeQueue";
import { DisputeReviewPanel } from "../components/judge/DisputeReviewPanel";
import { recoverPublicKey } from "../crypto/ecies";

// ─── Judge Dashboard ───
export default function JudgeDashboard() {
  const { address, isConnected } = useWallet();
  const { readContracts } = useContracts();
  const { disputes, loading, refresh } = useAssignedDisputes();
  const { registerEncryptionKey } = useJobEscrow();

  const [hasAccess, setHasAccess] = useState<boolean | null>(null);
  const [selectedDisputeId, setSelectedDisputeId] = useState<number | null>(null);
  const [keyRegistered, setKeyRegistered] = useState<boolean | null>(null);
  const [registeringKey, setRegisteringKey] = useState(false);

  // Map flat Dispute[] → DisputeQueueItem[] (wrap deadline fields in nested object)
  const queueItems: DisputeQueueItem[] = disputes.map((d) => ({
    disputeId: d.disputeId,
    jobId: d.jobId,
    milestoneIdx: d.milestoneIdx,
    client: d.client,
    freelancer: d.freelancer,
    milestoneValue: d.milestoneValue,
    phase: d.phase,
    deadlines: {
      evidenceDeadline: d.evidenceDeadline,
      keyDistributionDeadline: d.keyDistributionDeadline,
      rulingDeadline: d.rulingDeadline,
    },
  }));

  // ─── Check if wallet has PLATFORM_JUDGE role ───
  useEffect(() => {
    const checkRole = async () => {
      if (!readContracts.dispute || !address) {
        setHasAccess(null);
        return;
      }

      try {
        const allowed = await readContracts.dispute.hasRole(
          ROLES.PLATFORM_JUDGE,
          address
        );
        setHasAccess(allowed);
      } catch (err) {
        console.error("Role check failed:", err);
        setHasAccess(false);
      }
    };

    checkRole();
  }, [readContracts.dispute, address]);

  // ─── Auto-check & register encryption key for the judge ───
  useEffect(() => {
    const checkKey = async () => {
      if (!readContracts.jobEscrow || !address || !hasAccess) return;
      try {
        const existingKey: string = await readContracts.jobEscrow.encryptionPubKeys(address);
        if (existingKey && existingKey !== "0x" && existingKey.length > 2) {
          setKeyRegistered(true);
        } else {
          setKeyRegistered(false);
        }
      } catch {
        setKeyRegistered(false);
      }
    };
    checkKey();
  }, [readContracts.jobEscrow, address, hasAccess]);

  const handleRegisterKey = async () => {
    setRegisteringKey(true);
    try {
      const pubKeyHex = await recoverPublicKey();
      await registerEncryptionKey(pubKeyHex);
      setKeyRegistered(true);
      toast.success("Encryption key registered successfully!");
    } catch (err) {
      console.error("Failed to register encryption key:", err);
      toast.error("Failed to register encryption key.");
    } finally {
      setRegisteringKey(false);
    }
  };

  // ─── Access states ───
  if (!isConnected) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <div className="card text-center py-12 text-gray-500">
          Connect your wallet to access the Judge Dashboard.
        </div>
      </div>
    );
  }

  if (hasAccess === null) {
    return (
      <div className="max-w-5xl mx-auto p-6 text-center py-12">
        <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 text-gray-400" />
        <p className="text-gray-400">Checking judge access...</p>
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <div className="card text-center py-12">
          <ShieldAlert className="h-10 w-10 mx-auto mb-3 text-red-400" />
          <p className="text-lg font-semibold text-gray-900">Access Denied</p>
          <p className="text-sm text-gray-500 mt-1">
            You do not have the PLATFORM_JUDGE role.
          </p>
        </div>
      </div>
    );
  }

  // ─── Dashboard UI ───
  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Scale className="h-7 w-7 text-indigo-600" />
          Judge Dashboard
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Review and resolve assigned disputes
        </p>
      </div>

      {/* Encryption key registration banner */}
      {keyRegistered === false && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
          <Key className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-900">
              Encryption key not registered
            </p>
            <p className="text-xs text-amber-700 mt-1">
              You must register your encryption key so that disputing parties can
              securely share decryption keys with you. This is a one-time setup.
            </p>
            <button
              onClick={handleRegisterKey}
              disabled={registeringKey}
              className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 disabled:opacity-50 transition"
            >
              {registeringKey ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Key className="h-4 w-4" />
              )}
              {registeringKey ? "Registering..." : "Register Encryption Key"}
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Dispute Queue */}
        <div className="lg:col-span-1">
          <DisputeQueue
            disputes={queueItems}
            selectedId={selectedDisputeId}
            onSelect={setSelectedDisputeId}
          />
          {loading && (
            <div className="text-center py-4 text-sm text-gray-400">
              <Loader2 className="h-4 w-4 animate-spin inline mr-1" />
              Loading disputes...
            </div>
          )}
        </div>

        {/* Right: Dispute Review Panel */}
        <div className="lg:col-span-2">
          {selectedDisputeId !== null ? (
            <DisputeReviewPanel
              key={selectedDisputeId}
              disputeId={selectedDisputeId}
              onRefresh={refresh}
            />
          ) : (
            <div className="card text-center py-16 text-gray-400">
              <Scale className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p>Select a dispute from the queue to review</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
