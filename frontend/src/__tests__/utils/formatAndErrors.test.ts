/**
 * Utility function tests
 *
 * Tests the pure utility functions for correctness:
 *  - formatUSDC: BigInt → human-readable dollar string
 *  - parseUSDC: human-readable string → BigInt
 *  - formatDuration: seconds → "Xd Xh Xm"
 *  - truncateAddress: 0x... → 0x1234…abcd
 *  - formatBps: basis points → percentage string
 *  - parseContractError: error message → user-friendly text
 */

import { describe, it, expect } from "vitest";

import {
  formatUSDC,
  parseUSDC,
  formatDate,
  formatDuration,
  formatReviewTimeout,
  truncateAddress,
  formatBps,
} from "../../utils/format";

import { parseContractError } from "../../utils/errors";

// ═══════════════════════════════════════════
//    formatUSDC
// ═══════════════════════════════════════════

describe("formatUSDC", () => {
  it("should format zero", () => {
    expect(formatUSDC(0n)).toBe("$0.00");
  });

  it("should format 1 USDC (1e6)", () => {
    expect(formatUSDC(1_000_000n)).toBe("$1.00");
  });

  it("should format 100 USDC", () => {
    expect(formatUSDC(100_000_000n)).toBe("$100.00");
  });

  it("should format fractional USDC (0.50)", () => {
    expect(formatUSDC(500_000n)).toBe("$0.50");
  });

  it("should format 999.99 USDC", () => {
    expect(formatUSDC(999_990_000n)).toBe("$999.99");
  });

  it("should truncate to 2 decimal places", () => {
    // 1.123456 USDC → should show $1.12 (truncated, not rounded)
    expect(formatUSDC(1_123_456n)).toBe("$1.12");
  });

  it("should format large values with locale separator", () => {
    // 1,000,000 USDC
    const result = formatUSDC(1_000_000_000_000n);
    expect(result).toContain("1");
    expect(result).toContain(".00");
  });

  it("should handle 1 wei of USDC (0.000001)", () => {
    expect(formatUSDC(1n)).toBe("$0.00");
  });
});

// ═══════════════════════════════════════════
//    parseUSDC
// ═══════════════════════════════════════════

describe("parseUSDC", () => {
  it("should parse integer input", () => {
    expect(parseUSDC("100")).toBe(100_000_000n);
  });

  it("should parse decimal input", () => {
    expect(parseUSDC("1.50")).toBe(1_500_000n);
  });

  it("should parse zero", () => {
    expect(parseUSDC("0")).toBe(0n);
  });

  it("should strip dollar signs and commas", () => {
    expect(parseUSDC("$1,000.00")).toBe(1_000_000_000n);
  });

  it("should handle more than 6 decimal places (truncate)", () => {
    // "1.1234567" → 1.123456 (truncated to 6 decimals)
    expect(parseUSDC("1.1234567")).toBe(1_123_456n);
  });

  it("should pad short decimals", () => {
    expect(parseUSDC("1.5")).toBe(1_500_000n);
  });

  it("should handle no integer part", () => {
    expect(parseUSDC(".50")).toBe(500_000n);
  });
});

// ═══════════════════════════════════════════
//    formatDuration
// ═══════════════════════════════════════════

describe("formatDuration", () => {
  it("should return 'Expired' for 0 seconds", () => {
    expect(formatDuration(0)).toBe("Expired");
  });

  it("should return 'Expired' for negative seconds", () => {
    expect(formatDuration(-100)).toBe("Expired");
  });

  it("should format minutes", () => {
    expect(formatDuration(300)).toBe("5m"); // 5 minutes
  });

  it("should format hours", () => {
    expect(formatDuration(7200)).toBe("2h"); // 2 hours
  });

  it("should format days", () => {
    expect(formatDuration(86400)).toBe("1d");
  });

  it("should format days and hours", () => {
    expect(formatDuration(90000)).toBe("1d 1h"); // 1 day 1 hour
  });

  it("should not show minutes when days are present", () => {
    // 1 day + 2 hours + 30 minutes → "1d 2h" (no minutes)
    expect(formatDuration(86400 + 7200 + 1800)).toBe("1d 2h");
  });

  it("should return '<1m' for very short durations", () => {
    expect(formatDuration(30)).toBe("<1m");
  });
});

// ═══════════════════════════════════════════
//    truncateAddress
// ═══════════════════════════════════════════

describe("truncateAddress", () => {
  it("should truncate standard Ethereum address", () => {
    const addr = "0x1234567890abcdef1234567890abcdef12345678";
    expect(truncateAddress(addr)).toBe("0x1234…5678");
  });

  it("should return short addresses as-is", () => {
    expect(truncateAddress("0x1234")).toBe("0x1234");
  });

  it("should handle empty string", () => {
    expect(truncateAddress("")).toBe("");
  });
});

// ═══════════════════════════════════════════
//    formatBps
// ═══════════════════════════════════════════

