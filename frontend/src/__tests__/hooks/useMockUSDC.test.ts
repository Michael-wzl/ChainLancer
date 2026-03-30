/**
 * Tests for hooks/useMockUSDC.ts — USDC mint, approve, balance operations
 *
 * Covers Stage 2 §3.5: Mint Test USDC, and §9: USDC hooks
 * - mint() calls contract with correct args
 * - approve() calls contract
 * - approveJobEscrow() approves MaxUint256 by default
 * - getBalance() returns bigint
 * - getAllowance() returns bigint
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("../../contexts/ContractContext", () => ({
  useContracts: vi.fn(),
}));

vi.mock("../../contexts/WalletContext", () => ({
  useWallet: vi.fn(),
}));

vi.mock("react-hot-toast", () => ({
  default: {
    loading: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../config/contracts", () => ({
  getContractAddresses: vi.fn().mockReturnValue({
    MockUSDC: "0x1234567890123456789012345678901234567890",
    JobEscrow: "0x2345678901234567890123456789012345678901",
    Dispute: "0x3456789012345678901234567890123456789012",
    Reputation: "0x4567890123456789012345678901234567890123",
    DataAvailability: "0x5678901234567890123456789012345678901234",
  }),
}));

import { useContracts } from "../../contexts/ContractContext";
import { useWallet } from "../../contexts/WalletContext";
import { useMockUSDC } from "../../hooks/useMockUSDC";
import toast from "react-hot-toast";

describe("hooks/useMockUSDC", () => {
  const mockReceipt = { status: 1 };
  const mockTx = { hash: "0x", wait: vi.fn().mockResolvedValue(mockReceipt) };

  const mockContracts = {
    mockUSDC: {
      mint: vi.fn().mockResolvedValue(mockTx),
      approve: vi.fn().mockResolvedValue(mockTx),
      balanceOf: vi.fn().mockResolvedValue(100_000_000n),
      allowance: vi.fn().mockResolvedValue(50_000_000n),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useContracts).mockReturnValue({
      contracts: mockContracts as any,
      readContracts: mockContracts as any,
      isReady: true,
    });
    vi.mocked(useWallet).mockReturnValue({
      address: "0xUserAddr",
      isConnected: true,
      chainId: 31337,
      provider: null,
      signer: null,
      isCorrectNetwork: true,
      isConnecting: false,
      connect: vi.fn(),
      disconnect: vi.fn(),
      switchNetwork: vi.fn(),
    } as any);
  });

  it("should mint USDC with correct args", async () => {
    const { result } = renderHook(() => useMockUSDC());

    await act(async () => {
      await result.current.mint("0xRecipient", 100_000_000_000n);
    });

    expect(mockContracts.mockUSDC.mint).toHaveBeenCalledWith(
      "0xRecipient",
      100_000_000_000n
    );
    expect(toast.success).toHaveBeenCalledWith("USDC minted!", { id: "mint" });
  });

  it("should approve USDC with correct args", async () => {
    const { result } = renderHook(() => useMockUSDC());

    await act(async () => {
      await result.current.approve("0xSpender", 1000000n);
    });

    expect(mockContracts.mockUSDC.approve).toHaveBeenCalledWith(
      "0xSpender",
      1000000n
    );
    expect(toast.success).toHaveBeenCalledWith("USDC approved!", { id: "approve" });
  });

  it("should approveJobEscrow with MaxUint256 by default", async () => {
    const { result } = renderHook(() => useMockUSDC());

    await act(async () => {
      await result.current.approveJobEscrow();
    });

    expect(mockContracts.mockUSDC.approve).toHaveBeenCalledWith(
      "0x2345678901234567890123456789012345678901",
      expect.any(BigInt) // MaxUint256
    );
  });

  it("should get balance", async () => {
    const { result } = renderHook(() => useMockUSDC());

    let balance: bigint;
    await act(async () => {
      balance = await result.current.getBalance();
    });

    expect(balance!).toBe(100_000_000n);
    expect(mockContracts.mockUSDC.balanceOf).toHaveBeenCalledWith("0xUserAddr");
  });

  it("should get allowance", async () => {
    const { result } = renderHook(() => useMockUSDC());

    let allowance: bigint;
    await act(async () => {
      allowance = await result.current.getAllowance("0xSpender");
    });

    expect(allowance!).toBe(50_000_000n);
    expect(mockContracts.mockUSDC.allowance).toHaveBeenCalledWith(
      "0xUserAddr",
      "0xSpender"
    );
  });

  it("should show error toast on mint failure", async () => {
    mockContracts.mockUSDC.mint.mockRejectedValueOnce(
      new Error("ERC20: transfer amount exceeds balance")
    );

    const { result } = renderHook(() => useMockUSDC());

    await expect(
      act(async () => {
        await result.current.mint("0x", 999n);
      })
    ).rejects.toThrow();

    expect(toast.error).toHaveBeenCalled();
  });
});
