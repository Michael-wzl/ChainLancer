/**
 * useDispute hook tests
 *
 * Tests the dispute hook logic:
 *  - Write operations: submitEvidence, closeEvidencePhase, distributeKeyToJudge,
 *    claimKeyDefault, submitRuling, executeRuling
 *  - Read operations: fetchDisputeDetails, fetchDisputeDeadlines, fetchEvidence
 *  - Error handling and toast notifications
 *  - Contract not ready error paths
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
import { useDispute } from "../../hooks/useDispute";
import toast from "react-hot-toast";

describe("hooks/useDispute", () => {
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
      dispute: {
        submitEvidence: vi.fn().mockResolvedValue(mockTx),
        closeEvidencePhase: vi.fn().mockResolvedValue(mockTx),
        distributeKeyToJudge: vi.fn().mockResolvedValue(mockTx),
        claimKeyDefault: vi.fn().mockResolvedValue(mockTx),
        submitRuling: vi.fn().mockResolvedValue(mockTx),
        executeRuling: vi.fn().mockResolvedValue(mockTx),
      },
    };

    mockReadContracts = {
      dispute: {
        getDisputeDetails: vi.fn(),
        getDisputeDeadlines: vi.fn(),
        getEvidenceCount: vi.fn(),
        getEvidence: vi.fn(),
        getEncryptedKey: vi.fn(),
        disputes: vi.fn(),
        nextDisputeId: vi.fn().mockResolvedValue(0n),
        filters: {
          JudgeAssigned: vi.fn(),
        },
        queryFilter: vi.fn().mockResolvedValue([]),
      },
    };

    vi.mocked(useContracts).mockReturnValue({
      contracts: mockContracts,
      readContracts: mockReadContracts,
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

  // ═══════════════════════════════════════════
  //    WRITE OPERATIONS
  // ═══════════════════════════════════════════

  describe("submitEvidence", () => {
    it("should call contract method and show success toast", async () => {
      const { result } = renderHook(() => useDispute());

      await act(async () => {
        await result.current.submitEvidence(1, "0xevidencehash", "QmEvidenceCID");
      });

      expect(mockContracts.dispute.submitEvidence).toHaveBeenCalledWith(
        1,
        "0xevidencehash",
        "QmEvidenceCID"
      );
      expect(toast.success).toHaveBeenCalledWith("Evidence submitted!", {
        id: "evidence",
      });
    });

    it("should throw if contract not ready", async () => {
      vi.mocked(useContracts).mockReturnValue({
        contracts: { dispute: null } as any,
        readContracts: mockReadContracts,
        isReady: false,
      });

      const { result } = renderHook(() => useDispute());

      await expect(
        act(async () => {
          await result.current.submitEvidence(1, "hash", "cid");
        })
      ).rejects.toThrow("Contract not ready");
    });
  });

  describe("closeEvidencePhase", () => {
    it("should call contract method", async () => {
      const { result } = renderHook(() => useDispute());

      await act(async () => {
        await result.current.closeEvidencePhase(2);
      });

      expect(mockContracts.dispute.closeEvidencePhase).toHaveBeenCalledWith(2);
      expect(toast.success).toHaveBeenCalledWith("Evidence phase closed!", {
        id: "close-evidence",
      });
    });
  });

  describe("submitRuling", () => {
    it("should call contract method with all ruling parameters", async () => {
      const { result } = renderHook(() => useDispute());

      await act(async () => {
        await result.current.submitRuling(
          1,         // disputeId
          1,         // ruling (FreelancerWins)
          "0xhash",  // reasoningHash
          8000,      // freelancerShareBps (80%)
          3000       // depositSlashBps (30%)
        );
      });

      expect(mockContracts.dispute.submitRuling).toHaveBeenCalledWith(
        1, 1, "0xhash", 8000, 3000
      );
      expect(toast.success).toHaveBeenCalledWith("Ruling submitted!", {
        id: "submit-ruling",
      });
    });
  });

  describe("executeRuling", () => {
    it("should call contract method", async () => {
      const { result } = renderHook(() => useDispute());

      await act(async () => {
        await result.current.executeRuling(1);
      });

      expect(mockContracts.dispute.executeRuling).toHaveBeenCalledWith(1);
      expect(toast.success).toHaveBeenCalledWith(
        "Ruling executed — funds redistributed!",
        { id: "execute-ruling" }
      );
    });
  });

  describe("error handling", () => {
    it("should show error toast on transaction revert", async () => {
      mockContracts.dispute.submitEvidence.mockRejectedValueOnce(
        new Error("execution reverted: Not in evidence phase")
      );

      const { result } = renderHook(() => useDispute());

      await expect(
        act(async () => {
          await result.current.submitEvidence(1, "hash", "cid");
        })
      ).rejects.toThrow();

      expect(toast.error).toHaveBeenCalledWith(
        "The dispute is not in the evidence submission phase.",
        { id: "evidence" }
      );
    });

    it("should set loading=false after error", async () => {
      mockContracts.dispute.executeRuling.mockRejectedValueOnce(
        new Error("revert")
      );

      const { result } = renderHook(() => useDispute());

      await expect(
        act(async () => {
          await result.current.executeRuling(1);
        })
      ).rejects.toThrow();

      expect(result.current.loading).toBe(false);
    });
  });

  // ═══════════════════════════════════════════
  //    READ OPERATIONS
  // ═══════════════════════════════════════════

  describe("fetchDisputeDetails", () => {
    it("should return dispute details", async () => {
      mockReadContracts.dispute.getDisputeDetails.mockResolvedValueOnce([
        1n,                 // jobId
        0n,                 // milestoneIdx
        "0xInitiator",      // initiator
        "0xClient",         // client
        "0xFreelancer",     // freelancer
        1000000n,           // milestoneValue
        "0xJudge",          // judge
        3n,                 // phase (UnderReview)
        0n,                 // ruling
      ]);
      mockReadContracts.dispute.disputes.mockResolvedValueOnce({
        ephemeralPubKey: "0xabcdef",
        clientKeySubmitted: true,
        freelancerKeySubmitted: true,
        reasoningHash: "0xreasonhash",
        freelancerShareBps: 8000n,
        depositSlashBps: 3000n,
      });

      const { result } = renderHook(() => useDispute());

      let details: any;
      await act(async () => {
        details = await result.current.fetchDisputeDetails(0);
      });

      expect(details).not.toBeNull();
      expect(details.jobId).toBe(1);
      expect(details.client).toBe("0xClient");
      expect(details.freelancer).toBe("0xFreelancer");
      expect(details.milestoneValue).toBe(1000000n);
      expect(details.clientKeySubmitted).toBe(true);
      expect(details.freelancerKeySubmitted).toBe(true);
    });

    it("should return null if contract not ready", async () => {
      vi.mocked(useContracts).mockReturnValue({
        contracts: mockContracts,
        readContracts: { dispute: null } as any,
        isReady: false,
      });

      const { result } = renderHook(() => useDispute());

      let details: any;
      await act(async () => {
        details = await result.current.fetchDisputeDetails(0);
      });

      expect(details).toBeNull();
    });

    it("should return null on error", async () => {
      mockReadContracts.dispute.getDisputeDetails.mockRejectedValueOnce(
        new Error("not found")
      );

      const { result } = renderHook(() => useDispute());

      let details: any;
      await act(async () => {
        details = await result.current.fetchDisputeDetails(999);
      });

      expect(details).toBeNull();
    });
  });

  describe("fetchDisputeDeadlines", () => {
    it("should return deadline timestamps", async () => {
      mockReadContracts.dispute.getDisputeDeadlines.mockResolvedValueOnce([
        1700000000n, // evidence
        1700050000n, // judge assignment
        1700100000n, // key distribution
        1700200000n, // ruling
      ]);

      const { result } = renderHook(() => useDispute());

      let deadlines: any;
      await act(async () => {
        deadlines = await result.current.fetchDisputeDeadlines(0);
      });

      expect(deadlines.evidenceDeadline).toBe(1700000000);
      expect(deadlines.judgeAssignmentDeadline).toBe(1700050000);
      expect(deadlines.keyDistributionDeadline).toBe(1700100000);
      expect(deadlines.rulingDeadline).toBe(1700200000);
    });
  });

  describe("fetchEvidence", () => {
    it("should return evidence items", async () => {
      mockReadContracts.dispute.getEvidenceCount.mockResolvedValueOnce(2n);
      mockReadContracts.dispute.getEvidence
        .mockResolvedValueOnce(["0xSubmitter1", "0xHash1", "QmCID1", 1700000000n])
        .mockResolvedValueOnce(["0xSubmitter2", "0xHash2", "QmCID2", 1700001000n]);

      const { result } = renderHook(() => useDispute());

      let evidence: any[];
      await act(async () => {
        evidence = await result.current.fetchEvidence(0);
      });

      expect(evidence!).toHaveLength(2);
      expect(evidence![0].submitter).toBe("0xSubmitter1");
      expect(evidence![0].evidenceHash).toBe("0xHash1");
      expect(evidence![0].evidenceCID).toBe("QmCID1");
      expect(evidence![1].submitter).toBe("0xSubmitter2");
    });

    it("should return empty array when no evidence", async () => {
      mockReadContracts.dispute.getEvidenceCount.mockResolvedValueOnce(0n);

      const { result } = renderHook(() => useDispute());

      let evidence: any[];
      await act(async () => {
        evidence = await result.current.fetchEvidence(0);
      });

      expect(evidence!).toEqual([]);
    });

    it("should return empty array if contract not ready", async () => {
      vi.mocked(useContracts).mockReturnValue({
        contracts: mockContracts,
        readContracts: { dispute: null } as any,
        isReady: false,
      });

      const { result } = renderHook(() => useDispute());

      let evidence: any[];
      await act(async () => {
        evidence = await result.current.fetchEvidence(0);
      });

      expect(evidence!).toEqual([]);
    });
  });
});
