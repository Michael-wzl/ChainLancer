/**
 * Tests for crypto/jobKey.ts — Job key generation & hex helpers
 *
 * Covers Stage 2 §8.1: Job Key Generation
 * - generateJobKey() produces a 256-bit (32-byte) AES key as hex
 * - generateSalt() produces a 256-bit (32-byte) random salt as hex
 * - importJobKey() correctly imports hex keys for Web Crypto API
 * - bufferToHex / hexToBuffer roundtrip correctly
 */

import { describe, it, expect } from "vitest";
import {
  generateJobKey,
  generateSalt,
  importJobKey,
  bufferToHex,
  hexToBuffer,
} from "../../crypto/jobKey";

describe("crypto/jobKey", () => {
  // ─── generateJobKey ───

  describe("generateJobKey", () => {
    it("should return a 64-character hex string (256-bit key)", async () => {
      const key = await generateJobKey();
      expect(key).toHaveLength(64);
      expect(key).toMatch(/^[0-9a-f]{64}$/);
    });

    it("should generate unique keys on consecutive calls", async () => {
      const key1 = await generateJobKey();
      const key2 = await generateJobKey();
      expect(key1).not.toBe(key2);
    });

    it("should be importable as a CryptoKey", async () => {
      const keyHex = await generateJobKey();
      const cryptoKey = await importJobKey(keyHex);
      expect(cryptoKey).toBeDefined();
      expect(cryptoKey.algorithm).toMatchObject({ name: "AES-GCM", length: 256 });
      expect(cryptoKey.usages).toContain("encrypt");
      expect(cryptoKey.usages).toContain("decrypt");
    });
  });

  // ─── generateSalt ───

  describe("generateSalt", () => {
    it("should return a 64-character hex string (256-bit salt)", () => {
      const salt = generateSalt();
      expect(salt).toHaveLength(64);
      expect(salt).toMatch(/^[0-9a-f]{64}$/);
    });

    it("should generate unique salts on consecutive calls", () => {
      const salt1 = generateSalt();
      const salt2 = generateSalt();
      expect(salt1).not.toBe(salt2);
    });
  });

  // ─── bufferToHex / hexToBuffer roundtrip ───

  describe("hex conversion helpers", () => {
    it("should roundtrip bufferToHex → hexToBuffer", () => {
      const original = new Uint8Array([0, 1, 127, 128, 255]);
      const hex = bufferToHex(original);
      const restored = hexToBuffer(hex);
      expect(restored).toEqual(original);
    });

    it("should handle 0x prefix in hexToBuffer", () => {
      const hex = "0x00ff";
      const buffer = hexToBuffer(hex);
      expect(buffer).toEqual(new Uint8Array([0, 255]));
    });

    it("should handle empty buffer", () => {
      const empty = new Uint8Array(0);
      const hex = bufferToHex(empty);
      expect(hex).toBe("");
      const restored = hexToBuffer(hex);
      expect(restored.length).toBe(0);
    });

    it("should produce lowercase hex", () => {
      const buffer = new Uint8Array([0xab, 0xcd, 0xef]);
      const hex = bufferToHex(buffer);
      expect(hex).toBe("abcdef");
    });

    it("should pad single-digit hex values", () => {
      const buffer = new Uint8Array([0, 1, 2, 15]);
      const hex = bufferToHex(buffer);
      expect(hex).toBe("0001020f");
    });
  });

  // ─── importJobKey ───

  describe("importJobKey", () => {
    it("should import a valid 256-bit hex key", async () => {
      const hex = "a".repeat(64); // 32 bytes
      const key = await importJobKey(hex);
      expect(key.type).toBe("secret");
      expect(key.extractable).toBe(true);
    });

    it("should import a key with 0x prefix", async () => {
      const hex = "0x" + "b".repeat(64);
      const key = await importJobKey(hex);
      expect(key.type).toBe("secret");
    });

    it("should reject an invalid key length", async () => {
      const shortHex = "abcdef"; // only 3 bytes
      await expect(importJobKey(shortHex)).rejects.toThrow();
    });
  });
});
