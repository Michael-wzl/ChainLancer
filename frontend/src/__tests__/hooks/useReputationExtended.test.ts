/**
 * Enhanced useReputation hook tests
 *
 * Additional tests beyond basic profile fetching:
 *  - useUserReputation composite hook with auto-fetch
 *  - Score functions (getFreelancerScore, getClientScore) 
 *  - Error resilience (network errors → null/defaults)
 *  - Contract error handling returns graceful fallbacks
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

vi.mock("../../contexts/ContractContext", () => ({
  useContracts: vi.fn(),
}));

vi.mock("../../contexts/WalletContext", () => ({
  useWallet: vi.fn(),
}));

import { useContracts } from "../../contexts/ContractContext";
import { useReputation, useUserReputation } from "../../hooks/useReputation";
import { Tier } from "../../config/constants";

describe("useReputation – extended", () => {
  let mockReputation: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockReputation = {
      getFreelancerProfile: vi.fn().mockResolvedValue([
        5_000_000_000n, 3n, 1n, 4_500_000_000n,
      ]),
      getClientProfile: vi.fn().mockResolvedValue([
        10_000_000_000n, 5n, 4n, 1n, 2n, 0n, 9_500_000_000n,
      ]),
      getClientTier: vi.fn().mockResolvedValue(2n),
      getFreelancerScore: vi.fn().mockResolvedValue(4_500_000_000n),
      getClientScore: vi.fn().mockResolvedValue(9_500_000_000n),
    };

    vi.mocked(useContracts).mockReturnValue({
      contracts: {} as any,
      readContracts: { reputation: mockReputation } as any,
      isReady: true,
    });
  });

  describe("getFreelancerScore", () => {
    it("should return reputation score as bigint", async () => {
      const { result } = renderHook(() => useReputation());

      let score = 0n;
      await act(async () => {
        score = await result.current.getFreelancerScore("0xFL");
      });

      expect(score).toBe(4_500_000_000n);
      expect(mockReputation.getFreelancerScore).toHaveBeenCalledWith("0xFL");
    });

    it("should return 0n when contract is null", async () => {
      vi.mocked(useContracts).mockReturnValue({
        contracts: {} as any,
        readContracts: { reputation: null } as any,
        isReady: false,
      });

      const { result } = renderHook(() => useReputation());

      let score = 999n;
      await act(async () => {
        score = await result.current.getFreelancerScore("0xAddr");
      });

      expect(score).toBe(0n);
    });

    it("should return 0n on contract error", async () => {
      mockReputation.getFreelancerScore.mockRejectedValueOnce(new Error("revert"));

      const { result } = renderHook(() => useReputation());

      let score = 999n;
      await act(async () => {
        score = await result.current.getFreelancerScore("0xAddr");
      });

      expect(score).toBe(0n);
    });
  });

  describe("getClientScore", () => {
    it("should return client score as bigint", async () => {
      const { result } = renderHook(() => useReputation());

      let score = 0n;
      await act(async () => {
        score = await result.current.getClientScore("0xCL");
      });

      expect(score).toBe(9_500_000_000n);
    });
  });

  describe("error resilience", () => {
    it("getFreelancerProfile returns null on network error", async () => {
      mockReputation.getFreelancerProfile.mockRejectedValueOnce(
        new Error("network timeout")
      );

      const { result } = renderHook(() => useReputation());

      let profile: any;
      await act(async () => {
        profile = await result.current.getFreelancerProfile("0xAddr");
      });

      expect(profile).toBeNull();
    });

    it("getClientProfile returns null on network error", async () => {
      mockReputation.getClientProfile.mockRejectedValueOnce(
        new Error("connection refused")
      );

      const { result } = renderHook(() => useReputation());

      let profile: any;
      await act(async () => {
        profile = await result.current.getClientProfile("0xAddr");
      });

      expect(profile).toBeNull();
    });

    it("getClientTier returns New on error", async () => {
      mockReputation.getClientTier.mockRejectedValueOnce(
        new Error("invalid address")
      );

      const { result } = renderHook(() => useReputation());

      let tier: Tier = Tier.Gold;
      await act(async () => {
        tier = await result.current.getClientTier("0xBadAddr");
      });

      expect(tier).toBe(Tier.New);
    });
  });
});

describe("useUserReputation", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const mockReputation = {
      getFreelancerProfile: vi.fn().mockResolvedValue([
        1_000_000_000n, 1n, 0n, 900_000_000n,
      ]),
      getClientProfile: vi.fn().mockResolvedValue([
        2_000_000_000n, 3n, 2n, 0n, 1n, 0n, 1_800_000_000n,
      ]),
      getClientTier: vi.fn().mockResolvedValue(1n), // Bronze
      getFreelancerScore: vi.fn(),
      getClientScore: vi.fn(),
    };

    vi.mocked(useContracts).mockReturnValue({
      contracts: {} as any,
      readContracts: { reputation: mockReputation } as any,
      isReady: true,
    });
  });

  it("should fetch profiles on mount when address is provided", async () => {
    const { result } = renderHook(() =>
      useUserReputation("0xUser")
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.freelancerProfile).not.toBeNull();
    expect(result.current.freelancerProfile!.totalValueCompleted).toBe(1_000_000_000n);
    expect(result.current.clientProfile).not.toBeNull();
    expect(result.current.clientProfile!.jobsPosted).toBe(3);
    expect(result.current.clientTier).toBe(Tier.Bronze);
  });

  it("should not fetch when address is null", () => {
    const { result } = renderHook(() =>
      useUserReputation(null)
    );

    expect(result.current.freelancerProfile).toBeNull();
    expect(result.current.clientProfile).toBeNull();
    expect(result.current.clientTier).toBe(Tier.New);
    expect(result.current.loading).toBe(false);
  });

  it("should expose refresh function", async () => {
    const { result } = renderHook(() =>
      useUserReputation("0xUser")
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(typeof result.current.refresh).toBe("function");
  });
});
