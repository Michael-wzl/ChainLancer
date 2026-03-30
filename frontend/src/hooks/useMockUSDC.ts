import { useState, useCallback } from "react";
import { ethers } from "ethers";
import { useContracts } from "../contexts/ContractContext";
import { useWallet } from "../contexts/WalletContext";
import { parseContractError } from "../utils/errors";
import toast from "react-hot-toast";
import { getContractAddresses } from "../config/contracts";

/**
 * Hook for MockUSDC operations (testnet only).
 */
export function useMockUSDC() {
  const { contracts, readContracts } = useContracts();
  const { address } = useWallet();
  const [isLoading, setIsLoading] = useState(false);

  const mint = useCallback(
    async (to: string, amount: bigint) => {
      if (!contracts.mockUSDC) throw new Error("Contract not ready");
      setIsLoading(true);
      try {
        const tx = await contracts.mockUSDC.mint(to, amount);
        toast.loading("Minting USDC...", { id: "mint" });
        await tx.wait();
        toast.success("USDC minted!", { id: "mint" });
        return tx;
      } catch (err) {
        toast.error(parseContractError(err), { id: "mint" });
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [contracts.mockUSDC]
  );

  const approve = useCallback(
    async (spender: string, amount: bigint) => {
      if (!contracts.mockUSDC) throw new Error("Contract not ready");
      setIsLoading(true);
      try {
        const tx = await contracts.mockUSDC.approve(spender, amount);
        toast.loading("Approving USDC...", { id: "approve" });
        await tx.wait();
        toast.success("USDC approved!", { id: "approve" });
        return tx;
      } catch (err) {
        toast.error(parseContractError(err), { id: "approve" });
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [contracts.mockUSDC]
  );

  const approveJobEscrow = useCallback(
    async (amount?: bigint) => {
      const addresses = getContractAddresses();
      if (!addresses.JobEscrow) throw new Error("JobEscrow address not configured");
      return approve(addresses.JobEscrow, amount || ethers.MaxUint256);
    },
    [approve]
  );

  const getBalance = useCallback(
    async (account?: string): Promise<bigint> => {
      if (!readContracts.mockUSDC || !address) return 0n;
      try {
        return await readContracts.mockUSDC.balanceOf(account || address);
      } catch {
        return 0n;
      }
    },
    [readContracts.mockUSDC, address]
  );

  const getAllowance = useCallback(
    async (spender: string, owner?: string): Promise<bigint> => {
      if (!readContracts.mockUSDC || !address) return 0n;
      try {
        return await readContracts.mockUSDC.allowance(owner || address, spender);
      } catch {
        return 0n;
      }
    },
    [readContracts.mockUSDC, address]
  );

  return { isLoading, mint, approve, approveJobEscrow, getBalance, getAllowance };
}
