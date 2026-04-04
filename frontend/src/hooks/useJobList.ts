import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import { useContracts } from "../contexts/ContractContext";
import { JobState, MilestoneStatus } from "../config/constants";

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
}

export interface MilestoneData {
  value: bigint;
  deadline: number;
  submittedAt: number;
  resolvedAt: number;
  remainingReviewTime: number;
  deliverableHash: string;
  deliverableCID: string;
  status: MilestoneStatus;
  fundsProcessed: boolean;
}

export interface ApplicationData {
  freelancer: string;
  proposalHash: string;
  appliedAt: number;
}

/**
 * Hook to fetch and manage a list of jobs.
 */
export function useJobList() {
  const { readContracts } = useContracts();
  const [jobs, setJobs] = useState<JobData[]>([]);
  const [loading, setLoading] = useState(false);
  const [totalJobs, setTotalJobs] = useState(0);

  const fetchJobs = useCallback(async () => {
    if (!readContracts.jobEscrow) return;
    setLoading(true);
    try {
      const nextJobId = await readContracts.jobEscrow.nextJobId();
      const total = Number(nextJobId);
      setTotalJobs(total);

      const jobPromises: Promise<JobData | null>[] = [];
      for (let i = 0; i < total; i++) {
        jobPromises.push(fetchSingleJob(readContracts.jobEscrow, i));
      }

      const results = await Promise.all(jobPromises);
      setJobs(results.filter((j): j is JobData => j !== null).reverse());
    } catch (err) {
      console.error("Failed to fetch jobs:", err);
    } finally {
      setLoading(false);
    }
  }, [readContracts.jobEscrow]);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  return { jobs, loading, totalJobs, refresh: fetchJobs };
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
        fetchSingleJob(readContracts.jobEscrow, jobId),
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
        remainingReviewTime: Number(ms[4]),
        deliverableHash: ms[5] as string,
        deliverableCID: ms[6] as string,
        status: Number(ms[7]) as MilestoneStatus,
        fundsProcessed: ms[8] as boolean,
      }));
      setMilestones(parsedMs);

      // Parse applications
      const parsedApps: ApplicationData[] = appData.map((app: unknown[]) => ({
        freelancer: app[0] as string,
        proposalHash: app[1] as string,
        appliedAt: Number(app[2]),
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
): Promise<JobData | null> {
  try {
    const info = await contract.getJobInfo(jobId);
    const raw = await contract.jobs(jobId);

    const client = info[0] as string;

    // Bug #1 fix: Solidity mappings return default zero values for non-existent keys.
    // If the client address is the zero address, this job doesn't exist.
    if (client === ethers.ZeroAddress) {
      return null;
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
    };
  } catch {
    return null;
  }
}
