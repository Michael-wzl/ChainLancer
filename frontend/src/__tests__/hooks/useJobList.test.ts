import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { ethers } from "ethers";

vi.mock("../../contexts/ContractContext", () => ({
  useContracts: vi.fn(),
}));

import { useContracts } from "../../contexts/ContractContext";
import { useJobList } from "../../hooks/useJobList";

function makeJobInfo(client: string, state = 3n) {
  return [
    client,
    "0x00000000000000000000000000000000000000f1",
    state,
    1_000_000n,
    50_000n,
    50_000n,
    604800n,
  ];
}

function makeRawJob() {
  return {
    agreementHash: "0xagreement",
    createdAt: 1000n,
    selectedAt: 1100n,
    activatedAt: 1200n,
    milestoneCount: 1n,
    milestonesCompleted: 1n,
  };
}

describe("hooks/useJobList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries nextJobId and failed job reads, while surfacing partial failures", async () => {
    const nextJobId = vi
      .fn()
      .mockRejectedValueOnce(new Error("stale rpc"))
      .mockResolvedValue(3n);

    const getJobInfoAttempts = new Map<number, number>();
    const getJobInfo = vi.fn(async (jobId: number) => {
      const attempt = getJobInfoAttempts.get(jobId) ?? 0;
      getJobInfoAttempts.set(jobId, attempt + 1);

      if (jobId === 1 && attempt === 0) {
        throw new Error("temporary job read failure");
      }

      if (jobId === 2) {
        throw new Error("permanent job read failure");
      }

      return makeJobInfo(`0x000000000000000000000000000000000000000${jobId + 1}`);
    });

    const jobs = vi.fn(async (jobId: number) => {
      if (jobId === 2) {
        throw new Error("raw job read failure");
      }
      return makeRawJob();
    });

    vi.mocked(useContracts).mockReturnValue({
      contracts: {
        jobEscrow: null,
        dispute: null,
        reputation: null,
        dataAvailability: null,
        mockUSDC: null,
      },
      readContracts: {
        jobEscrow: {
          nextJobId,
          getJobInfo,
          jobs,
          cancelRequests: vi.fn().mockResolvedValue({
            active: false,
            requestedBy: ethers.ZeroAddress,
          }),
        },
        dispute: null,
        reputation: null,
        dataAvailability: null,
        mockUSDC: null,
      },
      isReady: true,
    } as any);

    const { result } = renderHook(() => useJobList());

    await act(async () => {
      await Promise.resolve();
      await vi.runAllTimersAsync();
    });

    expect(result.current.loading).toBe(false);
    expect(nextJobId).toHaveBeenCalledTimes(2);
    expect(getJobInfo).toHaveBeenCalledTimes(6);
    expect(result.current.totalJobs).toBe(3);
    expect(result.current.jobs.map(job => job.jobId)).toEqual([1, 0]);
    expect(result.current.hasPartialFailures).toBe(true);
    expect(result.current.failedJobIds).toEqual([2]);
  });

  it("does not mark zero-address placeholder jobs as partial failures", async () => {
    vi.mocked(useContracts).mockReturnValue({
      contracts: {
        jobEscrow: null,
        dispute: null,
        reputation: null,
        dataAvailability: null,
        mockUSDC: null,
      },
      readContracts: {
        jobEscrow: {
          nextJobId: vi.fn().mockResolvedValue(2n),
          getJobInfo: vi.fn(async (jobId: number) => {
            if (jobId === 1) {
              return makeJobInfo(ethers.ZeroAddress, 0n);
            }
            return makeJobInfo("0x0000000000000000000000000000000000000001", 0n);
          }),
          jobs: vi.fn().mockResolvedValue(makeRawJob()),
          cancelRequests: vi.fn().mockResolvedValue({
            active: false,
            requestedBy: ethers.ZeroAddress,
          }),
        },
        dispute: null,
        reputation: null,
        dataAvailability: null,
        mockUSDC: null,
      },
      isReady: true,
    } as any);

    const { result } = renderHook(() => useJobList());

    await act(async () => {
      await Promise.resolve();
      await vi.runAllTimersAsync();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.jobs.map(job => job.jobId)).toEqual([0]);
    expect(result.current.hasPartialFailures).toBe(false);
    expect(result.current.failedJobIds).toEqual([]);
  });
});
