/**
 * Tests for config/constants.ts — On-chain constants and enums
 *
 * Covers Stage 2 §9: shared constants used throughout the frontend
 * - Protocol constants match contract values
 * - Enum values match contract enum indices
 * - Role hashes are valid keccak256 outputs
 * - Labels exist for all enum values
 */

import { describe, it, expect } from "vitest";
import { ethers } from "ethers";
import {
  PROTOCOL_FEE_BPS,
  FREELANCER_DEPOSIT_BPS,
  BEHAVIOR_BOND_BPS,
  T_ACCEPTANCE,
  T_STAKE,
  T_EVIDENCE,
  T_KEY_DISTRIBUTION,
  T_RULING,
  USDC_DECIMALS,
  REVIEW_TIMEOUT_OPTIONS,
  JobState,
  MilestoneStatus,
  DisputePhase,
  Ruling,
  Tier,
  ROLES,
  JOB_STATE_LABELS,
  MILESTONE_STATUS_LABELS,
  DISPUTE_PHASE_LABELS,
  TIER_LABELS,
} from "../../config/constants";

describe("config/constants", () => {
  // ─── Protocol constants ───

  describe("protocol constants", () => {
    it("should have correct protocol fee (2%)", () => {
      expect(PROTOCOL_FEE_BPS).toBe(200);
    });

    it("should have correct freelancer deposit (5%)", () => {
      expect(FREELANCER_DEPOSIT_BPS).toBe(500);
    });

    it("should have correct behavior bond BPS per tier", () => {
      expect(BEHAVIOR_BOND_BPS.New).toBe(750);
      expect(BEHAVIOR_BOND_BPS.Bronze).toBe(500);
      expect(BEHAVIOR_BOND_BPS.Silver).toBe(250);
      expect(BEHAVIOR_BOND_BPS.Gold).toBe(100);
    });

    it("should have correct timeout values", () => {
      expect(T_ACCEPTANCE).toBe(14 * 86400); // 14 days
      expect(T_STAKE).toBe(3 * 86400); // 3 days
      expect(T_EVIDENCE).toBe(5 * 86400); // 5 days
      expect(T_KEY_DISTRIBUTION).toBe(2 * 86400); // 2 days
      expect(T_RULING).toBe(14 * 86400); // 14 days
    });

    it("should have USDC decimals as 6", () => {
      expect(USDC_DECIMALS).toBe(6);
    });
  });

  // ─── Review timeout options ───

  describe("REVIEW_TIMEOUT_OPTIONS", () => {
    it("should have at least 1 option", () => {
      expect(REVIEW_TIMEOUT_OPTIONS.length).toBeGreaterThan(0);
    });

    it("all options should have positive second values", () => {
      for (const opt of REVIEW_TIMEOUT_OPTIONS) {
        expect(opt.value).toBeGreaterThan(0);
        expect(opt.label).toBeTruthy();
      }
    });

    it("should include common options (1, 7, 14, 30 days)", () => {
      const values = REVIEW_TIMEOUT_OPTIONS.map((o) => o.value);
      expect(values).toContain(1 * 86400);
      expect(values).toContain(7 * 86400);
      expect(values).toContain(14 * 86400);
      expect(values).toContain(30 * 86400);
    });
  });

  // ─── Enums ───

  describe("enums", () => {
    it("JobState enum should have sequential values starting at 0", () => {
      expect(JobState.Open).toBe(0);
      expect(JobState.Applications).toBe(1);
      expect(JobState.Active).toBe(2);
      expect(JobState.Completed).toBe(3);
      expect(JobState.Cancelled).toBe(4);
      expect(JobState.Abandoned).toBe(5);
    });

    it("MilestoneStatus enum should have sequential values starting at 0", () => {
      expect(MilestoneStatus.Pending).toBe(0);
      expect(MilestoneStatus.InReview).toBe(1);
      expect(MilestoneStatus.Approved).toBe(2);
      expect(MilestoneStatus.AutoApproved).toBe(3);
      expect(MilestoneStatus.Disputed).toBe(4);
      expect(MilestoneStatus.Resolved).toBe(5);
    });

    it("DisputePhase enum should match contract values", () => {
      expect(DisputePhase.Evidence).toBe(0);
      expect(DisputePhase.AwaitingJudge).toBe(1);
      expect(DisputePhase.KeyDistribution).toBe(2);
      expect(DisputePhase.UnderReview).toBe(3);
      expect(DisputePhase.Ruled).toBe(4);
      expect(DisputePhase.Executed).toBe(5);
    });

    it("Ruling enum should match contract values", () => {
      expect(Ruling.Inconclusive).toBe(0);
      expect(Ruling.FreelancerWins).toBe(1);
      expect(Ruling.ClientWins).toBe(2);
    });

    it("Tier enum should match contract values", () => {
      expect(Tier.New).toBe(0);
      expect(Tier.Bronze).toBe(1);
      expect(Tier.Silver).toBe(2);
      expect(Tier.Gold).toBe(3);
    });
  });

  // ─── Role hashes ───

  describe("ROLES", () => {
    it("ESCROW_ROLE should be keccak256('ESCROW_ROLE')", () => {
      const expected = ethers.keccak256(ethers.toUtf8Bytes("ESCROW_ROLE"));
      expect(ROLES.ESCROW_ROLE).toBe(expected);
    });

    it("DISPUTE_ROLE should be keccak256('DISPUTE_ROLE')", () => {
      const expected = ethers.keccak256(ethers.toUtf8Bytes("DISPUTE_ROLE"));
      expect(ROLES.DISPUTE_ROLE).toBe(expected);
    });

    it("PLATFORM_ADMIN should be keccak256('PLATFORM_ADMIN')", () => {
      const expected = ethers.keccak256(ethers.toUtf8Bytes("PLATFORM_ADMIN"));
      expect(ROLES.PLATFORM_ADMIN).toBe(expected);
    });

    it("PLATFORM_JUDGE should be keccak256('PLATFORM_JUDGE')", () => {
      const expected = ethers.keccak256(ethers.toUtf8Bytes("PLATFORM_JUDGE"));
      expect(ROLES.PLATFORM_JUDGE).toBe(expected);
    });

    it("all role hashes should be bytes32 format", () => {
      for (const hash of Object.values(ROLES)) {
        expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
      }
    });
  });

  // ─── Labels ───

  describe("labels", () => {
    it("JOB_STATE_LABELS should have labels for all JobState values", () => {
      for (const state of [0, 1, 2, 3, 4, 5]) {
        expect(JOB_STATE_LABELS[state as JobState]).toBeTruthy();
      }
    });

    it("MILESTONE_STATUS_LABELS should have labels for all MilestoneStatus values", () => {
      for (const status of [0, 1, 2, 3, 4, 5]) {
        expect(MILESTONE_STATUS_LABELS[status as MilestoneStatus]).toBeTruthy();
      }
    });

    it("DISPUTE_PHASE_LABELS should have labels for all DisputePhase values", () => {
      for (const phase of [0, 1, 2, 3, 4, 5]) {
        expect(DISPUTE_PHASE_LABELS[phase as DisputePhase]).toBeTruthy();
      }
    });

    it("TIER_LABELS should have labels for all Tier values", () => {
      for (const tier of [0, 1, 2, 3]) {
        expect(TIER_LABELS[tier as Tier]).toBeTruthy();
      }
    });
  });
});
