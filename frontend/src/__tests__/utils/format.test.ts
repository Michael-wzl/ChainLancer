/**
 * Tests for utils/format.ts — USDC, date, address, and BPS formatting
 *
 * Covers Stage 2 §9 & general UI formatting:
 * - formatUSDC: BigInt → "$X,XXX.XX" with 6 decimal precision
 * - parseUSDC: human-readable string → BigInt
 * - formatDate / formatDateTime / formatDuration
 * - truncateAddress: "0xAbCd...1234"
 * - formatBps: basis points → percentage
 */

import { describe, it, expect } from "vitest";
import {
  formatUSDC,
  parseUSDC,
  formatDate,
  formatDateTime,
  formatDuration,
  formatReviewTimeout,
  truncateAddress,
  formatBps,
} from "../../utils/format";

describe("utils/format", () => {
  // ─── formatUSDC ───

  describe("formatUSDC", () => {
    it("should format 0 correctly", () => {
      expect(formatUSDC(0n)).toBe("$0.00");
    });

    it("should format 1 USDC (1_000_000 units)", () => {
      expect(formatUSDC(1_000_000n)).toBe("$1.00");
    });

    it("should format 100,000 USDC", () => {
      const result = formatUSDC(100_000_000_000n);
      expect(result).toContain("100");
      expect(result).toContain(".00");
    });

    it("should format fractional amounts with 2 decimal places", () => {
      expect(formatUSDC(1_500_000n)).toBe("$1.50");
    });

    it("should format very small amounts", () => {
      expect(formatUSDC(1n)).toBe("$0.00"); // less than $0.01
    });

    it("should show cents correctly", () => {
      expect(formatUSDC(10_000n)).toBe("$0.01");
    });
  });

  // ─── parseUSDC ───

  describe("parseUSDC", () => {
    it("should parse '1' to 1_000_000", () => {
      expect(parseUSDC("1")).toBe(1_000_000n);
    });

    it("should parse '100.50' correctly", () => {
      expect(parseUSDC("100.50")).toBe(100_500_000n);
    });

    it("should parse '$1,000.00' (with dollar sign and commas)", () => {
      expect(parseUSDC("$1,000.00")).toBe(1_000_000_000n);
    });

    it("should parse '0' to 0", () => {
      expect(parseUSDC("0")).toBe(0n);
    });

    it("should handle trailing decimals", () => {
      expect(parseUSDC("10.123456")).toBe(10_123_456n);
    });

    it("should truncate beyond 6 decimals", () => {
      expect(parseUSDC("1.1234567")).toBe(1_123_456n);
    });

    it("should handle whitespace", () => {
      expect(parseUSDC(" 50 ")).toBe(50_000_000n);
    });
  });

  // ─── formatUSDC / parseUSDC roundtrip ───

  describe("formatUSDC / parseUSDC roundtrip", () => {
    it("should roundtrip for whole numbers", () => {
      const amount = 1000_000_000n; // 1000 USDC
      const formatted = formatUSDC(amount);
      const parsed = parseUSDC(formatted);
      expect(parsed).toBe(amount);
    });
  });

  // ─── formatDate ───

  describe("formatDate", () => {
    it("should format a unix timestamp", () => {
      // Jan 1, 2025 00:00:00 UTC
      const result = formatDate(1735689600);
      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
    });
  });

  // ─── formatDateTime ───

  describe("formatDateTime", () => {
    it("should format with time component", () => {
      const result = formatDateTime(1735689600);
      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
    });
  });

  // ─── formatDuration ───

  describe("formatDuration", () => {
    it("should return 'Expired' for 0 or negative", () => {
      expect(formatDuration(0)).toBe("Expired");
      expect(formatDuration(-100)).toBe("Expired");
    });

    it("should format days", () => {
      expect(formatDuration(86400)).toBe("1d");
    });

    it("should format hours", () => {
      expect(formatDuration(3600)).toBe("1h");
    });

    it("should format minutes (when no days)", () => {
      expect(formatDuration(120)).toBe("2m");
    });

    it("should format complex durations", () => {
      const result = formatDuration(90061); // 1d 1h 1m 1s
      expect(result).toContain("1d");
      expect(result).toContain("1h");
    });

    it("should show <1m for very short durations", () => {
      expect(formatDuration(30)).toBe("<1m");
    });
  });

  // ─── formatReviewTimeout ───

  describe("formatReviewTimeout", () => {
    it("should format 1 day", () => {
      expect(formatReviewTimeout(86400)).toBe("1 Day");
    });

    it("should format multiple days", () => {
      expect(formatReviewTimeout(7 * 86400)).toBe("7 Days");
    });
  });

  // ─── truncateAddress ───

  describe("truncateAddress", () => {
    it("should truncate a standard address", () => {
      const addr = "0xAbCdEf1234567890AbCdEf1234567890AbCdEf12";
      const result = truncateAddress(addr);
      expect(result).toBe("0xAbCd…Ef12");
    });

    it("should return short addresses as-is", () => {
      expect(truncateAddress("0x1234")).toBe("0x1234");
    });

    it("should handle empty string", () => {
      expect(truncateAddress("")).toBe("");
    });
  });

  // ─── formatBps ───

  describe("formatBps", () => {
    it("should format 200 BPS to 2%", () => {
      expect(formatBps(200)).toBe("2%");
    });

    it("should format 500 BPS to 5%", () => {
      expect(formatBps(500)).toBe("5%");
    });

    it("should format 750 BPS to 7.5%", () => {
      expect(formatBps(750)).toBe("7.5%");
    });

    it("should format 10000 BPS to 100%", () => {
      expect(formatBps(10000)).toBe("100%");
    });
  });
});
