import React, { useState, useEffect, useCallback } from "react";
import {
  Users,
  UserPlus,
  UserMinus,
  Loader2,
  RefreshCw,
  Shield,
} from "lucide-react";
import { ethers } from "ethers";
import toast from "react-hot-toast";
import { useAdmin, type ContractName } from "../../hooks/useAdmin";
import { TransactionButton } from "../common/TransactionButton";
import { truncateAddress } from "../../utils/format";
import { ROLES } from "../../config/constants";

// ─── Types ───

interface RoleEntry {
  address: string;
  roleName: string;
  roleHash: string;
  contractName: ContractName;
}

const MANAGEABLE_ROLES = [
  { name: "PLATFORM_ADMIN", hash: ROLES.PLATFORM_ADMIN },
  { name: "PLATFORM_JUDGE", hash: ROLES.PLATFORM_JUDGE },
] as const;

// Which contract to look up each role on
const ROLE_CONTRACT_MAP: Record<string, ContractName> = {
  PLATFORM_ADMIN: "dispute",
  PLATFORM_JUDGE: "dispute",
};

// ─── Component ───

export function RoleManager() {
  const { grantRole, revokeRole, getRoleHolders, loading } = useAdmin();

  const [holders, setHolders] = useState<RoleEntry[]>([]);
  const [loadingHolders, setLoadingHolders] = useState(true);

  // Form state
  const [grantRoleName, setGrantRoleName] = useState<string>(MANAGEABLE_ROLES[0].name);
  const [grantAddress, setGrantAddress] = useState("");
  const [grantContract, setGrantContract] = useState<ContractName>("dispute");

  const fetchHolders = useCallback(async () => {
    setLoadingHolders(true);
    const entries: RoleEntry[] = [];

    for (const role of MANAGEABLE_ROLES) {
      const contractName = ROLE_CONTRACT_MAP[role.name] || "dispute";
      const addrs = await getRoleHolders(contractName, role.hash);
      for (const addr of addrs) {
        entries.push({
          address: addr,
          roleName: role.name,
          roleHash: role.hash,
          contractName,
        });
      }
    }

    setHolders(entries);
    setLoadingHolders(false);
  }, [getRoleHolders]);

  useEffect(() => {
    fetchHolders();
  }, [fetchHolders]);

  const handleGrant = async () => {
    if (!grantAddress || !ethers.isAddress(grantAddress)) {
      toast.error("Please enter a valid Ethereum address");
      return;
    }

    const role = MANAGEABLE_ROLES.find((r) => r.name === grantRoleName);
    if (!role) return;

    try {
      await grantRole(grantContract, role.hash, grantAddress);
      setGrantAddress("");
      fetchHolders();
    } catch {
      // Error already toasted by useAdmin
    }
  };

  const handleRevoke = async (entry: RoleEntry) => {
    try {
      await revokeRole(entry.contractName, entry.roleHash, entry.address);
      fetchHolders();
    } catch {
      // Error already toasted by useAdmin
    }
  };

  return (
    <div className="space-y-6">
      {/* Current Role Holders */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
            <Users className="h-5 w-5 text-indigo-500" />
            Current Role Holders
          </h3>
          <button
            onClick={fetchHolders}
            className="text-gray-400 hover:text-gray-600"
          >
            <RefreshCw className={`h-4 w-4 ${loadingHolders ? "animate-spin" : ""}`} />
          </button>
        </div>

        {loadingHolders ? (
          <div className="text-center py-8 text-gray-400">
            <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
            Loading role holders...
          </div>
        ) : holders.length === 0 ? (
          <div className="text-center py-8 text-gray-400 bg-gray-50 rounded-lg border border-dashed">
            <Shield className="h-8 w-8 mx-auto mb-2 opacity-40" />
            No role holders found (event scanning may be limited).
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-gray-500 uppercase tracking-wider">
                  <th className="pb-2 pr-4">Address</th>
                  <th className="pb-2 pr-4">Role</th>
                  <th className="pb-2 pr-4">Contract</th>
                  <th className="pb-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {holders.map((h, idx) => (
                  <tr key={`${h.roleHash}-${h.address}-${idx}`} className="border-b last:border-0">
                    <td className="py-3 pr-4 font-mono text-gray-700">
                      {truncateAddress(h.address)}
                    </td>
                    <td className="py-3 pr-4">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        h.roleName === "PLATFORM_ADMIN"
                          ? "bg-red-100 text-red-700"
                          : "bg-indigo-100 text-indigo-700"
                      }`}>
                        {h.roleName}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-gray-500 capitalize">{h.contractName}</td>
                    <td className="py-3">
                      <button
                        onClick={() => handleRevoke(h)}
                        className="text-red-500 hover:text-red-700 text-xs flex items-center gap-1"
                        disabled={loading}
                      >
                        <UserMinus className="h-3.5 w-3.5" />
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Grant Role Form */}
      <div className="card">
        <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2 mb-4">
          <UserPlus className="h-5 w-5 text-green-500" />
          Grant Role
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_auto] gap-4 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Role</label>
            <select
              className="input text-sm"
              value={grantRoleName}
              onChange={(e) => {
                setGrantRoleName(e.target.value);
                setGrantContract(ROLE_CONTRACT_MAP[e.target.value] || "dispute");
              }}
            >
              {MANAGEABLE_ROLES.map((r) => (
                <option key={r.name} value={r.name}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Address</label>
            <input
              type="text"
              placeholder="0x..."
              className="input text-sm font-mono"
              value={grantAddress}
              onChange={(e) => setGrantAddress(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Contract</label>
            <select
              className="input text-sm"
              value={grantContract}
              onChange={(e) => setGrantContract(e.target.value as ContractName)}
            >
              <option value="dispute">Dispute</option>
              <option value="jobEscrow">Job Escrow</option>
              <option value="reputation">Reputation</option>
              <option value="dataAvailability">Data Availability</option>
            </select>
          </div>

          <TransactionButton
            onClick={handleGrant}
            isLoading={loading}
            variant="primary"
          >
            <UserPlus className="mr-1 h-4 w-4" />
            Grant
          </TransactionButton>
        </div>
      </div>
    </div>
  );
}
