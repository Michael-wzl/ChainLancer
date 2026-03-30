/**
 * Tests for crypto/hash.ts — Agreement hash computation
 *
 * Covers Stage 2 §8.3: Agreement Hash Computation
 * - computeAgreementHash(salt, plaintext) = keccak256(salt || plaintext)
 * - computeContentHash(content) = keccak256(content)
 * - Hash determinism and uniqueness
 */

import { describe, it, expect } from "vitest";
import { computeAgreementHash, computeContentHash } from "../../crypto/hash";
import { generateSalt } from "../../crypto/jobKey";
import { ethers } from "ethers";

describe("crypto/hash", () => {
  // ─── computeAgreementHash ───

  describe("computeAgreementHash", () => {
    it("should return a bytes32 hex string", () => {
      const salt = generateSalt();
      const hash = computeAgreementHash(salt, "Test agreement");

      expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it("should be deterministic for same inputs", () => {
      const salt = "a".repeat(64);
      const plaintext = "Same agreement text";

      const hash1 = computeAgreementHash(salt, plaintext);
      const hash2 = computeAgreementHash(salt, plaintext);

      expect(hash1).toBe(hash2);
    });

    it("should produce different hashes for different salts", () => {
      const salt1 = generateSalt();
      const salt2 = generateSalt();
      const plaintext = "Same agreement text";

      const hash1 = computeAgreementHash(salt1, plaintext);
      const hash2 = computeAgreementHash(salt2, plaintext);

      expect(hash1).not.toBe(hash2);
    });

    it("should produce different hashes for different plaintexts", () => {
      const salt = "b".repeat(64);

      const hash1 = computeAgreementHash(salt, "Agreement A");
      const hash2 = computeAgreementHash(salt, "Agreement B");

      expect(hash1).not.toBe(hash2);
    });

    it("should match manual keccak256(salt || plaintext) computation", () => {
      const salt = "cc".repeat(32); // 32 bytes as hex
      const plaintext = "Hello";

      const hash = computeAgreementHash(salt, plaintext);

      // Manual computation
      const saltBytes = ethers.getBytes("0x" + salt);
      const textBytes = ethers.toUtf8Bytes(plaintext);
      const combined = new Uint8Array(saltBytes.length + textBytes.length);
      combined.set(saltBytes);
      combined.set(textBytes, saltBytes.length);
      const expected = ethers.keccak256(combined);

      expect(hash).toBe(expected);
    });
  });

  // ─── computeContentHash ───

  describe("computeContentHash", () => {
    it("should return a bytes32 hex string", () => {
      const hash = computeContentHash("deliverable content");
      expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it("should be deterministic", () => {
      const content = "Same content";
      const hash1 = computeContentHash(content);
      const hash2 = computeContentHash(content);
      expect(hash1).toBe(hash2);
    });

    it("should produce different hashes for different content", () => {
      const hash1 = computeContentHash("content A");
      const hash2 = computeContentHash("content B");
      expect(hash1).not.toBe(hash2);
    });

    it("should match ethers.keccak256 directly", () => {
      const content = "Test content";
      const hash = computeContentHash(content);
      const expected = ethers.keccak256(ethers.toUtf8Bytes(content));
      expect(hash).toBe(expected);
    });
  });
});
