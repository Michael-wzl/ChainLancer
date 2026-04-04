import React, { useState, useEffect } from "react";
import { Search } from "lucide-react";
import { useWallet } from "../contexts/WalletContext";
import { useAssignedDisputes } from "../hooks/useAssignedDisputes";
import { ethers } from "ethers";
import { DisputePhase, Ruling } from "../config/constants";

// ─── Dashboard ───
export default function JudgeDashboard() {
  const { address, isConnected, signer } = useWallet();
  const { disputes, loading } = useAssignedDisputes();

  const [hasAccess, setHasAccess] = useState<boolean | null>(null);
  const [selectedDispute, setSelectedDispute] = useState<any | null>(null);

  // ─── Check if wallet is PLATFORM_JUDGE ───
  useEffect(() => {
    const checkRole = async () => {
      if (!signer || !address) return;

      try {
        // Replace with your deployed PlatformRoles contract
        const contract = new ethers.Contract(
          "YOUR_PLATFORM_ROLES_CONTRACT_ADDRESS",
          ["function hasRole(bytes32,address) view returns (bool)"],
          signer,
        );

        const role = ethers.id("PLATFORM_JUDGE");
        const allowed = await contract.hasRole(role, address);

        setHasAccess(allowed);
      } catch (err) {
        console.error(err);
        setHasAccess(false);
      }
    };

    checkRole();
  }, [signer, address]);

  // ─── Access states ───
  if (!isConnected) {
    return <div className="p-6 text-gray-500">Connect wallet to continue.</div>;
  }

  if (hasAccess === null) {
    return <div className="p-6 text-gray-400">Checking access...</div>;
  }

  if (!hasAccess) {
    return (
      <div className="p-6 text-black-500 font-semibold">
        ❌ Access Denied — You are not a judge
      </div>
    );
  }

  // ─── Dashboard UI ───
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Judge Dashboard</h1>
        <p className="text-sm text-gray-500">
          Review and resolve assigned disputes
        </p>
      </div>

      {/* Dispute List */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">
          Loading disputes...
        </div>
      ) : disputes.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          No assigned disputes.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {disputes.map((d) => (
            <div
              key={d.disputeId}
              className="border rounded-xl p-4 cursor-pointer hover:shadow"
              onClick={() => setSelectedDispute(d)}
            >
              <p className="font-semibold">Job #{d.jobId}</p>
              <p className="text-xs text-gray-500">Client: {d.client}</p>
              <p className="text-xs text-gray-500">
                Freelancer: {d.freelancer}
              </p>
              <p className="text-xs mt-2">
                Phase:{" "}
                <span className="font-medium">{DisputePhase[d.phase]}</span>
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Selected Dispute Panel */}
      {selectedDispute && (
        <div className="border rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-bold">
            Dispute #{selectedDispute.jobId}
          </h2>

          {/* Phase-specific UI */}
          {selectedDispute.phase === DisputePhase.KeyDistribution && (
            <div className="text-yellow-600">
              Waiting for both parties to submit keys...
            </div>
          )}

          {selectedDispute.phase === DisputePhase.UnderReview && (
            <>
              <button
                className="btn-primary"
                onClick={() => console.log("Decrypting K_job...")}
              >
                Decrypt K_job
              </button>

              <div className="text-sm text-gray-500">
                (Agreement, deliverables, and evidence will appear after
                decryption)
              </div>
            </>
          )}

          {/* Ruling form */}
          <div className="space-y-3">
            <select className="input">
              <option value={Ruling.FreelancerWins}>Freelancer Wins</option>
              <option value={Ruling.ClientWins}>Client Wins</option>
              <option value={Ruling.Inconclusive}>Inconclusive</option>
            </select>

            <input
              type="number"
              placeholder="Freelancer Share (bps)"
              className="input"
            />
            <input
              type="number"
              placeholder="Deposit Slash (bps)"
              className="input"
            />
            <textarea placeholder="Reasoning..." className="input" />

            <div className="flex gap-2">
              <button
                className="btn-primary"
                onClick={() => console.log("Submit ruling")}
              >
                Submit Ruling
              </button>
              <button
                className="btn-secondary"
                onClick={() => console.log("Execute ruling")}
              >
                Execute Ruling
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
