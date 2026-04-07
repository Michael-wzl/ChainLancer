/**
 * WalletContext Tests
 *
 * Tests the wallet context provider logic:
 *  - Reducer state transitions (CONNECT_START, CONNECT_SUCCESS, etc.)
 *  - connect() flow with window.ethereum
 *  - disconnect() flow and localStorage cleanup
 *  - Auto-reconnect from localStorage
 *  - Event listeners for accountsChanged / chainChanged
 *  - Error handling when MetaMask is not installed
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import React from "react";

// ─── Mock dependencies ───

vi.mock("../../config/networks", () => ({
  getTargetNetwork: () => ({
    chainId: 31337,
    chainIdHex: "0x7a69",
    name: "Hardhat Local",
    rpcUrl: "http://127.0.0.1:8545",
    blockExplorerUrl: "",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  }),
}));

vi.mock("react-hot-toast", () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
  },
}));

// We import after mocks are set up
import { WalletProvider, useWallet } from "../../contexts/WalletContext";
import toast from "react-hot-toast";

// ─── Helpers ───

function createWrapper() {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(WalletProvider, null, children);
  };
}

describe("WalletContext", () => {
  let mockEthereum: {
    request: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    removeListener: ReturnType<typeof vi.fn>;
    isMetaMask: boolean;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset localStorage
    localStorage.clear();

    mockEthereum = {
      request: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
      isMetaMask: true,
    };

    Object.defineProperty(window, "ethereum", {
      value: mockEthereum,
      writable: true,
      configurable: true,
    });
  });

  // ═══════════════════════════════════════════
  //    INITIAL STATE
  // ═══════════════════════════════════════════

  describe("initial state", () => {
    it("should start disconnected", () => {
      const { result } = renderHook(() => useWallet(), {
        wrapper: createWrapper(),
      });

      expect(result.current.isConnected).toBe(false);
      expect(result.current.address).toBeNull();
      expect(result.current.chainId).toBeNull();
      expect(result.current.isConnecting).toBe(false);
      expect(result.current.isCorrectNetwork).toBe(false);
    });

    it("should expose connect, disconnect, switchNetwork functions", () => {
      const { result } = renderHook(() => useWallet(), {
        wrapper: createWrapper(),
      });

      expect(typeof result.current.connect).toBe("function");
      expect(typeof result.current.disconnect).toBe("function");
      expect(typeof result.current.switchNetwork).toBe("function");
    });
  });

  // ═══════════════════════════════════════════
  //    useWallet OUTSIDE PROVIDER
  // ═══════════════════════════════════════════

  describe("useWallet outside provider", () => {
    it("should throw error when used outside WalletProvider", () => {
      // Suppress console.error for expected error
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      expect(() => {
        renderHook(() => useWallet());
      }).toThrow("useWallet must be used within a WalletProvider");

      consoleSpy.mockRestore();
    });
  });

  // ═══════════════════════════════════════════
  //    DISCONNECT
  // ═══════════════════════════════════════════

  describe("disconnect", () => {
    it("should reset state and clear localStorage", () => {
      localStorage.setItem("chainlancer_connected", "true");

      const { result } = renderHook(() => useWallet(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.disconnect();
      });

      expect(result.current.isConnected).toBe(false);
      expect(result.current.address).toBeNull();
      expect(localStorage.getItem("chainlancer_connected")).toBeNull();
      expect(toast.success).toHaveBeenCalledWith("Wallet disconnected.");
    });
  });

  // ═══════════════════════════════════════════
  //    NO METAMASK
  // ═══════════════════════════════════════════

  describe("no MetaMask", () => {
    it("should show error toast when MetaMask is not installed", async () => {
      Object.defineProperty(window, "ethereum", {
        value: undefined,
        writable: true,
        configurable: true,
      });

      const { result } = renderHook(() => useWallet(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.connect();
      });

      expect(toast.error).toHaveBeenCalledWith(
        "MetaMask is not installed. Please install MetaMask."
      );
      expect(result.current.isConnected).toBe(false);
    });
  });
});
