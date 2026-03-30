/**
 * Tests for config/contracts.ts — Contract address management
 *
 * Covers Stage 2 §9: Contract Integration Layer
 * - getContractAddresses reads from env vars
 * - validateContractAddresses validates format
 */

import { describe, it, expect, vi } from "vitest";
import { validateContractAddresses, type ContractAddresses } from "../../config/contracts";

describe("config/contracts", () => {
  describe("validateContractAddresses", () => {
    it("should return true for valid addresses", () => {
      const addresses: ContractAddresses = {
        MockUSDC: "0x1234567890123456789012345678901234567890",
        JobEscrow: "0x2345678901234567890123456789012345678901",
        Dispute: "0x3456789012345678901234567890123456789012",
        Reputation: "0x4567890123456789012345678901234567890123",
        DataAvailability: "0x5678901234567890123456789012345678901234",
      };
      expect(validateContractAddresses(addresses)).toBe(true);
    });

    it("should return false when any address is empty", () => {
      const addresses: ContractAddresses = {
        MockUSDC: "0x1234567890123456789012345678901234567890",
        JobEscrow: "",
        Dispute: "0x3456789012345678901234567890123456789012",
        Reputation: "0x4567890123456789012345678901234567890123",
        DataAvailability: "0x5678901234567890123456789012345678901234",
      };
      expect(validateContractAddresses(addresses)).toBe(false);
    });

    it("should return false when address is wrong length", () => {
      const addresses: ContractAddresses = {
        MockUSDC: "0x1234", // too short
        JobEscrow: "0x2345678901234567890123456789012345678901",
        Dispute: "0x3456789012345678901234567890123456789012",
        Reputation: "0x4567890123456789012345678901234567890123",
        DataAvailability: "0x5678901234567890123456789012345678901234",
      };
      expect(validateContractAddresses(addresses)).toBe(false);
    });

    it("should return false when address lacks 0x prefix", () => {
      const addresses: ContractAddresses = {
        MockUSDC: "1234567890123456789012345678901234567890ab",
        JobEscrow: "0x2345678901234567890123456789012345678901",
        Dispute: "0x3456789012345678901234567890123456789012",
        Reputation: "0x4567890123456789012345678901234567890123",
        DataAvailability: "0x5678901234567890123456789012345678901234",
      };
      expect(validateContractAddresses(addresses)).toBe(false);
    });
  });
});
