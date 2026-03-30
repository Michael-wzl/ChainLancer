/**
 * Tests for utils/errors.ts — Contract error message parsing
 *
 * Covers Stage 2 §9: User-friendly error messages from contract reverts
 * - Known revert reasons are mapped to human-readable messages
 * - User rejection is recognized
 * - Insufficient funds is recognized
 * - Unknown errors produce fallback message
 */

import { describe, it, expect } from "vitest";
import { parseContractError } from "../../utils/errors";

describe("utils/errors", () => {
  describe("parseContractError", () => {
    // ─── Known contract revert reasons ───

    it("should parse 'Only client' revert", () => {
      const error = new Error("execution reverted: Only client");
      const msg = parseContractError(error);
      expect(msg).toBe("This action can only be performed by the job client.");
    });

    it("should parse 'Only freelancer' revert", () => {
      const msg = parseContractError("execution reverted: Only freelancer");
      expect(msg).toBe("This action can only be performed by the assigned freelancer.");
    });

    it("should parse 'Already applied' revert", () => {
      const msg = parseContractError(new Error("Already applied"));
      expect(msg).toBe("You have already applied to this job.");
    });

    it("should parse 'Client cannot apply' revert", () => {
      const msg = parseContractError("Client cannot apply");
      expect(msg).toBe("The job client cannot apply to their own job.");
    });

    it("should parse 'Stake window expired' revert", () => {
      const msg = parseContractError("Stake window expired");
      expect(msg).toBe("The stake window has expired. The offer is no longer valid.");
    });

    it("should parse 'Job not active' revert", () => {
      const msg = parseContractError("Job not active");
      expect(msg).toBe("This job is not currently active.");
    });

    it("should parse 'Nothing to withdraw' revert", () => {
      const msg = parseContractError("Nothing to withdraw");
      expect(msg).toBe("You have no funds available to withdraw.");
    });

    it("should parse 'No milestones' revert", () => {
      const msg = parseContractError("No milestones");
      expect(msg).toBe("At least one milestone is required.");
    });

    it("should parse 'Too many milestones' revert", () => {
      const msg = parseContractError("Too many milestones");
      expect(msg).toBe("Maximum 20 milestones allowed.");
    });

    it("should parse 'Review timeout not expired' revert", () => {
      const msg = parseContractError("Review timeout not expired");
      expect(msg).toBe("The review timeout has not expired yet.");
    });

    // ─── ERC20 errors ───

    it("should parse 'ERC20: insufficient allowance'", () => {
      const msg = parseContractError("ERC20: insufficient allowance");
      expect(msg).toBe("Insufficient USDC allowance. Please approve the contract first.");
    });

    it("should parse 'ERC20: transfer amount exceeds balance'", () => {
      const msg = parseContractError("ERC20: transfer amount exceeds balance");
      expect(msg).toBe("Insufficient USDC balance.");
    });

    // ─── User rejection ───

    it("should recognize user rejected transaction", () => {
      const msg = parseContractError("user rejected transaction");
      expect(msg).toBe("Transaction was rejected by user.");
    });

    it("should recognize User denied", () => {
      const msg = parseContractError("User denied transaction signature");
      expect(msg).toBe("Transaction was rejected by user.");
    });

    it("should recognize ACTION_REJECTED", () => {
      // parseContractError uses String(error), so the error message must contain the keyword
      const error = new Error("ACTION_REJECTED: user rejected the transaction");
      const msg = parseContractError(error);
      expect(msg).toBe("Transaction was rejected by user.");
    });

    // ─── Insufficient funds ───

    it("should recognize insufficient funds for gas", () => {
      const msg = parseContractError("insufficient funds for gas");
      expect(msg).toBe("Insufficient ETH for gas fees.");
    });

    // ─── Fallback ───

    it("should return fallback for unknown errors", () => {
      const msg = parseContractError("some random error xyz");
      expect(msg).toBe("Transaction failed. Please try again.");
    });

    it("should handle null/undefined input gracefully", () => {
      const msg = parseContractError(null);
      expect(typeof msg).toBe("string");
    });

    // ─── Dispute-related errors ───

    it("should parse 'Not in evidence phase' revert", () => {
      const msg = parseContractError("Not in evidence phase");
      expect(msg).toBe("The dispute is not in the evidence submission phase.");
    });

    it("should parse 'Evidence window closed' revert", () => {
      const msg = parseContractError("Evidence window closed");
      expect(msg).toBe("The evidence submission window has closed.");
    });
  });
});
