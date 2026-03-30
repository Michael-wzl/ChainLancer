import React from "react";
import {
  JobState,
  MilestoneStatus,
  DisputePhase,
  Tier,
  JOB_STATE_LABELS,
  MILESTONE_STATUS_LABELS,
  DISPUTE_PHASE_LABELS,
  TIER_LABELS,
} from "../../config/constants";

type BadgeVariant = "gray" | "blue" | "green" | "yellow" | "red" | "purple" | "orange";

const variantStyles: Record<BadgeVariant, string> = {
  gray: "bg-gray-100 text-gray-800",
  blue: "bg-blue-100 text-blue-800",
  green: "bg-green-100 text-green-800",
  yellow: "bg-yellow-100 text-yellow-800",
  red: "bg-red-100 text-red-800",
  purple: "bg-purple-100 text-purple-800",
  orange: "bg-orange-100 text-orange-800",
};

function Badge({ label, variant }: { label: string; variant: BadgeVariant }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${variantStyles[variant]}`}
    >
      {label}
    </span>
  );
}

export function JobStateBadge({ state }: { state: JobState }) {
  const variantMap: Record<JobState, BadgeVariant> = {
    [JobState.Open]: "blue",
    [JobState.Applications]: "purple",
    [JobState.Active]: "green",
    [JobState.Completed]: "gray",
    [JobState.Cancelled]: "red",
    [JobState.Abandoned]: "orange",
  };

  return <Badge label={JOB_STATE_LABELS[state]} variant={variantMap[state]} />;
}

export function MilestoneStatusBadge({ status }: { status: MilestoneStatus }) {
  const variantMap: Record<MilestoneStatus, BadgeVariant> = {
    [MilestoneStatus.Pending]: "gray",
    [MilestoneStatus.InReview]: "yellow",
    [MilestoneStatus.Approved]: "green",
    [MilestoneStatus.AutoApproved]: "green",
    [MilestoneStatus.Disputed]: "red",
    [MilestoneStatus.Resolved]: "blue",
  };

  return <Badge label={MILESTONE_STATUS_LABELS[status]} variant={variantMap[status]} />;
}

export function DisputePhaseBadge({ phase }: { phase: DisputePhase }) {
  const variantMap: Record<DisputePhase, BadgeVariant> = {
    [DisputePhase.Evidence]: "yellow",
    [DisputePhase.AwaitingJudge]: "orange",
    [DisputePhase.KeyDistribution]: "purple",
    [DisputePhase.UnderReview]: "blue",
    [DisputePhase.Ruled]: "green",
    [DisputePhase.Executed]: "gray",
  };

  return <Badge label={DISPUTE_PHASE_LABELS[phase]} variant={variantMap[phase]} />;
}

export function TierBadge({ tier }: { tier: Tier }) {
  const variantMap: Record<Tier, BadgeVariant> = {
    [Tier.New]: "gray",
    [Tier.Bronze]: "orange",
    [Tier.Silver]: "blue",
    [Tier.Gold]: "yellow",
  };

  return <Badge label={TIER_LABELS[tier]} variant={variantMap[tier]} />;
}
