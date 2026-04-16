import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import { useContracts } from "../contexts/ContractContext";
import { JobState, MilestoneStatus } from "../config/constants";

const NEXT_JOB_ID_RETRIES = 2;
const JOB_FETCH_RETRIES = 2;
const RETRY_DELAY_MS = 300;

// ─── Types ───

export interface JobData {
  jobId: number;
  client: string;
  freelancer: string;
  totalValue: bigint;
  freelancerDeposit: bigint;
  behaviorBond: bigint;
  agreementHash: string;
  reviewTimeout: number;
  createdAt: number;
  selectedAt: number;
  activatedAt: number;
  milestoneCount: number;
  milestonesCompleted: number;
  state: JobState;
  /** Whether a mutual cancellation request is currently pending */
  cancellationRequested: boolean;
  /** Address of the party who requested cancellation (if any) */
  cancellationRequestor: string | null;
}

export interface MilestoneData {
  value: bigint;
  deadline: number;
  submittedAt: number;
  resolvedAt: number;
  deliverableHash: string;
  deliverableCID: string;
  status: MilestoneStatus;
  fundsProcessed: boolean;
}

export interface ApplicationData {
  freelancer: string;
  proposalHash: string;
  proposalCID: string;
  appliedAt: number;
}

interface FetchSingleJobOptions {
  retries?: number;
  onRetry?: (attempt: number, error: unknown) => void;
}

/**
 * Hook to fetch and manage a list of jobs.
 */
export function useJobList() {
  const { readContracts } = useContracts();
  const [jobs, setJobs] = useState<JobData[]>([]);
  const [loading, setLoading] = useState(false);
  const [totalJobs, setTotalJobs] = useState(0);
  const [hasPartialFailures, setHasPartialFailures] = useState(false);
  const [failedJobIds, setFailedJobIds] = useState<number[]>([]);

  const fetchJobs = useCallback(async () => {
    if (!readContracts.jobEscrow) return;
    setLoading(true);
    setHasPartialFailures(false);
    setFailedJobIds([]);
    try {
      const nextJobId = await retryRpcCall(
        () => readContracts.jobEscrow!.nextJobId(),
        NEXT_JOB_ID_RETRIES,
        "Failed to fetch next job id",
      );
      const total = Number(nextJobId);
      setTotalJobs(total);

      const jobPromises: Promise<JobData | null>[] = Array.from(
        { length: total },
        (_, jobId) =>
          fetchSingleJob(readContracts.jobEscrow!, jobId, {
            retries: JOB_FETCH_RETRIES,
            onRetry: (attempt, error) => {
              console.warn(
                `Retrying fetch for job ${jobId} (attempt ${attempt + 1})`,
                error,
              );
            },
          }),
      );

      const results = await Promise.allSettled(jobPromises);
      const nextJobs: JobData[] = [];
      const nextFailedJobIds: number[] = [];

      results.forEach((result, jobId) => {
        if (result.status === "fulfilled") {
          if (result.value) {
            nextJobs.push(result.value);
          }
          return;
        }

        nextFailedJobIds.push(jobId);
        console.warn(`Failed to fetch job ${jobId} after retries`, result.reason);
      });

      setJobs(nextJobs.reverse());
      setHasPartialFailures(nextFailedJobIds.length > 0);
      setFailedJobIds(nextFailedJobIds);
    } catch (err) {
      console.error("Failed to fetch jobs:", err);
    } finally {
      setLoading(false);
    }
  }, [readContracts.jobEscrow]);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  return {
    jobs,
    loading,
    totalJobs,
    hasPartialFailures,
    failedJobIds,
    refresh: fetchJobs,
  };
}

/**
 * Hook to fetch a single job with its milestones and applications.
 */
