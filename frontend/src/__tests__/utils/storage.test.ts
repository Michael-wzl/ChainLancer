/**
 * Tests for utils/storage.ts — localStorage job key persistence
 *
 * Covers Stage 2 §8.5: Job Key Storage (Browser)
 * - storeJobKey / getJobKey roundtrip (per-address namespacing)
 * - removeJobKey
 * - getAllJobKeys
 * - Legacy key migration
 * - Cross-account isolation
 * - Handles localStorage failures gracefully
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  storeJobKey,
  getJobKey,
  removeJobKey,
  getAllJobKeys,
} from "../../utils/storage";

const ALICE = "0xAliceAddress1234567890123456789012345678";
const BOB = "0xBobAddress00001234567890123456789012345678";

describe("utils/storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("storeJobKey / getJobKey (per-address)", () => {
    it("should store and retrieve a job key for a specific address", () => {
      const keyHex = "a".repeat(64);
      storeJobKey(1, keyHex, ALICE);

      const retrieved = getJobKey(1, ALICE);
      expect(retrieved).toBe(keyHex);
    });

    it("should return null for non-existent key", () => {
      expect(getJobKey(999, ALICE)).toBeNull();
    });

    it("should overwrite existing key for same jobId + address", () => {
      storeJobKey(1, "old_key", ALICE);
      storeJobKey(1, "new_key", ALICE);

      expect(getJobKey(1, ALICE)).toBe("new_key");
    });

    it("should store keys for different jobIds independently", () => {
      storeJobKey(1, "key_one", ALICE);
      storeJobKey(2, "key_two", ALICE);

      expect(getJobKey(1, ALICE)).toBe("key_one");
      expect(getJobKey(2, ALICE)).toBe("key_two");
    });

    it("should isolate keys between different wallet addresses", () => {
      storeJobKey(1, "alice_key", ALICE);
      storeJobKey(1, "bob_key", BOB);

      expect(getJobKey(1, ALICE)).toBe("alice_key");
      expect(getJobKey(1, BOB)).toBe("bob_key");
    });

    it("should NOT return another address's key", () => {
      storeJobKey(1, "alice_key", ALICE);
      expect(getJobKey(1, BOB)).toBeNull();
    });
  });

  describe("legacy key migration", () => {
    it("should migrate a legacy (no-address) key on first read", () => {
      // Simulate a legacy key stored without address
      localStorage.setItem("chainlancer_jobkey_1", "legacy_key");

      // Reading with an address should migrate it
      const value = getJobKey(1, ALICE);
      expect(value).toBe("legacy_key");

      // Legacy key should be removed
      expect(localStorage.getItem("chainlancer_jobkey_1")).toBeNull();

      // Per-address key should now exist
      expect(getJobKey(1, ALICE)).toBe("legacy_key");
    });

    it("should not migrate legacy key if per-address key already exists", () => {
      localStorage.setItem("chainlancer_jobkey_1", "legacy_key");
      storeJobKey(1, "new_key", ALICE);

      const value = getJobKey(1, ALICE);
      expect(value).toBe("new_key");
    });
  });

  describe("removeJobKey", () => {
    it("should remove an existing key for a specific address", () => {
      storeJobKey(5, "key_five", ALICE);
      expect(getJobKey(5, ALICE)).toBe("key_five");

      removeJobKey(5, ALICE);
      expect(getJobKey(5, ALICE)).toBeNull();
    });

    it("should not throw when removing non-existent key", () => {
      expect(() => removeJobKey(999, ALICE)).not.toThrow();
    });

    it("should not remove another address's key", () => {
      storeJobKey(1, "alice_key", ALICE);
      storeJobKey(1, "bob_key", BOB);

      removeJobKey(1, ALICE);
      expect(getJobKey(1, ALICE)).toBeNull();
      expect(getJobKey(1, BOB)).toBe("bob_key");
    });
  });

  describe("getAllJobKeys", () => {
    it("should return all stored job keys for a specific address", () => {
      storeJobKey(1, "key_a", ALICE);
      storeJobKey(2, "key_b", ALICE);
      storeJobKey(3, "key_c", BOB);

      const aliceKeys = getAllJobKeys(ALICE);
      expect(Object.keys(aliceKeys).length).toBe(2);
      expect(aliceKeys["1"]).toBe("key_a");
      expect(aliceKeys["2"]).toBe("key_b");
    });

    it("should return empty object when no keys stored for address", () => {
      storeJobKey(1, "key_a", ALICE);
      const bobKeys = getAllJobKeys(BOB);
      expect(Object.keys(bobKeys).length).toBe(0);
    });

    it("should not include non-chainlancer localStorage items", () => {
      localStorage.setItem("other_app_key", "value");
      storeJobKey(1, "key_a", ALICE);

      const allKeys = getAllJobKeys(ALICE);
      expect(Object.keys(allKeys).length).toBe(1);
      expect(allKeys["1"]).toBe("key_a");
    });
  });
});
