import React, { useEffect, useState } from "react";
import { DollarSign, RefreshCw } from "lucide-react";
import { useWallet } from "../../contexts/WalletContext";
import { useContracts } from "../../contexts/ContractContext";
import { formatUSDC } from "../../utils/format";

export function BalanceDisplay() {
  const { address, isConnected, isCorrectNetwork } = useWallet();
  const { readContracts } = useContracts();
  const [usdcBalance, setUsdcBalance] = useState<bigint>(0n);
  const [withdrawable, setWithdrawable] = useState<bigint>(0n);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    if (!address || !readContracts.mockUSDC || !readContracts.jobEscrow) return;
    setLoading(true);
    try {
      const [balance, withdrawBal] = await Promise.all([
        readContracts.mockUSDC.balanceOf(address),
        readContracts.jobEscrow.withdrawableBalances(address),
      ]);
      setUsdcBalance(balance);
      setWithdrawable(withdrawBal);
    } catch (err) {
      console.error("Failed to fetch balances:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isConnected && isCorrectNetwork) {
      refresh();
    }
  }, [address, isConnected, isCorrectNetwork, readContracts.mockUSDC]);

  if (!isConnected) return null;

  return (
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-1.5">
        <DollarSign className="h-4 w-4 text-green-600" />
        <span className="text-sm font-medium">{formatUSDC(usdcBalance)}</span>
        <span className="text-xs text-gray-400">USDC</span>
      </div>
      {withdrawable > 0n && (
        <div className="flex items-center gap-1.5 text-brand-600">
          <span className="text-sm font-medium">{formatUSDC(withdrawable)}</span>
          <span className="text-xs">withdrawable</span>
        </div>
      )}
      <button
        onClick={refresh}
        disabled={loading}
        className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
      </button>
    </div>
  );
}
