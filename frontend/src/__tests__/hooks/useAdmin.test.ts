/**
 * useAdmin hook tests
 *
 * Tests the admin hook logic:
 *  - grantRole / revokeRole / assignJudge write operations
 *  - hasRole read operations
 *  - fetchPlatformStats aggregation
 *  - fetchPendingDisputes filtering
 *  - Error handling and toast notifications
 *  - Input validation (invalid addresses)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ─── Mock dependencies ───

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
import { useAdmin } from "../../hooks/useAdmin";
import toast from "react-hot-toast";
import { ROLES } from "../../config/constants";

describe("hooks/useAdmin", () => {
  const mockReceipt = { status: 1 };
  const mockTx = {
    hash: "0xtxhash",
    wait: vi.fn().mockResolvedValue(mockReceipt),
  };

  let mockContracts: any;
  let mockReadContracts: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockContracts = {
      jobEscrow: {
        grantRole: vi.fn().mockResolvedValue(mockTx),
        revokeRole: vi.fn().mockResolvedValue(mockTx),
        hasRole: vi.fn().mockResolvedValue(false),
        paused: vi.fn().mockResolvedValue(false),
        nextJobId: vi.fn().mockResolvedValue(0n),
      },
      dispute: {
        grantRole: vi.fn().mockResolvedValue(mockTx),
        revokeRole: vi.fn().mockResolvedValue(mockTx),
        hasRole: vi.fn().mockResolvedValue(false),
        assignJudge: vi.fn().mockResolvedValue(mockTx),
        nextDisputeId: vi.fn().mockResolvedValue(0n),
      },
      reputation: {
        grantRole: vi.fn().mockResolvedValue(mockTx),
        revokeRole: vi.fn().mockResolvedValue(mockTx),
        hasRole: vi.fn().mockResolvedValue(false),
      },
      dataAvailability: {
        grantRole: vi.fn().mockResolvedValue(mockTx),
        revokeRole: vi.fn().mockResolvedValue(mockTx),
        hasRole: vi.fn().mockResolvedValue(false),
      },
    };

    mockReadContracts = {
      jobEscrow: {
        hasRole: vi.fn().mockResolvedValue(false),
        nextJobId: vi.fn().mockResolvedValue(0n),
        getJobInfo: vi.fn(),
      },
      dispute: {
        hasRole: vi.fn().mockResolvedValue(false),
        nextDisputeId: vi.fn().mockResolvedValue(0n),
        getDisputeDetails: vi.fn(),
      },
      reputation: { hasRole: vi.fn().mockResolvedValue(false) },
      dataAvailability: { hasRole: vi.fn().mockResolvedValue(false) },
    };

    vi.mocked(useContracts).mockReturnValue({
      contracts: mockContracts,
      readContracts: mockReadContracts,
      isReady: true,
    });

    vi.mocked(useWallet).mockReturnValue({
      address: "0xAdminAddr",
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

  // ═══════════════════════════════════════════
  //    GRANT ROLE
  // ═══════════════════════════════════════════

  describe("grantRole", () => {
    it("should call grantRole on the correct contract", async () => {
      const { result } = renderHook(() => useAdmin());

      await act(async () => {
        await result.current.grantRole(
          "jobEscrow",
          ROLES.PLATFORM_ADMIN,
          "0xNewAdmin"
        );
      });

      expect(mockContracts.jobEscrow.grantRole).toHaveBeenCalledWith(
        ROLES.PLATFORM_ADMIN,
        "0xNewAdmin"
      );
      expect(toast.success).toHaveBeenCalledWith("Role granted!", {
        id: "grant-role",
      });
    });

    it("should handle grantRole on dispute contract", async () => {
      const { result } = renderHook(() => useAdmin());

      await act(async () => {
        await result.current.grantRole(
          "dispute",
          ROLES.PLATFORM_JUDGE,
          "0xJudgeAddr"
        );
      });

      expect(mockContracts.dispute.grantRole).toHaveBeenCalledWith(
        ROLES.PLATFORM_JUDGE,
        "0xJudgeAddr"
      );
    });

    it("should show error toast on failure", async () => {
      mockContracts.jobEscrow.grantRole.mockRejectedValueOnce(
        new Error("AccessControl: account is missing role")
      );

      const { result } = renderHook(() => useAdmin());

      await expect(
        act(async () => {
          await result.current.grantRole(
            "jobEscrow",
            ROLES.PLATFORM_ADMIN,
            "0xUser"
          );
        })
      ).rejects.toThrow();

      expect(toast.error).toHaveBeenCalled();
    });

    it("should throw if contract is not ready", async () => {
      vi.mocked(useContracts).mockReturnValue({
        contracts: { jobEscrow: null, dispute: null, reputation: null, dataAvailability: null, mockUSDC: null },
        readContracts: mockReadContracts,
        isReady: false,
      });

      const { result } = renderHook(() => useAdmin());

      await expect(
        act(async () => {
          await result.current.grantRole(
            "jobEscrow",
            ROLES.PLATFORM_ADMIN,
            "0xUser"
          );
        })
      ).rejects.toThrow("Contract not ready");
    });
  });

  // ═══════════════════════════════════════════
  //    REVOKE ROLE
  // ═══════════════════════════════════════════

  describe("revokeRole", () => {
    it("should call revokeRole on the correct contract", async () => {
      const { result } = renderHook(() => useAdmin());

      await act(async () => {
        await result.current.revokeRole(
          "dispute",
          ROLES.PLATFORM_JUDGE,
          "0xOldJudge"
        );
      });

      expect(mockContracts.dispute.revokeRole).toHaveBeenCalledWith(
        ROLES.PLATFORM_JUDGE,
        "0xOldJudge"
      );
      expect(toast.success).toHaveBeenCalledWith("Role revoked!", {
        id: "revoke-role",
      });
    });
  });

  // ═══════════════════════════════════════════
  //    ASSIGN JUDGE
  // ═══════════════════════════════════════════

  describe("assignJudge", () => {
    it("should call assignJudge with formatted key", async () => {
      const { result } = renderHook(() => useAdmin());

      await act(async () => {
        await result.current.assignJudge(
          1,
          "0x1234567890123456789012345678901234567890",
          "0xephemeralPubKey"
        );
      });

      expect(mockContracts.dispute.assignJudge).toHaveBeenCalledWith(
        1,
        "0x1234567890123456789012345678901234567890",
        "0xephemeralPubKey"
      );
      expect(toast.success).toHaveBeenCalledWith("Judge assigned!", {
        id: "assign-judge",
      });
    });

    it("should add 0x prefix to ephemeral key if missing", async () => {
      const { result } = renderHook(() => useAdmin());

      await act(async () => {
        await result.current.assignJudge(
          1,
          "0x1234567890123456789012345678901234567890",
          "abcdef"
        );
      });

      expect(mockContracts.dispute.assignJudge).toHaveBeenCalledWith(
        1,
        "0x1234567890123456789012345678901234567890",
        "0xabcdef"
      );
    });

    it("should show error for invalid judge address", async () => {
      const { result } = renderHook(() => useAdmin());

      await act(async () => {
        await result.current.assignJudge(1, "not-an-address", "0xkey");
      });

      expect(toast.error).toHaveBeenCalledWith("Invalid judge address");
      // Should NOT call contract
      expect(mockContracts.dispute.assignJudge).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════
  //    HAS ROLE
  // ═══════════════════════════════════════════

  describe("hasRole", () => {
    it("should return true when user has role", async () => {
      mockReadContracts.jobEscrow.hasRole.mockResolvedValueOnce(true);

      const { result } = renderHook(() => useAdmin());

      let has = false;
      await act(async () => {
        has = await result.current.hasRole(
          "jobEscrow",
          ROLES.PLATFORM_ADMIN,
          "0xAdminAddr"
        );
      });

      expect(has).toBe(true);
    });

    it("should return false when user lacks role", async () => {
      mockReadContracts.dispute.hasRole.mockResolvedValueOnce(false);

      const { result } = renderHook(() => useAdmin());

      let has = true;
      await act(async () => {
        has = await result.current.hasRole(
          "dispute",
          ROLES.PLATFORM_JUDGE,
          "0xRegularUser"
        );
      });

      expect(has).toBe(false);
    });

    it("should return false if contract not ready", async () => {
      vi.mocked(useContracts).mockReturnValue({
        contracts: mockContracts,
        readContracts: {
          jobEscrow: null,
          dispute: null,
          reputation: null,
          dataAvailability: null,
          mockUSDC: null,
        },
        isReady: false,
      });

      const { result } = renderHook(() => useAdmin());

      let has = true;
      await act(async () => {
        has = await result.current.hasRole(
          "jobEscrow",
          ROLES.PLATFORM_ADMIN,
          "0xAddr"
        );
      });

      expect(has).toBe(false);
    });

    it("should return false on contract error", async () => {
      mockReadContracts.dispute.hasRole.mockRejectedValueOnce(new Error("network error"));

      const { result } = renderHook(() => useAdmin());

      let has = true;
      await act(async () => {
        has = await result.current.hasRole(
          "dispute",
          ROLES.PLATFORM_JUDGE,
          "0xAddr"
        );
      });

      expect(has).toBe(false);
    });
  });

  // ═══════════════════════════════════════════
  //    FETCH PLATFORM STATS
  // ═══════════════════════════════════════════

  describe("fetchPlatformStats", () => {
    it("should return zero stats when no jobs exist", async () => {
      mockReadContracts.jobEscrow.nextJobId.mockResolvedValue(0n);
      mockReadContracts.dispute.nextDisputeId.mockResolvedValue(0n);

      const { result } = renderHook(() => useAdmin());

      let stats: any;
      await act(async () => {
        stats = await result.current.fetchPlatformStats();
      });

      expect(stats.totalJobs).toBe(0);
      expect(stats.openJobs).toBe(0);
      expect(stats.activeJobs).toBe(0);
      expect(stats.completedJobs).toBe(0);
      expect(stats.totalDisputes).toBe(0);
    });

    it("should aggregate job states correctly", async () => {
      mockReadContracts.jobEscrow.nextJobId.mockResolvedValue(3n);
      mockReadContracts.dispute.nextDisputeId.mockResolvedValue(0n);

      // Job 0: Open (state=0), value=1000
      // Job 1: Active (state=2), value=2000
      // Job 2: Completed (state=3), value=3000
      mockReadContracts.jobEscrow.getJobInfo
        .mockResolvedValueOnce(["", "", 0n, 1000n]) // Open
        .mockResolvedValueOnce(["", "", 2n, 2000n]) // Active
        .mockResolvedValueOnce(["", "", 3n, 3000n]); // Completed

      const { result } = renderHook(() => useAdmin());

      let stats: any;
      await act(async () => {
        stats = await result.current.fetchPlatformStats();
      });

      expect(stats.totalJobs).toBe(3);
      expect(stats.openJobs).toBe(1);
      expect(stats.activeJobs).toBe(1);
      expect(stats.completedJobs).toBe(1);
      expect(stats.totalEscrowedValue).toBe(3000n); // open + active
    });
  });

  // ═══════════════════════════════════════════
  //    FETCH PENDING DISPUTES
  // ═══════════════════════════════════════════

  describe("fetchPendingDisputes", () => {
    it("should return empty array when no disputes exist", async () => {
      mockReadContracts.dispute.nextDisputeId.mockResolvedValue(0n);

      const { result } = renderHook(() => useAdmin());

      let pending: any[];
      await act(async () => {
        pending = await result.current.fetchPendingDisputes();
      });

      expect(pending!).toEqual([]);
    });

    it("should filter only AwaitingJudge disputes", async () => {
      mockReadContracts.dispute.nextDisputeId.mockResolvedValue(3n);

      // Dispute 0: Evidence phase (0)
      // Dispute 1: AwaitingJudge phase (1) - should be included
      // Dispute 2: Executed phase (5)
      mockReadContracts.dispute.getDisputeDetails
        .mockResolvedValueOnce([0n, 0n, "0xInit", "0xClient", "0xFL", 1000n, "0xJudge", 0n, 0n])
        .mockResolvedValueOnce([1n, 0n, "0xInit2", "0xClient2", "0xFL2", 2000n, "0xJudge2", 1n, 0n])
        .mockResolvedValueOnce([2n, 1n, "0xInit3", "0xClient3", "0xFL3", 3000n, "0xJudge3", 5n, 0n]);

      const { result } = renderHook(() => useAdmin());

      let pending: any[];
      await act(async () => {
        pending = await result.current.fetchPendingDisputes();
      });

      expect(pending!).toHaveLength(1);
      expect(pending![0].disputeId).toBe(1);
      expect(pending![0].jobId).toBe(1);
      expect(pending![0].milestoneValue).toBe(2000n);
    });

    it("should return empty if contract is not ready", async () => {
      vi.mocked(useContracts).mockReturnValue({
        contracts: mockContracts,
        readContracts: {
          jobEscrow: null,
          dispute: null,
          reputation: null,
          dataAvailability: null,
          mockUSDC: null,
        },
        isReady: false,
      });

      const { result } = renderHook(() => useAdmin());

      let pending: any[];
      await act(async () => {
        pending = await result.current.fetchPendingDisputes();
      });

      expect(pending!).toEqual([]);
    });
  });
});
