/**
 * Tests for crypto/aes.ts — AES-256-GCM encryption/decryption
 *
 * Covers Stage 2 §8.2: AES-256-GCM Encryption / Decryption
 * - encrypt() + decrypt() roundtrip for text
 * - Binary format: [IV (12 bytes) | ciphertext + GCM tag]
 * - encryptFile() + decryptFile() roundtrip for files
 * - Different keys produce different ciphertexts
 * - Tampering with ciphertext causes decryption failure
 * - Legacy JSON payload backward compatibility
 */

import { describe, it, expect } from "vitest";
import { encrypt, decrypt, encryptFile, decryptFile } from "../../crypto/aes";
import { generateJobKey, bufferToHex, hexToBuffer } from "../../crypto/jobKey";

describe("crypto/aes", () => {
  // ─── Text Encrypt / Decrypt ───

  describe("encrypt + decrypt (text)", () => {
    it("should roundtrip plaintext correctly", async () => {
      const keyHex = await generateJobKey();
      const plaintext = "Hello, ChainLancer! This is a test agreement.";

      const encrypted = await encrypt(plaintext, keyHex);
      const decrypted = await decrypt(encrypted, keyHex);

      expect(decrypted).toBe(plaintext);
    });

    it("should produce binary output with IV prepended (12 bytes)", async () => {
      const keyHex = await generateJobKey();
      const encrypted = await encrypt("test", keyHex);

      expect(encrypted).toBeInstanceOf(Uint8Array);
      // Must be at least 12 (IV) + 4 (minimal ciphertext) + 16 (GCM tag) = 32 bytes
      expect(encrypted.byteLength).toBeGreaterThanOrEqual(32);
    });

    it("should produce different ciphertexts for same plaintext (random IV)", async () => {
      const keyHex = await generateJobKey();
      const plaintext = "Same message twice";

      const enc1 = await encrypt(plaintext, keyHex);
      const enc2 = await encrypt(plaintext, keyHex);

      // Different IVs → different ciphertext blobs
      expect(bufferToHex(enc1)).not.toBe(bufferToHex(enc2));

      // Both decrypt to the same plaintext
      const dec1 = await decrypt(enc1, keyHex);
      const dec2 = await decrypt(enc2, keyHex);
      expect(dec1).toBe(plaintext);
      expect(dec2).toBe(plaintext);
    });

    it("should fail to decrypt with a wrong key", async () => {
      const key1 = await generateJobKey();
      const key2 = await generateJobKey();

      const encrypted = await encrypt("secret data", key1);

      await expect(decrypt(encrypted, key2)).rejects.toThrow();
    });

    it("should fail to decrypt tampered ciphertext (GCM integrity)", async () => {
      const keyHex = await generateJobKey();
      const encrypted = await encrypt("authenticated content", keyHex);

      // Tamper with a byte in the ciphertext (after IV)
      const tampered = new Uint8Array(encrypted);
      tampered[20] ^= 0xff;

      await expect(decrypt(tampered, keyHex)).rejects.toThrow();
    });

    it("should handle empty string", async () => {
      const keyHex = await generateJobKey();
      const encrypted = await encrypt("", keyHex);
      const decrypted = await decrypt(encrypted, keyHex);
      expect(decrypted).toBe("");
    });

    it("should handle unicode content", async () => {
      const keyHex = await generateJobKey();
      const plaintext = "中文测试 🚀 Ñoño αβγ";

      const encrypted = await encrypt(plaintext, keyHex);
      const decrypted = await decrypt(encrypted, keyHex);
      expect(decrypted).toBe(plaintext);
    });

    it("should handle large content", async () => {
      const keyHex = await generateJobKey();
      const plaintext = "A".repeat(100_000); // 100KB

      const encrypted = await encrypt(plaintext, keyHex);
      const decrypted = await decrypt(encrypted, keyHex);
      expect(decrypted).toBe(plaintext);
    });
  });

  // ─── Legacy JSON format backward compatibility ───

  describe("decrypt (legacy JSON format)", () => {
    it("should decrypt legacy EncryptedPayload JSON format", async () => {
      const keyHex = await generateJobKey();
      const plaintext = "legacy data";

      // Manually create legacy format
      const key = await crypto.subtle.importKey(
        "raw",
        hexToBuffer(keyHex).buffer as ArrayBuffer,
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
      );
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encoded = new TextEncoder().encode(plaintext);
      const ciphertextBuf = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        encoded
      );

      const legacyPayload = {
        iv: bufferToHex(iv),
        ciphertext: bufferToHex(new Uint8Array(ciphertextBuf)),
      };

      const decrypted = await decrypt(legacyPayload, keyHex);
      expect(decrypted).toBe(plaintext);
    });
  });

  // ─── File Encrypt / Decrypt ───

  describe("encryptFile + decryptFile", () => {
    it("should roundtrip a file with metadata", async () => {
      const keyHex = await generateJobKey();
      const content = "File content here";
      const file = new File([content], "deliverable.pdf", {
        type: "application/pdf",
      });

      const encrypted = await encryptFile(file, keyHex);
      expect(encrypted).toBeInstanceOf(Uint8Array);

      const { blob, filename, mimeType } = await decryptFile(encrypted, keyHex);
      expect(filename).toBe("deliverable.pdf");
      expect(mimeType).toBe("application/pdf");

      const text = await blob.text();
      expect(text).toBe(content);
    });

    it("should preserve binary file content", async () => {
      const keyHex = await generateJobKey();
      const binaryData = new Uint8Array([0, 1, 2, 127, 128, 255]);
      const file = new File([binaryData], "image.png", { type: "image/png" });

      const encrypted = await encryptFile(file, keyHex);
      const { blob, filename } = await decryptFile(encrypted, keyHex);

      expect(filename).toBe("image.png");
      const result = new Uint8Array(await blob.arrayBuffer());
      expect(result).toEqual(binaryData);
    });

    it("should fail to decrypt file with wrong key", async () => {
      const key1 = await generateJobKey();
      const key2 = await generateJobKey();
      const file = new File(["secret file"], "test.txt", {
        type: "text/plain",
      });

      const encrypted = await encryptFile(file, key1);
      await expect(decryptFile(encrypted, key2)).rejects.toThrow();
    });
  });
});
