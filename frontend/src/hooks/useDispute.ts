import { useState, useCallback } from "react";
import { ethers } from "ethers";
import { useContracts } from "../contexts/ContractContext";
import { useWallet } from "../contexts/WalletContext";
import { parseContractError } from "../utils/errors";
import { DisputePhase, Ruling } from "../config/constants";
import toast from "react-hot-toast";

// ─── Types ───

export interface DisputeDetails {
  disputeId: number;
  jobId: number;
  milestoneIdx: number;
  initiator: string;
  client: string;
  freelancer: string;
  milestoneValue: bigint;
  judge: string;
  phase: DisputePhase;
  ruling: Ruling;
  ephemeralPubKey: string;
  clientKeySubmitted: boolean;
  freelancerKeySubmitted: boolean;
  reasoningHash: string;
  freelancerShareBps: number;
  depositSlashBps: number;
}

export interface DisputeDeadlines {
  evidenceDeadline: number;
  keyDistributionDeadline: number;
  rulingDeadline: number;
}

export interface EvidenceItem {
  submitter: string;
  evidenceHash: string;
  evidenceCID: string;
  submittedAt: number;
}

// ─── Hook ───

export function useDispute() {
  const { contracts, readContracts } = useContracts();
  const { address } = useWallet();
  const [loading, setLoading] = useState(false);

  // ── Write helper (same pattern as useJobEscrow) ──
  const execute = useCallback(
    async (
      fn: () => Promise<ethers.ContractTransactionResponse>,
      successMsg: string,
      toastId: string
    ) => {
      setLoading(true);
      try {
        const tx = await fn();
        toast.loading("Transaction pending...", { id: toastId });
        await tx.wait();
        toast.success(successMsg, { id: toastId });
        return tx;
      } catch (err) {
        toast.error(parseContractError(err), { id: toastId });
        throw err;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // ═══════════════════════════════════════════
  //            WRITE OPERATIONS
  // ═══════════════════════════════════════════

  const submitEvidence = useCallback(
    async (disputeId: number, evidenceHash: string, evidenceCID: string) => {
      if (!contracts.dispute) throw new Error("Contract not ready");
      return execute(
        () => contracts.dispute!.submitEvidence(disputeId, evidenceHash, evidenceCID),
        "Evidence submitted!",
        "evidence"
      );
    },
    [contracts.dispute, execute]
  );

  const closeEvidencePhase = useCallback(
    async (disputeId: number) => {
      if (!contracts.dispute) throw new Error("Contract not ready");
      return execute(
        () => contracts.dispute!.closeEvidencePhase(disputeId),
        "Evidence phase closed!",
        "close-evidence"
      );
    },
    [contracts.dispute, execute]
  );

  const distributeKeyToJudge = useCallback(
    async (disputeId: number, encryptedJobKey: Uint8Array | string) => {
      if (!contracts.dispute) throw new Error("Contract not ready");
      const keyBytes =
        typeof encryptedJobKey === "string"
          ? ethers.getBytes(encryptedJobKey)
          : encryptedJobKey;
      return execute(
        () => contracts.dispute!.distributeKeyToJudge(disputeId, keyBytes),
        "Key submitted to judge!",
        "distribute-key"
      );
    },
    [contracts.dispute, execute]
  );

  const claimKeyDefault = useCallback(
    async (disputeId: number) => {
      if (!contracts.dispute) throw new Error("Contract not ready");
      return execute(
        () => contracts.dispute!.claimKeyDefault(disputeId),
        "Key default claimed — ruling applied!",
        "key-default"
      );
    },
    [contracts.dispute, execute]
  );

  const submitRuling = useCallback(
    async (
      disputeId: number,
      ruling: number,
      reasoningHash: string,
      freelancerShareBps: number,
      depositSlashBps: number
    ) => {
      if (!contracts.dispute) throw new Error("Contract not ready");
      return execute(
        () =>
          contracts.dispute!.submitRuling(
            disputeId,
            ruling,
            reasoningHash,
            freelancerShareBps,
            depositSlashBps
          ),
        "Ruling submitted!",
        "submit-ruling"
      );
    },
    [contracts.dispute, execute]
  );

  const claimRulingDefault = useCallback(
    async (disputeId: number) => {
      if (!contracts.dispute) throw new Error("Contract not ready");
      return execute(
        () => contracts.dispute!.claimRulingDefault(disputeId),
        "Ruling default claimed — judge removed, dispute reset to AwaitingJudge!",
        "ruling-default"
      );
    },
    [contracts.dispute, execute]
  );

  const executeRuling = useCallback(
    async (disputeId: number) => {
      if (!contracts.dispute) throw new Error("Contract not ready");
      return execute(
        () => contracts.dispute!.executeRuling(disputeId),
        "Ruling executed — funds redistributed!",
        "execute-ruling"
      );
    },
    [contracts.dispute, execute]
  );

  // ═══════════════════════════════════════════
  //            READ OPERATIONS
  // ═══════════════════════════════════════════

  const fetchDisputeDetails = useCallback(
    async (disputeId: number): Promise<DisputeDetails | null> => {
      if (!readContracts.dispute) return null;
      try {
        const details = await readContracts.dispute.getDisputeDetails(disputeId);
        const d = await readContracts.dispute.disputes(disputeId);

        return {
          disputeId,
          jobId: Number(details[0]),
          milestoneIdx: Number(details[1]),
          initiator: details[2],
          client: details[3],
          freelancer: details[4],
          milestoneValue: details[5] as bigint,
          judge: details[6],
          phase: Number(details[7]) as DisputePhase,
          ruling: Number(details[8]) as Ruling,
          ephemeralPubKey: d.ephemeralPubKey ? ethers.hexlify(d.ephemeralPubKey) : "",
          clientKeySubmitted: d.clientKeySubmitted,
          freelancerKeySubmitted: d.freelancerKeySubmitted,
          reasoningHash: d.reasoningHash,
          freelancerShareBps: Number(d.freelancerShareBps),
          depositSlashBps: Number(d.depositSlashBps),
        };
      } catch (err) {
        console.error("Failed to fetch dispute details:", err);
        return null;
      }
    },
    [readContracts.dispute]
  );

  const fetchDisputeDeadlines = useCallback(
    async (disputeId: number): Promise<DisputeDeadlines | null> => {
      if (!readContracts.dispute) return null;
      try {
        const deadlines = await readContracts.dispute.getDisputeDeadlines(disputeId);
        return {
          evidenceDeadline: Number(deadlines[0]),
          keyDistributionDeadline: Number(deadlines[1]),
          rulingDeadline: Number(deadlines[2]),
        };
      } catch (err) {
        console.error("Failed to fetch dispute deadlines:", err);
        return null;
      }
    },
    [readContracts.dispute]
  );

  const fetchEvidence = useCallback(
    async (disputeId: number): Promise<EvidenceItem[]> => {
      if (!readContracts.dispute) return [];
      try {
        const count = Number(await readContracts.dispute.getEvidenceCount(disputeId));
        const items: EvidenceItem[] = [];
        for (let i = 0; i < count; i++) {
          const ev = await readContracts.dispute.getEvidence(disputeId, i);
          items.push({
            submitter: ev[0] || ev.submitter,
            evidenceHash: ev[1] || ev.evidenceHash,
            evidenceCID: ev[2] || ev.evidenceCID,
            submittedAt: Number(ev[3] || ev.submittedAt),
          });
        }
        return items;
      } catch (err) {
        console.error("Failed to fetch evidence:", err);
        return [];
      }
    },
    [readContracts.dispute]
  );

  const fetchEncryptedKey = useCallback(
    async (disputeId: number, party: string): Promise<string> => {
      if (!readContracts.dispute) return "";
      try {
        const key = await readContracts.dispute.getEncryptedKey(disputeId, party);
        return ethers.hexlify(key);
      } catch (err) {
        console.error("Failed to fetch encrypted key:", err);
        return "";
      }
    },
    [readContracts.dispute]
  );

  const fetchJudgeDisputes = useCallback(
    async (judgeAddress: string): Promise<number[]> => {
      if (!readContracts.dispute) return [];
      try {
        // Use event filtering for JudgeAssigned events
        const filter = readContracts.dispute.filters.JudgeAssigned(null, judgeAddress);
        const events = await readContracts.dispute.queryFilter(filter);
        return events.map((e: any) => Number(e.args?.[0]));
      } catch (err) {
        console.error("Failed to fetch judge disputes:", err);
        // Fallback: iterate all disputes
        try {
          const nextId = Number(await readContracts.dispute!.nextDisputeId());
          const ids: number[] = [];
          for (let i = 0; i < nextId; i++) {
            const details = await readContracts.dispute!.getDisputeDetails(i);
            if (details[6]?.toLowerCase() === judgeAddress.toLowerCase()) {
              ids.push(i);
            }
          }
          return ids;
        } catch {
          return [];
        }
      }
    },
    [readContracts.dispute]
  );

  return {
    // Write
    submitEvidence,
    closeEvidencePhase,
    distributeKeyToJudge,
    claimKeyDefault,
    claimRulingDefault,
    submitRuling,
    executeRuling,

    // Read
    fetchDisputeDetails,
    fetchDisputeDeadlines,
    fetchEvidence,
    fetchEncryptedKey,
    fetchJudgeDisputes,

    loading,
  };
}
