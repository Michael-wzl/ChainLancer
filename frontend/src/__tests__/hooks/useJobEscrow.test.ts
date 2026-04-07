/**
 * Tests for hooks/useJobEscrow.ts — JobEscrow write operations
 *
 * Covers Stage 2 §9.2: Hook Inventory — all JobEscrow write operations
 * - Each write hook wraps the contract method
 * - Shows toast notifications on success/error
 * - Returns tx + receipt on success
 * - Reports user-friendly error messages on failure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import React from "react";

// Mock dependencies
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

import { useContracts } from "../../contexts/ContractContext";
import { useWallet } from "../../contexts/WalletContext";
import { useJobEscrow } from "../../hooks/useJobEscrow";
import toast from "react-hot-toast";

describe("hooks/useJobEscrow", () => {
  const mockReceipt = { status: 1, hash: "0xtxhash" };
  const mockTx = {
    hash: "0xtxhash",
    wait: vi.fn().mockResolvedValue(mockReceipt),
  };

  const mockContracts = {
    jobEscrow: {
      postJob: vi.fn().mockResolvedValue(mockTx),
      applyForJob: vi.fn().mockResolvedValue(mockTx),
      selectFreelancer: vi.fn().mockResolvedValue(mockTx),
      confirmAndStake: vi.fn().mockResolvedValue(mockTx),
      rejectOffer: vi.fn().mockResolvedValue(mockTx),
      submitMilestone: vi.fn().mockResolvedValue(mockTx),
      approveMilestone: vi.fn().mockResolvedValue(mockTx),
      triggerAutoApprove: vi.fn().mockResolvedValue(mockTx),
      raiseDispute: vi.fn().mockResolvedValue(mockTx),
      cancelJob: vi.fn().mockResolvedValue(mockTx),
      requestCancellation: vi.fn().mockResolvedValue(mockTx),
      acceptCancellation: vi.fn().mockResolvedValue(mockTx),
      withdraw: vi.fn().mockResolvedValue(mockTx),
      claimAbandonment: vi.fn().mockResolvedValue(mockTx),
      withdrawExpiredJob: vi.fn().mockResolvedValue(mockTx),
      expireOffer: vi.fn().mockResolvedValue(mockTx),
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
      address: "0xClientAddr",
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

  it("should expose all write operations", () => {
    const { result } = renderHook(() => useJobEscrow());
    expect(result.current.postJob).toBeDefined();
    expect(result.current.applyForJob).toBeDefined();
    expect(result.current.selectFreelancer).toBeDefined();
    expect(result.current.confirmAndStake).toBeDefined();
    expect(result.current.rejectOffer).toBeDefined();
    expect(result.current.submitMilestone).toBeDefined();
    expect(result.current.approveMilestone).toBeDefined();
    expect(result.current.triggerAutoApprove).toBeDefined();
    expect(result.current.raiseDispute).toBeDefined();
    expect(result.current.cancelJob).toBeDefined();
    expect(result.current.requestCancellation).toBeDefined();
    expect(result.current.acceptCancellation).toBeDefined();
    expect(result.current.withdraw).toBeDefined();
    expect(result.current.claimAbandonment).toBeDefined();
    expect(result.current.withdrawExpiredJob).toBeDefined();
    expect(result.current.expireOffer).toBeDefined();
  });

  it("postJob should call contract method with correct args", async () => {
    const { result } = renderHook(() => useJobEscrow());

    await act(async () => {
      await result.current.postJob(
        "0xagreementhash",
        [1000000n, 2000000n],
        [1700000000, 1700100000],
        86400,
        "QmAgreementCID"
      );
    });

    expect(mockContracts.jobEscrow.postJob).toHaveBeenCalledWith(
      "0xagreementhash",
      [1000000n, 2000000n],
      [1700000000, 1700100000],
      86400,
      "QmAgreementCID"
    );
    expect(toast.success).toHaveBeenCalledWith("Job posted successfully!", { id: "tx" });
  });

  it("applyForJob should call contract method", async () => {
    const { result } = renderHook(() => useJobEscrow());

    await act(async () => {
      await result.current.applyForJob(1, "0xproposalhash", "QmProposalCID");
    });

    expect(mockContracts.jobEscrow.applyForJob).toHaveBeenCalledWith(1, "0xproposalhash", "QmProposalCID");
    expect(toast.success).toHaveBeenCalledWith("Application submitted!", { id: "tx" });
  });

  it("selectFreelancer should call contract method", async () => {
    const { result } = renderHook(() => useJobEscrow());
    const encKey = new Uint8Array([1, 2, 3]);

    await act(async () => {
      await result.current.selectFreelancer(1, "0xfreelancer", encKey);
    });

    expect(mockContracts.jobEscrow.selectFreelancer).toHaveBeenCalledWith(
      1,
      "0xfreelancer",
      encKey
    );
  });

  it("approveMilestone should call contract method", async () => {
    const { result } = renderHook(() => useJobEscrow());

    await act(async () => {
      await result.current.approveMilestone(1, 0);
    });

    expect(mockContracts.jobEscrow.approveMilestone).toHaveBeenCalledWith(1, 0);
    expect(toast.success).toHaveBeenCalledWith(
      "Milestone approved — funds released!",
      { id: "tx" }
    );
  });

  it("should show error toast on contract revert", async () => {
    mockContracts.jobEscrow.postJob.mockRejectedValueOnce(
      new Error("execution reverted: Only client")
    );

    const { result } = renderHook(() => useJobEscrow());

    await expect(
      act(async () => {
        await result.current.postJob("hash", [1000n], [1000], 86400, "cid");
      })
    ).rejects.toThrow();

    expect(toast.error).toHaveBeenCalledWith(
      "This action can only be performed by the job client.",
      { id: "tx" }
    );
  });

  it("should set isLoading=false after transaction completes", async () => {
    const { result } = renderHook(() => useJobEscrow());
    expect(result.current.isLoading).toBe(false);

    await act(async () => {
      await result.current.withdraw();
    });

    // After completion, isLoading should be false
    expect(result.current.isLoading).toBe(false);
    expect(toast.success).toHaveBeenCalledWith(
      "Funds withdrawn successfully!",
      { id: "tx" }
    );
  });

  it("raiseDispute should call contract method", async () => {
    const { result } = renderHook(() => useJobEscrow());

    await act(async () => {
      await result.current.raiseDispute(1, 0);
    });

    expect(mockContracts.jobEscrow.raiseDispute).toHaveBeenCalledWith(1, 0);
    expect(toast.success).toHaveBeenCalledWith("Dispute raised!", { id: "tx" });
  });

  it("should throw if contract is not ready", async () => {
    vi.mocked(useContracts).mockReturnValue({
      contracts: { jobEscrow: null } as any,
      readContracts: { jobEscrow: null } as any,
      isReady: false,
    });

    const { result } = renderHook(() => useJobEscrow());

    await expect(
      act(async () => {
        await result.current.postJob("hash", [1000n], [1000], 86400, "cid");
      })
    ).rejects.toThrow("Contract not ready");
  });
});
