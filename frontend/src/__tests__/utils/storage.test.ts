/**
 * Tests for utils/storage.ts — localStorage job key persistence
 *
 * Covers Stage 2 §8.5: Job Key Storage (Browser)
 * - storeJobKey / getJobKey roundtrip
 * - removeJobKey
 * - getAllJobKeys
 * - Handles localStorage failures gracefully
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  storeJobKey,
  getJobKey,
  removeJobKey,
  getAllJobKeys,
} from "../../utils/storage";

describe("utils/storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("storeJobKey / getJobKey", () => {
    it("should store and retrieve a job key", () => {
      const keyHex = "a".repeat(64);
      storeJobKey(1, keyHex);

      const retrieved = getJobKey(1);
      expect(retrieved).toBe(keyHex);
    });

    it("should return null for non-existent key", () => {
      expect(getJobKey(999)).toBeNull();
    });

    it("should overwrite existing key for same jobId", () => {
      storeJobKey(1, "old_key");
      storeJobKey(1, "new_key");

      expect(getJobKey(1)).toBe("new_key");
    });

    it("should store keys for different jobIds independently", () => {
      storeJobKey(1, "key_one");
      storeJobKey(2, "key_two");

      expect(getJobKey(1)).toBe("key_one");
      expect(getJobKey(2)).toBe("key_two");
    });
  });

  describe("removeJobKey", () => {
    it("should remove an existing key", () => {
      storeJobKey(5, "key_five");
      expect(getJobKey(5)).toBe("key_five");

      removeJobKey(5);
      expect(getJobKey(5)).toBeNull();
    });

    it("should not throw when removing non-existent key", () => {
      expect(() => removeJobKey(999)).not.toThrow();
    });
  });

  describe("getAllJobKeys", () => {
    it("should return all stored job keys", () => {
      storeJobKey(1, "key_a");
      storeJobKey(2, "key_b");
      storeJobKey(3, "key_c");

      const allKeys = getAllJobKeys();
      expect(Object.keys(allKeys).length).toBe(3);
      expect(allKeys["1"]).toBe("key_a");
      expect(allKeys["2"]).toBe("key_b");
      expect(allKeys["3"]).toBe("key_c");
    });

    it("should return empty object when no keys stored", () => {
      const allKeys = getAllJobKeys();
      expect(Object.keys(allKeys).length).toBe(0);
    });

    it("should not include non-chainlancer localStorage items", () => {
      localStorage.setItem("other_app_key", "value");
      storeJobKey(1, "key_a");

      const allKeys = getAllJobKeys();
      expect(Object.keys(allKeys).length).toBe(1);
      expect(allKeys["1"]).toBe("key_a");
    });
  });
});
