import React from "react";
import { AlertTriangle, Globe } from "lucide-react";
import { useWallet } from "../../contexts/WalletContext";
import { getTargetNetwork } from "../../config/networks";

export function NetworkBadge() {
  const { isConnected, isCorrectNetwork, chainId, switchNetwork } = useWallet();

  if (!isConnected) return null;

  const targetNetwork = getTargetNetwork();

  if (!isCorrectNetwork) {
    return (
      <button
        onClick={switchNetwork}
        className="flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 transition-colors"
      >
        <AlertTriangle className="h-3.5 w-3.5" />
        Switch to {targetNetwork.name}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5 rounded-lg bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700">
      <Globe className="h-3.5 w-3.5" />
      {targetNetwork.name}
    </div>
  );
}