describe("formatBps", () => {
  it("should format 200 BPS as 2%", () => {
    expect(formatBps(200)).toBe("2%");
  });

  it("should format 500 BPS as 5%", () => {
    expect(formatBps(500)).toBe("5%");
  });

  it("should format 10000 BPS as 100%", () => {
    expect(formatBps(10000)).toBe("100%");
  });

  it("should format 250 BPS as 2.5%", () => {
    expect(formatBps(250)).toBe("2.5%");
  });

  it("should format 0 BPS as 0%", () => {
    expect(formatBps(0)).toBe("0%");
  });
});

// ═══════════════════════════════════════════
//    formatReviewTimeout
// ═══════════════════════════════════════════

describe("formatReviewTimeout", () => {
  it("should format 1 day", () => {
    expect(formatReviewTimeout(86400)).toBe("1 Day");
  });

  it("should format 7 days", () => {
    expect(formatReviewTimeout(7 * 86400)).toBe("7 Days");
  });

  it("should format 14 days", () => {
    expect(formatReviewTimeout(14 * 86400)).toBe("14 Days");
  });
});

// ═══════════════════════════════════════════
//    parseContractError
// ═══════════════════════════════════════════

describe("parseContractError", () => {
  it("should map 'Only client' to user-friendly message", () => {
    const err = new Error("execution reverted: Only client");
    expect(parseContractError(err)).toBe(
      "This action can only be performed by the job client."
    );
  });

  it("should map 'Only freelancer' to user-friendly message", () => {
    const err = new Error("execution reverted: Only freelancer");
    expect(parseContractError(err)).toBe(
      "This action can only be performed by the assigned freelancer."
    );
  });

  it("should map 'Already applied' to user-friendly message", () => {
    const err = new Error("execution reverted: Already applied");
    expect(parseContractError(err)).toBe(
      "You have already applied to this job."
    );
  });

  it("should map 'Client cannot apply' to user-friendly message", () => {
    const err = new Error("execution reverted: Client cannot apply");
    expect(parseContractError(err)).toBe(
      "The job client cannot apply to their own job."
    );
  });

  it("should map 'Job not active' to user-friendly message", () => {
    const err = new Error("execution reverted: Job not active");
    expect(parseContractError(err)).toBe("This job is not currently active.");
  });

  it("should map 'Review timeout not expired'", () => {
    const err = new Error("execution reverted: Review timeout not expired");
    expect(parseContractError(err)).toBe(
      "The review timeout has not expired yet."
    );
  });

  it("should map 'Nothing to withdraw'", () => {
    const err = new Error("execution reverted: Nothing to withdraw");
    expect(parseContractError(err)).toBe(
      "You have no funds available to withdraw."
    );
  });

  it("should map 'No milestones'", () => {
    const err = new Error("execution reverted: No milestones");
    expect(parseContractError(err)).toBe(
      "At least one milestone is required."
    );
  });

  it("should map 'Too many milestones'", () => {
    const err = new Error("execution reverted: Too many milestones");
    expect(parseContractError(err)).toBe("Maximum 20 milestones allowed.");
  });

  it("should map 'Empty agreement hash'", () => {
    const err = new Error("execution reverted: Empty agreement hash");
    expect(parseContractError(err)).toBe("Agreement hash cannot be empty.");
  });

  it("should map 'Not in evidence phase'", () => {
    const err = new Error("execution reverted: Not in evidence phase");
    expect(parseContractError(err)).toBe(
      "The dispute is not in the evidence submission phase."
    );
  });

  it("should map 'ERC20: insufficient allowance'", () => {
    const err = new Error("ERC20: insufficient allowance");
    expect(parseContractError(err)).toBe(
      "Insufficient USDC allowance. Please approve the contract first."
    );
  });

  it("should detect user rejection", () => {
    const err = new Error("user rejected transaction");
    expect(parseContractError(err)).toBe(
      "Transaction was rejected by user."
    );
  });

  it("should detect ACTION_REJECTED via Error message", () => {
    // parseContractError uses String(error), so the ACTION_REJECTED 
    // must appear in the string conversion
    const err = new Error("ACTION_REJECTED");
    expect(parseContractError(err)).toBe(
      "Transaction was rejected by user."
    );
  });

  it("should detect insufficient funds for gas", () => {
    const err = new Error("insufficient funds for gas");
    expect(parseContractError(err)).toBe(
      "Insufficient ETH for gas fees."
    );
  });

  it("should return generic fallback for unknown errors", () => {
    const err = new Error("some unknown error");
    expect(parseContractError(err)).toBe(
      "Transaction failed. Please try again."
    );
  });

  it("should handle non-Error objects", () => {
    expect(parseContractError("string error")).toBe(
      "Transaction failed. Please try again."
    );
    expect(parseContractError(42)).toBe(
      "Transaction failed. Please try again."
    );
    expect(parseContractError(null)).toBe(
      "Transaction failed. Please try again."
    );
  });
});
