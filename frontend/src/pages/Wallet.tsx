import React, { useState, useEffect, useCallback } from "react";
import {
  Wallet as WalletIcon,
  DollarSign,
  RefreshCw,
  ArrowDownCircle,
  Key,
  Trash2,
} from "lucide-react";
import { useWallet } from "../contexts/WalletContext";
import { useContracts } from "../contexts/ContractContext";
import { useMockUSDC } from "../hooks/useMockUSDC";
import { useJobEscrow } from "../hooks/useJobEscrow";
import { TransactionButton } from "../components/common/TransactionButton";
import { BalanceDisplay } from "../components/wallet/BalanceDisplay";
import { FaucetPanel } from "../components/testnet/FaucetPanel";
import { formatUSDC, truncateAddress } from "../utils/format";
import { getAllJobKeys, removeJobKey } from "../utils/storage";

export default function Wallet() {
  const { address, isConnected, chainId } = useWallet();
  const { readContracts } = useContracts();
  const { withdraw, isLoading: withdrawLoading } = useJobEscrow();
  const { getBalance, isLoading: usdcLoading } = useMockUSDC();

  const [usdcBalance, setUsdcBalance] = useState<bigint>(0n);
  const [withdrawable, setWithdrawable] = useState<bigint>(0n);
  const [storedKeys, setStoredKeys] = useState<Record<string, string>>({});

  const refreshBalances = useCallback(async () => {
    if (!address) return;

    const bal = await getBalance();
    setUsdcBalance(bal);

    if (readContracts.jobEscrow) {
      try {
        const w = await readContracts.jobEscrow.withdrawableBalances(address);
        setWithdrawable(w as bigint);
      } catch (err) {
        console.error("Failed to fetch withdrawable balance:", err);
        setWithdrawable(0n);
      }
    }
  }, [address, getBalance, readContracts.jobEscrow]);

  useEffect(() => {
    refreshBalances();
  }, [refreshBalances]);

  // Load stored keys — scoped to the connected address
  useEffect(() => {
    setStoredKeys(getAllJobKeys(address ?? undefined));
  }, [address]);

  const handleWithdraw = async () => {
    await withdraw();
    refreshBalances();
  };

  const handleRemoveKey = (jobId: string) => {
    removeJobKey(Number(jobId), address ?? undefined);
    setStoredKeys(getAllJobKeys(address ?? undefined));
  };

  if (!isConnected || !address) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <WalletIcon className="h-16 w-16 text-gray-300 mb-4" />
        <h2 className="text-xl font-semibold text-gray-600">
          Connect your wallet to manage funds
        </h2>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Wallet</h1>
        <p className="text-sm text-gray-500 font-mono">{address}</p>
      </div>

      {/* Balances */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="card">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="h-5 w-5 text-green-500" />
            <span className="text-sm font-medium text-gray-600">
              USDC Balance
            </span>
          </div>
          <p className="text-2xl font-bold text-gray-900">
            {formatUSDC(usdcBalance)}
          </p>
          <button
            onClick={refreshBalances}
            className="mt-2 text-xs text-brand-600 hover:underline flex items-center gap-1"
          >
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
        </div>

        <div className="card">
          <div className="flex items-center gap-2 mb-2">
            <ArrowDownCircle className="h-5 w-5 text-brand-500" />
            <span className="text-sm font-medium text-gray-600">
              Withdrawable
            </span>
          </div>
          <p className="text-2xl font-bold text-brand-600">
            {formatUSDC(withdrawable)}
          </p>
          <div className="mt-2">
            <TransactionButton
              onClick={handleWithdraw}
              isLoading={withdrawLoading}
              disabled={withdrawable === 0n}
              variant="success"
              className="text-xs"
            >
              <ArrowDownCircle className="mr-1 h-3.5 w-3.5" /> Withdraw
            </TransactionButton>
          </div>
        </div>
      </div>

      {/* Faucet */}
      <FaucetPanel />

      {/* Stored Keys */}
      <div className="card">
        <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
          <Key className="h-4 w-4" /> Stored Job Keys
        </h2>
        <p className="text-xs text-gray-400 mb-3">
          Encryption keys stored locally for your jobs. These are needed to
          decrypt agreements and deliverables.
        </p>

        {Object.keys(storedKeys).length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">
            No stored keys.
          </p>
        ) : (
          <div className="space-y-2">
            {Object.entries(storedKeys).map(([jobId, keyHex]) => (
              <div
                key={jobId}
                className="flex items-center justify-between rounded-lg border border-gray-200 p-3"
              >
                <div>
                  <p className="text-sm font-medium text-gray-700">
                    Job #{jobId}
                  </p>
                  <p className="text-xs text-gray-400 font-mono truncate max-w-xs">
                    {keyHex.slice(0, 16)}…{keyHex.slice(-8)}
                  </p>
                </div>
                <button
                  onClick={() => handleRemoveKey(jobId)}
                  className="text-red-400 hover:text-red-600"
                  title="Remove key"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Network info */}
      <div className="card bg-gray-50">
        <h3 className="text-sm font-semibold text-gray-600 mb-2">
          Network Info
        </h3>
        <div className="text-xs text-gray-500 space-y-1">
          <p>Chain ID: {chainId}</p>
          <p>Connected Address: {truncateAddress(address)}</p>
        </div>
      </div>
    </div>
  );
}
