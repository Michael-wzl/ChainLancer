import { JobState, MilestoneStatus } from "../config/constants";

/** Type guard: check if a value is a valid JobState */
export function isJobState(value: number): value is JobState {
  return value >= 0 && value <= 5;
}

/** Type guard: check if a value is a valid MilestoneStatus */
export function isMilestoneStatus(value: number): value is MilestoneStatus {
  return value >= 0 && value <= 5;
}

/** Type guard: check if a value is non-null/undefined */
export function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}
