/**
 * Tests for hooks/useReputation.ts — Reputation profile queries
 *
 * Covers Stage 2 §10: Profile page + Reputation display
 * - getFreelancerProfile returns parsed profile
 * - getClientProfile returns parsed profile
 * - getClientTier returns Tier enum
 * - Returns null/defaults when contract is unavailable
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("../../contexts/ContractContext", () => ({
  useContracts: vi.fn(),
}));

import { useContracts } from "../../contexts/ContractContext";
import { useReputation } from "../../hooks/useReputation";
import { Tier } from "../../config/constants";

describe("hooks/useReputation", () => {
  const mockReputation = {
    getFreelancerProfile: vi.fn().mockResolvedValue([
      500_000_000n, // totalValueCompleted
      5n,           // jobsCompleted
      1n,           // disputesLost
      0n,           // cancellations
      850n,         // reputationScore
    ]),
    getClientProfile: vi.fn().mockResolvedValue([
      1_000_000_000n, // totalValueCompleted
      10n,            // jobsPosted
      8n,             // jobsCompleted
      1n,             // jobsCancelledAfterSelection
      2n,             // autoApproveCount
      0n,             // disputesLost
      12n,            // totalMilestoneCount
      900n,           // reputationScore
    ]),
    getClientTier: vi.fn().mockResolvedValue(2n), // Silver
    getFreelancerScore: vi.fn().mockResolvedValue(850n),
    getClientScore: vi.fn().mockResolvedValue(900n),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useContracts).mockReturnValue({
      contracts: { reputation: mockReputation } as any,
      readContracts: { reputation: mockReputation } as any,
      isReady: true,
    });
  });

  it("should fetch freelancer profile", async () => {
    const { result } = renderHook(() => useReputation());

    let profile: any;
    await act(async () => {
      profile = await result.current.getFreelancerProfile("0xFreelancer");
    });

    expect(profile).toEqual({
      totalValueCompleted: 500_000_000n,
      jobsCompleted: 5,
      disputesLost: 1,
      cancellations: 0,
      reputationScore: 850n,
    });
  });

  it("should fetch client profile", async () => {
    const { result } = renderHook(() => useReputation());

    let profile: any;
    await act(async () => {
      profile = await result.current.getClientProfile("0xClient");
    });

    expect(profile).toEqual({
      totalValueCompleted: 1_000_000_000n,
      jobsPosted: 10,
      jobsCompleted: 8,
      jobsCancelledAfterSelection: 1,
      autoApproveCount: 2,
      disputesLost: 0,
      totalMilestoneCount: 12,
      reputationScore: 900n,
    });
  });

  it("should fetch client tier", async () => {
    const { result } = renderHook(() => useReputation());

    let tier: Tier;
    await act(async () => {
      tier = await result.current.getClientTier("0xClient");
    });

    expect(tier!).toBe(Tier.Silver);
  });

  it("should return null when contract is not available", async () => {
    vi.mocked(useContracts).mockReturnValue({
      contracts: { reputation: null } as any,
      readContracts: { reputation: null } as any,
      isReady: false,
    });

    const { result } = renderHook(() => useReputation());

    let profile: any;
    await act(async () => {
      profile = await result.current.getFreelancerProfile("0x");
    });

    expect(profile).toBeNull();
  });

  it("should return Tier.New when contract call fails", async () => {
    vi.mocked(useContracts).mockReturnValue({
      contracts: { reputation: null } as any,
      readContracts: { reputation: null } as any,
      isReady: false,
    });

    const { result } = renderHook(() => useReputation());

    let tier: Tier;
    await act(async () => {
      tier = await result.current.getClientTier("0x");
    });

    expect(tier!).toBe(Tier.New);
  });
});
