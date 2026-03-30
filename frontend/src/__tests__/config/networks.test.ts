/**
 * Tests for config/networks.ts — Network configuration
 *
 * Covers Stage 2 §2: Deployment Architecture (network configs)
 * - NETWORKS contains required chains
 * - getTargetNetwork returns valid config
 * - Chain IDs match expected values
 */

import { describe, it, expect } from "vitest";
import { NETWORKS, getTargetNetwork, type NetworkConfig } from "../../config/networks";

describe("config/networks", () => {
  describe("NETWORKS", () => {
    it("should contain base-sepolia configuration", () => {
      expect(NETWORKS["base-sepolia"]).toBeDefined();
      expect(NETWORKS["base-sepolia"].chainId).toBe(84532);
      expect(NETWORKS["base-sepolia"].chainIdHex).toBe("0x14a34");
      expect(NETWORKS["base-sepolia"].name).toBe("Base Sepolia");
    });

    it("should contain hardhat configuration", () => {
      expect(NETWORKS["hardhat"]).toBeDefined();
      expect(NETWORKS["hardhat"].chainId).toBe(31337);
      expect(NETWORKS["hardhat"].rpcUrl).toBe("http://127.0.0.1:8545");
    });

    it("should contain sepolia configuration", () => {
      expect(NETWORKS["sepolia"]).toBeDefined();
      expect(NETWORKS["sepolia"].chainId).toBe(11155111);
      expect(NETWORKS["sepolia"].chainIdHex).toBe("0xaa36a7");
    });

    it("all networks should have required fields", () => {
      for (const [key, config] of Object.entries(NETWORKS)) {
        expect(config.chainId).toBeTypeOf("number");
        expect(config.chainIdHex).toBeTypeOf("string");
        expect(config.chainIdHex.startsWith("0x")).toBe(true);
        expect(config.name).toBeTypeOf("string");
        expect(config.rpcUrl).toBeTypeOf("string");
        expect(config.nativeCurrency).toBeDefined();
        expect(config.nativeCurrency.symbol).toBe("ETH");
        expect(config.nativeCurrency.decimals).toBe(18);
      }
    });

    it("chainIdHex should match chainId for all networks", () => {
      for (const config of Object.values(NETWORKS)) {
        expect(parseInt(config.chainIdHex, 16)).toBe(config.chainId);
      }
    });
  });

  describe("getTargetNetwork", () => {
    it("should return a valid network config", () => {
      const network = getTargetNetwork();
      expect(network).toBeDefined();
      expect(network.chainId).toBeTypeOf("number");
      expect(network.name).toBeTypeOf("string");
    });
  });
});
