import { ethers } from "ethers";

// ─── On-chain constants (must match contract values) ───

/** Protocol fee: 2% (200 BPS) */
export const PROTOCOL_FEE_BPS = 200;

/** Freelancer deposit: 5% of total job value */
export const FREELANCER_DEPOSIT_BPS = 500;

/** Behavior bond BPS per client tier */
export const BEHAVIOR_BOND_BPS = {
  New: 750, // 7.5%
  Bronze: 500, // 5%
  Silver: 250, // 2.5%
  Gold: 100, // 1%
} as const;

/** Acceptance timeout: 14 days */
export const T_ACCEPTANCE = 14 * 24 * 60 * 60;

/** Stake timeout: 3 days */
export const T_STAKE = 3 * 24 * 60 * 60;

/** Evidence window: 5 days */
export const T_EVIDENCE = 5 * 24 * 60 * 60;

/** Key distribution timeout: 2 days */
export const T_KEY_DISTRIBUTION = 2 * 24 * 60 * 60;

/** Ruling timeout: 14 days */
export const T_RULING = 14 * 24 * 60 * 60;

/** USDC decimals */
export const USDC_DECIMALS = 6;

/** Allowed review timeout options (seconds) */
export const REVIEW_TIMEOUT_OPTIONS = [
  { label: "1 Day", value: 1 * 86400 },
  { label: "3 Days", value: 3 * 86400 },
  { label: "7 Days", value: 7 * 86400 },
  { label: "14 Days", value: 14 * 86400 },
  { label: "21 Days", value: 21 * 86400 },
  { label: "30 Days", value: 30 * 86400 },
] as const;

/** Job state enum (matches contract) */
export enum JobState {
  Open = 0,
  Applications = 1,
  Active = 2,
  Completed = 3,
  Cancelled = 4,
  Abandoned = 5,
}

/** Milestone status enum (matches contract) */
export enum MilestoneStatus {
  Pending = 0,
  InReview = 1,
  Approved = 2,
  AutoApproved = 3,
  Disputed = 4,
  Resolved = 5,
}

/** Dispute phase enum */
export enum DisputePhase {
  Evidence = 0,
  AwaitingJudge = 1,
  KeyDistribution = 2,
  UnderReview = 3,
  Ruled = 4,
  Executed = 5,
}

/** Dispute ruling enum */
export enum Ruling {
  Inconclusive = 0,
  FreelancerWins = 1,
  ClientWins = 2,
}

/** Reputation tier enum */
export enum Tier {
  New = 0,
  Bronze = 1,
  Silver = 2,
  Gold = 3,
}

// ─── Pre-computed role hashes ───
export const ROLES = {
  ESCROW_ROLE: ethers.keccak256(ethers.toUtf8Bytes("ESCROW_ROLE")),
  DISPUTE_ROLE: ethers.keccak256(ethers.toUtf8Bytes("DISPUTE_ROLE")),
  PLATFORM_ADMIN: ethers.keccak256(ethers.toUtf8Bytes("PLATFORM_ADMIN")),
  PLATFORM_JUDGE: ethers.keccak256(ethers.toUtf8Bytes("PLATFORM_JUDGE")),
} as const;

/** Human-readable labels */
export const JOB_STATE_LABELS: Record<JobState, string> = {
  [JobState.Open]: "Open",
  [JobState.Applications]: "Applications",
  [JobState.Active]: "Active",
  [JobState.Completed]: "Completed",
  [JobState.Cancelled]: "Cancelled",
  [JobState.Abandoned]: "Abandoned",
};

export const MILESTONE_STATUS_LABELS: Record<MilestoneStatus, string> = {
  [MilestoneStatus.Pending]: "Pending",
  [MilestoneStatus.InReview]: "In Review",
  [MilestoneStatus.Approved]: "Approved",
  [MilestoneStatus.AutoApproved]: "Auto-Approved",
  [MilestoneStatus.Disputed]: "Disputed",
  [MilestoneStatus.Resolved]: "Resolved",
};

export const DISPUTE_PHASE_LABELS: Record<DisputePhase, string> = {
  [DisputePhase.Evidence]: "Evidence Submission",
  [DisputePhase.AwaitingJudge]: "Awaiting Judge",
  [DisputePhase.KeyDistribution]: "Key Distribution",
  [DisputePhase.UnderReview]: "Under Review",
  [DisputePhase.Ruled]: "Ruled",
  [DisputePhase.Executed]: "Executed",
};

export const TIER_LABELS: Record<Tier, string> = {
  [Tier.New]: "New",
  [Tier.Bronze]: "Bronze",
  [Tier.Silver]: "Silver",
  [Tier.Gold]: "Gold",
};
