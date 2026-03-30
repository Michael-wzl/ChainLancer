import React from "react";
import { Wallet, LogOut } from "lucide-react";
import { useWallet } from "../../contexts/WalletContext";
import { truncateAddress } from "../../utils/format";

export function ConnectButton() {
  const { isConnected, address, connect, disconnect, isConnecting } = useWallet();

  if (isConnected && address) {
    return (
      <div className="flex items-center gap-2">
        <span className="hidden sm:inline-flex items-center rounded-lg bg-gray-100 px-3 py-1.5 text-sm font-mono text-gray-700">
          {truncateAddress(address)}
        </span>
        <button
          onClick={disconnect}
          className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          title="Disconnect"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={connect}
      disabled={isConnecting}
      className="btn-primary"
    >
      <Wallet className="mr-2 h-4 w-4" />
      {isConnecting ? "Connecting..." : "Connect Wallet"}
    </button>
  );
}
