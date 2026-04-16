import React, { createContext, useContext, useMemo } from "react";
import { ethers } from "ethers";
import { useWallet } from "./WalletContext";
import { getContractAddresses } from "../config/contracts";
import { getTargetNetwork } from "../config/networks";

// ABIs
import JobEscrowABI from "../abis/JobEscrow.json";
import DisputeABI from "../abis/Dispute.json";
import ReputationABI from "../abis/Reputation.json";
import DataAvailabilityABI from "../abis/DataAvailability.json";
import MockUSDCABI from "../abis/MockUSDC.json";

// ─── Types ───

export interface ContractInstances {
  jobEscrow: ethers.Contract | null;
  dispute: ethers.Contract | null;
  reputation: ethers.Contract | null;
  dataAvailability: ethers.Contract | null;
  mockUSDC: ethers.Contract | null;
}

interface ContractContextValue {
  contracts: ContractInstances;
  /** Read-only contract instances (for fetching without a signer) */
  readContracts: ContractInstances;
  isReady: boolean;
}

// ─── Context ───

const ContractContext = createContext<ContractContextValue | null>(null);

export function ContractProvider({ children }: { children: React.ReactNode }) {
  const { provider, signer, isConnected, isCorrectNetwork } = useWallet();
  const addresses = getContractAddresses();

  // Write contracts (with signer)
  const contracts = useMemo<ContractInstances>(() => {
    if (!signer || !isConnected || !isCorrectNetwork) {
      return {
        jobEscrow: null,
        dispute: null,
        reputation: null,
        dataAvailability: null,
        mockUSDC: null,
      };
    }

    try {
      return {
        jobEscrow: addresses.JobEscrow
          ? new ethers.Contract(addresses.JobEscrow, JobEscrowABI, signer)
          : null,
        dispute: addresses.Dispute
          ? new ethers.Contract(addresses.Dispute, DisputeABI, signer)
          : null,
        reputation: addresses.Reputation
          ? new ethers.Contract(addresses.Reputation, ReputationABI, signer)
          : null,
        dataAvailability: addresses.DataAvailability
          ? new ethers.Contract(
              addresses.DataAvailability,
              DataAvailabilityABI,
              signer,
            )
          : null,
        mockUSDC: addresses.MockUSDC
          ? new ethers.Contract(addresses.MockUSDC, MockUSDCABI, signer)
          : null,
      };
    } catch (err) {
      console.error("Failed to create contract instances:", err);
      return {
        jobEscrow: null,
        dispute: null,
        reputation: null,
        dataAvailability: null,
        mockUSDC: null,
      };
    }
  }, [signer, isConnected, isCorrectNetwork, addresses]);

  // Bug #2 fix: Create a fallback JSON-RPC provider for read-only operations
  // so that Browse Jobs and Job Detail pages work without a wallet connection.
  const fallbackProvider = useMemo(() => {
    const network = getTargetNetwork();
    return new ethers.JsonRpcProvider(network.rpcUrl);
  }, []);

  // Read-only contracts (with wallet provider or fallback provider)
  const readContracts = useMemo<ContractInstances>(() => {
    const readProvider = fallbackProvider;

    try {
      return {
        jobEscrow: addresses.JobEscrow
          ? new ethers.Contract(addresses.JobEscrow, JobEscrowABI, readProvider)
          : null,
        dispute: addresses.Dispute
          ? new ethers.Contract(addresses.Dispute, DisputeABI, readProvider)
          : null,
        reputation: addresses.Reputation
          ? new ethers.Contract(
              addresses.Reputation,
              ReputationABI,
              readProvider,
            )
          : null,
        dataAvailability: addresses.DataAvailability
          ? new ethers.Contract(
              addresses.DataAvailability,
              DataAvailabilityABI,
              readProvider,
            )
          : null,
        mockUSDC: addresses.MockUSDC
          ? new ethers.Contract(addresses.MockUSDC, MockUSDCABI, readProvider)
          : null,
      };
    } catch (err) {
      console.error("Failed to create read contracts:", err);
      return {
        jobEscrow: null,
        dispute: null,
        reputation: null,
        dataAvailability: null,
        mockUSDC: null,
      };
    }
  }, [fallbackProvider, addresses]);

  const isReady = useMemo(() => {
    return !!(contracts.jobEscrow && contracts.mockUSDC);
  }, [contracts]);

  return (
    <ContractContext.Provider value={{ contracts, readContracts, isReady }}>
      {children}
    </ContractContext.Provider>
  );
}

export function useContracts(): ContractContextValue {
  const context = useContext(ContractContext);
  if (!context) {
    throw new Error("useContracts must be used within a ContractProvider");
  }
  return context;
}
