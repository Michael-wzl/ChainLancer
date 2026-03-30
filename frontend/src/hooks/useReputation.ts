import { useState, useCallback, useEffect } from "react";
import { useContracts } from "../contexts/ContractContext";
import { Tier } from "../config/constants";

export interface FreelancerProfile {
  totalValueCompleted: bigint;
  jobsCompleted: number;
  disputesLost: number;
  reputationScore: bigint;
}

export interface ClientProfile {
  totalValueCompleted: bigint;
  jobsPosted: number;
  jobsCompleted: number;
  jobsCancelledAfterSelection: number;
  autoApproveCount: number;
  disputesLost: number;
  reputationScore: bigint;
}

export function useReputation() {
  const { readContracts } = useContracts();

  const getFreelancerProfile = useCallback(
    async (address: string): Promise<FreelancerProfile | null> => {
      if (!readContracts.reputation) return null;
      try {
        const result = await readContracts.reputation.getFreelancerProfile(address);
        return {
          totalValueCompleted: result[0],
          jobsCompleted: Number(result[1]),
          disputesLost: Number(result[2]),
          reputationScore: result[3],
        };
      } catch {
        return null;
      }
    },
    [readContracts.reputation]
  );

  const getClientProfile = useCallback(
    async (address: string): Promise<ClientProfile | null> => {
      if (!readContracts.reputation) return null;
      try {
        const result = await readContracts.reputation.getClientProfile(address);
        return {
          totalValueCompleted: result[0],
          jobsPosted: Number(result[1]),
          jobsCompleted: Number(result[2]),
          jobsCancelledAfterSelection: Number(result[3]),
          autoApproveCount: Number(result[4]),
          disputesLost: Number(result[5]),
          reputationScore: result[6],
        };
      } catch {
        return null;
      }
    },
    [readContracts.reputation]
  );

  const getClientTier = useCallback(
    async (address: string): Promise<Tier> => {
      if (!readContracts.reputation) return Tier.New;
      try {
        const tier = await readContracts.reputation.getClientTier(address);
        return Number(tier) as Tier;
      } catch {
        return Tier.New;
      }
    },
    [readContracts.reputation]
  );

  const getFreelancerScore = useCallback(
    async (address: string): Promise<bigint> => {
      if (!readContracts.reputation) return 0n;
      try {
        return await readContracts.reputation.getFreelancerScore(address);
      } catch {
        return 0n;
      }
    },
    [readContracts.reputation]
  );

  const getClientScore = useCallback(
    async (address: string): Promise<bigint> => {
      if (!readContracts.reputation) return 0n;
      try {
        return await readContracts.reputation.getClientScore(address);
      } catch {
        return 0n;
      }
    },
    [readContracts.reputation]
  );

  return {
    getFreelancerProfile,
    getClientProfile,
    getClientTier,
    getFreelancerScore,
    getClientScore,
  };
}

/**
 * Hook that fetches a specific user's profile data.
 */
export function useUserReputation(address: string | null) {
  const { getFreelancerProfile, getClientProfile, getClientTier } = useReputation();
  const [freelancerProfile, setFreelancerProfile] = useState<FreelancerProfile | null>(null);
  const [clientProfile, setClientProfile] = useState<ClientProfile | null>(null);
  const [clientTier, setClientTier] = useState<Tier>(Tier.New);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    try {
      const [fp, cp, tier] = await Promise.all([
        getFreelancerProfile(address),
        getClientProfile(address),
        getClientTier(address),
      ]);
      setFreelancerProfile(fp);
      setClientProfile(cp);
      setClientTier(tier);
    } finally {
      setLoading(false);
    }
  }, [address, getFreelancerProfile, getClientProfile, getClientTier]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { freelancerProfile, clientProfile, clientTier, loading, refresh };
}
