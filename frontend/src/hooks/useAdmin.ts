import { useState, useCallback } from "react";
import { ethers } from "ethers";
import { useContracts } from "../contexts/ContractContext";
import { useWallet } from "../contexts/WalletContext";
import { parseContractError } from "../utils/errors";
import { ROLES, DisputePhase, JobState } from "../config/constants";
import { getBlockTimestamp } from "./useBlockTimestamp";
import toast from "react-hot-toast";

// ─── Types ───

export type ContractName = "jobEscrow" | "dispute" | "reputation" | "dataAvailability";

export interface PlatformStats {
  totalJobs: number;
  openJobs: number;
  activeJobs: number;
  completedJobs: number;
  cancelledJobs: number;
  totalEscrowedValue: bigint;
  totalDisputes: number;
  activeDisputes: number;
  resolvedDisputes: number;
}

export interface PendingDispute {
  disputeId: number;
  jobId: number;
  milestoneIdx: number;
  client: string;
  freelancer: string;
  milestoneValue: bigint;
  phase: DisputePhase;
  /** Non-zero when phase is Evidence and deadline has expired (needs closeEvidencePhase) */
  evidenceDeadline?: number;
}

// ─── Hook ───

export function useAdmin() {
  const { contracts, readContracts } = useContracts();
  const { address } = useWallet();
  const [loading, setLoading] = useState(false);

  // ── Resolve contract by name ──
  const getContract = useCallback(
    (name: ContractName, write = true) => {
      const source = write ? contracts : readContracts;
      switch (name) {
        case "jobEscrow":
          return source.jobEscrow;
        case "dispute":
          return source.dispute;
        case "reputation":
          return source.reputation;
        case "dataAvailability":
          return source.dataAvailability;
      }
    },
    [contracts, readContracts]
  );

  // ═══════════════════════════════════════════
  //            WRITE OPERATIONS
  // ═══════════════════════════════════════════

  const grantRole = useCallback(
    async (contractName: ContractName, role: string, account: string) => {
      const contract = getContract(contractName, true);
      if (!contract) throw new Error("Contract not ready");

      setLoading(true);
      try {
        const tx = await contract.grantRole(role, account);
        toast.loading("Granting role...", { id: "grant-role" });
        await tx.wait();
        toast.success("Role granted!", { id: "grant-role" });
      } catch (err) {
        toast.error(parseContractError(err), { id: "grant-role" });
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [getContract]
  );

  const revokeRole = useCallback(
    async (contractName: ContractName, role: string, account: string) => {
      const contract = getContract(contractName, true);
      if (!contract) throw new Error("Contract not ready");

      setLoading(true);
      try {
        const tx = await contract.revokeRole(role, account);
        toast.loading("Revoking role...", { id: "revoke-role" });
        await tx.wait();
        toast.success("Role revoked!", { id: "revoke-role" });
      } catch (err) {
        toast.error(parseContractError(err), { id: "revoke-role" });
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [getContract]
  );

  const assignJudge = useCallback(
    async (disputeId: number, judgeAddress: string, ephemeralPubKey: string) => {
      if (!contracts.dispute) throw new Error("Contract not ready");

      if (!ethers.isAddress(judgeAddress)) {
        toast.error("Invalid judge address");
        return;
      }

      let formattedKey = ephemeralPubKey;
      if (!formattedKey.startsWith("0x")) {
        formattedKey = "0x" + formattedKey;
      }

      setLoading(true);
      try {
        const tx = await contracts.dispute.assignJudge(
          disputeId,
          judgeAddress,
          formattedKey
        );
        toast.loading("Assigning judge...", { id: "assign-judge" });
        await tx.wait();
        toast.success("Judge assigned!", { id: "assign-judge" });
      } catch (err) {
        toast.error(parseContractError(err), { id: "assign-judge" });
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [contracts.dispute]
  );

  // ═══════════════════════════════════════════
  //            READ OPERATIONS
  // ═══════════════════════════════════════════

  const hasRole = useCallback(
    async (contractName: ContractName, role: string, addr: string): Promise<boolean> => {
      const contract = getContract(contractName, false);
      if (!contract) return false;
      try {
        return await contract.hasRole(role, addr);
      } catch {
        return false;
      }
    },
    [getContract]
  );

  const getRoleHolders = useCallback(
    async (contractName: ContractName, role: string): Promise<string[]> => {
      const contract = getContract(contractName, false);
      if (!contract) return [];
      try {
        const grantedFilter = contract.filters.RoleGranted(role);
        const revokedFilter = contract.filters.RoleRevoked(role);

        const [grantedEvents, revokedEvents] = await Promise.all([
          contract.queryFilter(grantedFilter),
          contract.queryFilter(revokedFilter),
        ]);

        // Build net set: add from granted, remove from revoked
        const holders = new Set<string>();
        for (const event of grantedEvents) {
          const addr = (event as any).args?.[1] || (event as any).args?.account;
          if (addr) holders.add(addr.toLowerCase());
        }
        for (const event of revokedEvents) {
          const addr = (event as any).args?.[1] || (event as any).args?.account;
          if (addr) holders.delete(addr.toLowerCase());
        }

        return Array.from(holders);
      } catch (err) {
        console.error("Failed to get role holders:", err);
        return [];
      }
    },
    [getContract]
  );

  const fetchPlatformStats = useCallback(async (): Promise<PlatformStats> => {
    const stats: PlatformStats = {
      totalJobs: 0,
      openJobs: 0,
      activeJobs: 0,
      completedJobs: 0,
      cancelledJobs: 0,
      totalEscrowedValue: 0n,
      totalDisputes: 0,
      activeDisputes: 0,
      resolvedDisputes: 0,
    };

    try {
      // Job stats
      if (readContracts.jobEscrow) {
        const nextJobId = Number(await readContracts.jobEscrow.nextJobId());
        stats.totalJobs = nextJobId;

        for (let i = 0; i < nextJobId; i++) {
          try {
            const info = await readContracts.jobEscrow.getJobInfo(i);
            const state = Number(info[2]) as JobState;
            const totalValue = info[3] as bigint;

            switch (state) {
              case JobState.Open:
              case JobState.Applications:
                stats.openJobs++;
                stats.totalEscrowedValue += totalValue;
                break;
              case JobState.Active:
                stats.activeJobs++;
                stats.totalEscrowedValue += totalValue;
                break;
              case JobState.Completed:
                stats.completedJobs++;
                break;
              case JobState.Cancelled:
              case JobState.Abandoned:
                stats.cancelledJobs++;
                break;
            }
          } catch {
            // Skip non-existent jobs
          }
        }
      }

      // Dispute stats
      if (readContracts.dispute) {
        const nextDisputeId = Number(await readContracts.dispute.nextDisputeId());
        stats.totalDisputes = nextDisputeId;

        for (let i = 0; i < nextDisputeId; i++) {
          try {
            const details = await readContracts.dispute.getDisputeDetails(i);
            const phase = Number(details[7]) as DisputePhase;

            if (phase === DisputePhase.Executed) {
              stats.resolvedDisputes++;
            } else {
              stats.activeDisputes++;
            }
          } catch {
            // Skip
          }
        }
      }
    } catch (err) {
      console.error("Failed to fetch platform stats:", err);
    }

    return stats;
  }, [readContracts.jobEscrow, readContracts.dispute]);

  const fetchPendingDisputes = useCallback(async (): Promise<PendingDispute[]> => {
    if (!readContracts.dispute) return [];

    try {
      const nextId = Number(await readContracts.dispute.nextDisputeId());
      const pending: PendingDispute[] = [];
      const nowSec = await getBlockTimestamp();

      for (let i = 0; i < nextId; i++) {
        try {
          const details = await readContracts.dispute.getDisputeDetails(i);
          const phase = Number(details[7]) as DisputePhase;

          if (phase === DisputePhase.AwaitingJudge) {
            pending.push({
              disputeId: i,
              jobId: Number(details[0]),
              milestoneIdx: Number(details[1]),
              client: details[3],
              freelancer: details[4],
              milestoneValue: details[5] as bigint,
              phase,
            });
          } else if (phase === DisputePhase.Evidence) {
            // Also include Evidence-phase disputes whose deadline has expired
            // so the admin can close the evidence phase and proceed to judge assignment
            const deadlines = await readContracts.dispute.getDisputeDeadlines(i);
            const evidenceDeadline = Number(deadlines[0]);
            if (evidenceDeadline > 0 && nowSec > evidenceDeadline) {
              pending.push({
                disputeId: i,
                jobId: Number(details[0]),
                milestoneIdx: Number(details[1]),
                client: details[3],
                freelancer: details[4],
                milestoneValue: details[5] as bigint,
                phase,
                evidenceDeadline,
              });
            }
          }
        } catch {
          // Skip
        }
      }

      return pending;
    } catch (err) {
      console.error("Failed to fetch pending disputes:", err);
      return [];
    }
  }, [readContracts.dispute]);

  return {
    // Write
    grantRole,
    revokeRole,
    assignJudge,

    // Read
    hasRole,
    getRoleHolders,
    fetchPlatformStats,
    fetchPendingDisputes,

    loading,
  };
}