export function useJobDetail(jobId: number | null) {
  const { readContracts } = useContracts();
  const [job, setJob] = useState<JobData | null>(null);
  const [milestones, setMilestones] = useState<MilestoneData[]>([]);
  const [applications, setApplications] = useState<ApplicationData[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchJobDetail = useCallback(async () => {
    if (!readContracts.jobEscrow || jobId === null) return;
    setLoading(true);
    try {
      const [jobData, msData, appData] = await Promise.all([
        fetchSingleJob(readContracts.jobEscrow, jobId, {
          retries: JOB_FETCH_RETRIES,
        }),
        readContracts.jobEscrow.getMilestones(jobId),
        readContracts.jobEscrow.getApplications(jobId),
      ]);

      setJob(jobData);

      // Parse milestones
      const parsedMs: MilestoneData[] = msData.map((ms: unknown[]) => ({
        value: ms[0] as bigint,
        deadline: Number(ms[1]),
        submittedAt: Number(ms[2]),
        resolvedAt: Number(ms[3]),
        deliverableHash: ms[4] as string,
        deliverableCID: ms[5] as string,
        status: Number(ms[6]) as MilestoneStatus,
        fundsProcessed: ms[7] as boolean,
      }));
      setMilestones(parsedMs);

      // Parse applications
      const parsedApps: ApplicationData[] = appData.map((app: unknown[]) => ({
        freelancer: app[0] as string,
        proposalHash: app[1] as string,
        proposalCID: app[2] as string,
        appliedAt: Number(app[3]),
      }));
      setApplications(parsedApps);
    } catch (err) {
      console.error("Failed to fetch job detail:", err);
    } finally {
      setLoading(false);
    }
  }, [readContracts.jobEscrow, jobId]);

  useEffect(() => {
    fetchJobDetail();
  }, [fetchJobDetail]);

  return { job, milestones, applications, loading, refresh: fetchJobDetail };
}

// ─── Helper ───

async function fetchSingleJob(
  contract: import("ethers").Contract,
  jobId: number,
  options: FetchSingleJobOptions = {},
): Promise<JobData | null> {
  const retries = options.retries ?? 0;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetchSingleJobOnce(contract, jobId);
    } catch (error) {
      if (attempt === retries) {
        throw error;
      }

      options.onRetry?.(attempt, error);
      await delay(RETRY_DELAY_MS * (attempt + 1));
    }
  }

  return null;
}

async function fetchSingleJobOnce(
  contract: import("ethers").Contract,
  jobId: number,
): Promise<JobData | null> {
  const info = await contract.getJobInfo(jobId);
  const raw = await contract.jobs(jobId);

  const client = info[0] as string;

  // Bug #1 fix: Solidity mappings return default zero values for non-existent keys.
  // If the client address is the zero address, this job doesn't exist.
  if (client === ethers.ZeroAddress) {
    return null;
  }

  // BUG-001/002/003 fix: fetch cancellation request state
  let cancellationRequested = false;
  let cancellationRequestor: string | null = null;
  try {
    const cancelReq = await contract.cancelRequests(jobId);
    cancellationRequested = cancelReq.active as boolean;
    if (cancellationRequested) {
      cancellationRequestor = cancelReq.requestedBy as string;
    }
  } catch {
    // cancelRequests may not exist on older contract versions; ignore
  }

  return {
    jobId,
    client,
    freelancer: info[1] as string,
    state: Number(info[2]) as JobState,
    totalValue: info[3] as bigint,
    freelancerDeposit: info[4] as bigint,
    behaviorBond: info[5] as bigint,
    reviewTimeout: Number(info[6]),
    agreementHash: raw.agreementHash as string,
    createdAt: Number(BigInt(raw.createdAt)),
    selectedAt: Number(BigInt(raw.selectedAt)),
    activatedAt: Number(BigInt(raw.activatedAt)),
    milestoneCount: Number(BigInt(raw.milestoneCount)),
    milestonesCompleted: Number(BigInt(raw.milestonesCompleted)),
    cancellationRequested,
    cancellationRequestor,
  };
}

async function retryRpcCall<T>(
  operation: () => Promise<T>,
  retries: number,
  label: string,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === retries) {
        break;
      }

      console.warn(`${label} (attempt ${attempt + 1})`, error);
      await delay(RETRY_DELAY_MS * (attempt + 1));
    }
  }

  throw lastError;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
