// ─── Deployed contract addresses (per network) ───
// After deploying via Remix IDE or Hardhat, update these addresses.

export interface ContractAddresses {
  MockUSDC: string;
  JobEscrow: string;
  Dispute: string;
  Reputation: string;
  DataAvailability: string;
}

/**
 * Reads addresses from env vars (set after deployment).
 * Falls back to zero addresses if not set.
 */
export function getContractAddresses(): ContractAddresses {
  return {
    MockUSDC: import.meta.env.VITE_MOCK_USDC_ADDRESS || "",
    JobEscrow: import.meta.env.VITE_JOB_ESCROW_ADDRESS || "",
    Dispute: import.meta.env.VITE_DISPUTE_ADDRESS || "",
    Reputation: import.meta.env.VITE_REPUTATION_ADDRESS || "",
    DataAvailability: import.meta.env.VITE_DATA_AVAILABILITY_ADDRESS || "",
  };
}

/**
 * Validate that all required contract addresses are set.
 */
export function validateContractAddresses(addresses: ContractAddresses): boolean {
  return Object.values(addresses).every(
    (addr) => addr && addr.length === 42 && addr.startsWith("0x")
  );
}
