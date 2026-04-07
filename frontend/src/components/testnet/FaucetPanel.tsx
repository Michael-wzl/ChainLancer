import React, { useState, useEffect, useCallback } from "react";
import { Coins, CheckCircle } from "lucide-react";
import { useMockUSDC } from "../../hooks/useMockUSDC";
import { useWallet } from "../../contexts/WalletContext";
import { TransactionButton } from "../common/TransactionButton";
import { parseUSDC, formatUSDC } from "../../utils/format";
import { getTargetNetwork } from "../../config/networks";
import { getContractAddresses } from "../../config/contracts";

/** Networks where the faucet is available (MockUSDC deployed) */
const FAUCET_NETWORKS = new Set(["Hardhat Local", "Base Sepolia", "Sepolia"]);

export function FaucetPanel() {
  const { address } = useWallet();
  const { mint, approveJobEscrow, getAllowance, isLoading } = useMockUSDC();
  const [mintAmount, setMintAmount] = useState("10000");
  const [approved, setApproved] = useState(false);
  const [checkingAllowance, setCheckingAllowance] = useState(false);

  // Check on-chain allowance whenever the connected address changes
  const checkAllowance = useCallback(async () => {
    if (!address) {
      setApproved(false);
      return;
    }
    const addresses = getContractAddresses();
    if (!addresses.JobEscrow) {
      setApproved(false);
      return;
    }
    setCheckingAllowance(true);
    try {
      const allowance = await getAllowance(addresses.JobEscrow, address);
      // Consider "approved" if allowance is greater than a reasonable threshold
      // (e.g. > 1,000,000 USDC = 1_000_000 * 10^6)
      setApproved(allowance > 1_000_000_000_000n);
    } catch (err) {
      console.error("Failed to check allowance:", err);
      setApproved(false);
    } finally {
      setCheckingAllowance(false);
    }
  }, [address, getAllowance]);

  useEffect(() => {
    checkAllowance();
  }, [checkAllowance]);

  const handleMint = async () => {
    if (!address) return;
    const amount = parseUSDC(mintAmount);
    await mint(address, amount);
  };

  const handleApprove = async () => {
    await approveJobEscrow();
    // Re-check on-chain allowance after approval
    await checkAllowance();
  };

  // Only show faucet on testnets where MockUSDC is deployed
  const network = getTargetNetwork();
  if (!FAUCET_NETWORKS.has(network.name)) {
    return null;
  }

  return (
    <div className="card bg-gradient-to-r from-purple-50 to-blue-50 border-purple-200">
      <div className="flex items-center gap-2 mb-4">
        <Coins className="h-5 w-5 text-purple-600" />
        <h3 className="text-sm font-semibold text-purple-900">Testnet Faucet</h3>
        <span className="text-xs bg-purple-100 text-purple-700 rounded-full px-2 py-0.5">
          Demo Only
        </span>
      </div>

      <div className="space-y-3">
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <label className="label">Amount (USDC)</label>
            <input
              type="text"
              value={mintAmount}
              onChange={(e) => setMintAmount(e.target.value)}
              className="input"
              placeholder="10000"
            />
          </div>
          <TransactionButton
            onClick={handleMint}
            isLoading={isLoading}
            variant="primary"
          >
            <Coins className="mr-1.5 h-4 w-4" /> Mint
          </TransactionButton>
        </div>

        <div>
          <TransactionButton
            onClick={handleApprove}
            isLoading={isLoading || checkingAllowance}
            variant="secondary"
            disabled={approved}
          >
            {approved ? (
              <>
                <CheckCircle className="mr-1.5 h-4 w-4 text-green-500" /> Approved
              </>
            ) : (
              "Approve JobEscrow (Unlimited)"
            )}
          </TransactionButton>
          <p className="mt-1 text-xs text-gray-400">
            Required before posting jobs or staking deposits.
          </p>
        </div>
      </div>
    </div>
  );
}
