/**
 * Tests for crypto/keyExchange.ts — ECDH key exchange helpers
 *
 * Covers Stage 2 §8.4: ECDH Key Exchange (ECIES)
 * - encryptedKeyToHex / hexToEncryptedKey roundtrip
 *
 * Note: encryptForRecipient / decryptWithPrivateKey require MetaMask
 * (personal_sign via BrowserProvider) and are tested in integration tests.
 * Here we test the serialization helpers that don't need wallet access.
 */

import { describe, it, expect } from "vitest";
import { encryptedKeyToHex, hexToEncryptedKey } from "../../crypto/keyExchange";

describe("crypto/keyExchange", () => {
  describe("encryptedKeyToHex / hexToEncryptedKey roundtrip", () => {
    it("should roundtrip Uint8Array → hex → Uint8Array", () => {
      const original = new Uint8Array([1, 2, 3, 100, 200, 255]);
      const hex = encryptedKeyToHex(original);

      expect(hex).toBe("0x01020364c8ff");

      const restored = hexToEncryptedKey(hex);
      expect(restored).toEqual(original);
    });

    it("should handle empty bytes", () => {
      const empty = new Uint8Array(0);
      const hex = encryptedKeyToHex(empty);
      expect(hex).toBe("0x");

      const restored = hexToEncryptedKey(hex);
      expect(restored.length).toBe(0);
    });

    it("should produce 0x-prefixed hex", () => {
      const data = new Uint8Array([0xab, 0xcd]);
      const hex = encryptedKeyToHex(data);
      expect(hex.startsWith("0x")).toBe(true);
    });
  });
});
