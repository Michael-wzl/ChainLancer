import React, { createContext, useContext, useReducer, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import { getTargetNetwork } from "../config/networks";
import toast from "react-hot-toast";

// ─── Types ───

interface WalletState {
  isConnected: boolean;
  address: string | null;
  chainId: number | null;
  provider: ethers.BrowserProvider | null;
  signer: ethers.JsonRpcSigner | null;
  isCorrectNetwork: boolean;
  isConnecting: boolean;
}

type WalletAction =
  | { type: "CONNECT_START" }
  | { type: "CONNECT_SUCCESS"; address: string; chainId: number; provider: ethers.BrowserProvider; signer: ethers.JsonRpcSigner }
  | { type: "CONNECT_FAILURE" }
  | { type: "DISCONNECT" }
  | { type: "CHAIN_CHANGED"; chainId: number }
  | { type: "ACCOUNTS_CHANGED"; address: string | null };

interface WalletContextValue extends WalletState {
  connect: () => Promise<void>;
  disconnect: () => void;
  switchNetwork: () => Promise<void>;
}

// ─── Initial state ───

const initialState: WalletState = {
  isConnected: false,
  address: null,
  chainId: null,
  provider: null,
  signer: null,
  isCorrectNetwork: false,
  isConnecting: false,
};

// ─── Reducer ───

function walletReducer(state: WalletState, action: WalletAction): WalletState {
  const targetNetwork = getTargetNetwork();

  switch (action.type) {
    case "CONNECT_START":
      return { ...state, isConnecting: true };

    case "CONNECT_SUCCESS":
      return {
        ...state,
        isConnected: true,
        address: action.address,
        chainId: action.chainId,
        provider: action.provider,
        signer: action.signer,
        isCorrectNetwork: action.chainId === targetNetwork.chainId,
        isConnecting: false,
      };

    case "CONNECT_FAILURE":
      return { ...state, isConnecting: false };

    case "DISCONNECT":
      return { ...initialState };

    case "CHAIN_CHANGED":
      return {
        ...state,
        chainId: action.chainId,
        isCorrectNetwork: action.chainId === targetNetwork.chainId,
      };

    case "ACCOUNTS_CHANGED":
      if (!action.address) {
        return { ...initialState };
      }
      return { ...state, address: action.address };

    default:
      return state;
  }
}

// ─── Context ───

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(walletReducer, initialState);

  const connect = useCallback(async () => {
    if (!window.ethereum) {
      toast.error("MetaMask is not installed. Please install MetaMask.");
      return;
    }

    dispatch({ type: "CONNECT_START" });

    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      await provider.send("eth_requestAccounts", []);
      const signer = await provider.getSigner();
      const address = await signer.getAddress();
      const network = await provider.getNetwork();
      const chainId = Number(network.chainId);

      dispatch({
        type: "CONNECT_SUCCESS",
        address,
        chainId,
        provider,
        signer,
      });

      // Store for auto-reconnect
      localStorage.setItem("chainlancer_connected", "true");
      toast.success("Wallet connected!", { id: "wallet-connect" });
    } catch (err) {
      console.error("Failed to connect wallet:", err);
      dispatch({ type: "CONNECT_FAILURE" });
      toast.error("Failed to connect wallet.");
    }
  }, []);

  const disconnect = useCallback(() => {
    dispatch({ type: "DISCONNECT" });
    localStorage.removeItem("chainlancer_connected");
    toast.success("Wallet disconnected.");
  }, []);

  const switchNetwork = useCallback(async () => {
    if (!window.ethereum) return;
    const target = getTargetNetwork();

    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: target.chainIdHex }],
      } as never);
    } catch (switchError: unknown) {
      // Chain not added — try to add it
      if ((switchError as { code?: number }).code === 4902) {
        try {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: target.chainIdHex,
                chainName: target.name,
                rpcUrls: [target.rpcUrl],
                blockExplorerUrls: target.blockExplorerUrl
                  ? [target.blockExplorerUrl]
                  : [],
                nativeCurrency: target.nativeCurrency,
              },
            ],
          } as never);
        } catch {
          toast.error("Failed to add network to MetaMask.");
        }
      } else {
        toast.error("Failed to switch network.");
      }
    }
  }, []);

  // ─── Event listeners ───

  useEffect(() => {
    if (!window.ethereum) return;

    const handleAccountsChanged = async (...args: unknown[]) => {
      const accounts = args[0] as string[];
      if (accounts.length === 0) {
        dispatch({ type: "DISCONNECT" });
        localStorage.removeItem("chainlancer_connected");
      } else {
        // Create a fresh provider and signer for the new account.
        // Using state.provider from the closure can be stale and may
        // return the old signer, so we always re-create from window.ethereum.
        try {
          const freshProvider = new ethers.BrowserProvider(window.ethereum!);
          const signer = await freshProvider.getSigner();
          const address = await signer.getAddress();
          const network = await freshProvider.getNetwork();
          dispatch({
            type: "CONNECT_SUCCESS",
            address,
            chainId: Number(network.chainId),
            provider: freshProvider,
            signer,
          });
        } catch (err) {
          console.error("Failed to re-establish signer after account switch:", err);
          dispatch({ type: "ACCOUNTS_CHANGED", address: accounts[0] });
        }
      }
    };

    const handleChainChanged = (...args: unknown[]) => {
      const chainIdHex = args[0] as string;
      dispatch({ type: "CHAIN_CHANGED", chainId: parseInt(chainIdHex, 16) });
      // Reload to reset contract instances
      window.location.reload();
    };

    window.ethereum.on("accountsChanged", handleAccountsChanged);
    window.ethereum.on("chainChanged", handleChainChanged);

    return () => {
      window.ethereum?.removeListener("accountsChanged", handleAccountsChanged);
      window.ethereum?.removeListener("chainChanged", handleChainChanged);
    };
  }, [state.provider]);

  // ─── Auto-reconnect ───

  useEffect(() => {
    const wasConnected = localStorage.getItem("chainlancer_connected") === "true";
    if (wasConnected && window.ethereum) {
      connect();
    }
  }, [connect]);

  const contextValue: WalletContextValue = {
    ...state,
    connect,
    disconnect,
    switchNetwork,
  };

  return (
    <WalletContext.Provider value={contextValue}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error("useWallet must be used within a WalletProvider");
  }
  return context;
}
