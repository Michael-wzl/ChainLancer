import { useEffect, useState, useCallback } from "react";
import { ethers } from "ethers";
import { useWallet } from "../contexts/WalletContext";
import { useContracts } from "../contexts/ContractContext";
import { DisputePhase, Ruling } from "../config/constants";

//── Types ───
export interface Dispute {
  disputeId: number;

  jobId: number;
  milestoneIdx: number;

  initiator: string;
  client: string;
  freelancer: string;
  judge: string;

  milestoneValue: bigint;

  evidenceDeadline: number;
  keyDistributionDeadline: number;
  rulingDeadline: number;

  clientKeySubmitted: boolean;
  freelancerKeySubmitted: boolean;

  ruling: Ruling;
  reasoningHash: string;

  freelancerShareBps: number;
  depositSlashBps: number;

  phase: DisputePhase;
}

// ─── Hook ───
export function useAssignedDisputes() {
  const { address } = useWallet();
  const { readContracts } = useContracts();

  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchDisputes = useCallback(async () => {
    if (!readContracts.dispute || !address) return;

    setLoading(true);

    try {
      const contract = readContracts.dispute;

      const totalDisputes = Number(await contract.nextDisputeId());
      const ids = Array.from({ length: totalDisputes }, (_, i) => i);

      const allDisputes = await Promise.all(
        ids.map((id) =>
          contract
            .disputes(id)
            .then((d: any) => ({ d, disputeId: id }))
            .catch(() => null),
        ),
      );

      const filtered: Dispute[] = allDisputes
        .filter((item): item is { d: any; disputeId: number } => item !== null)
        .filter(
          ({ d }) =>
            d.initiator !== ethers.ZeroAddress &&
            d.judge.toLowerCase() === address.toLowerCase(),
        )
        .map(({ d, disputeId }) => ({
          disputeId,

          jobId: Number(d.jobId),
          milestoneIdx: Number(d.milestoneIdx),

          initiator: d.initiator,
          client: d.client,
          freelancer: d.freelancer,
          judge: d.judge,

          milestoneValue: BigInt(d.milestoneValue),

          evidenceDeadline: Number(d.evidenceDeadline),
          keyDistributionDeadline: Number(d.keyDistributionDeadline),
          rulingDeadline: Number(d.rulingDeadline),

          clientKeySubmitted: d.clientKeySubmitted,
          freelancerKeySubmitted: d.freelancerKeySubmitted,

          ruling: Number(d.ruling) as Ruling,
          reasoningHash: d.reasoningHash,

          freelancerShareBps: Number(d.freelancerShareBps),
          depositSlashBps: Number(d.depositSlashBps),

          phase: Number(d.phase) as DisputePhase,
        }));

      setDisputes(filtered.reverse());
    } catch (err) {
      console.error("Failed to fetch disputes:", err);
      setDisputes([]);
    } finally {
      setLoading(false);
    }
  }, [readContracts.dispute, address]);

  useEffect(() => {
    fetchDisputes();
  }, [fetchDisputes]);

  return { disputes, loading, refresh: fetchDisputes };
}
