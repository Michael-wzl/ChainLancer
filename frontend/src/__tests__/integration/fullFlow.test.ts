/**
 * Integration tests — Full Client & Freelancer Flows
 *
 * Covers Stage 2 §1.3: Demo Persona Flows
 *
 * These tests validate the complete data flow through the crypto, IPFS,
 * and storage layers as described in the Stage 2 specification.
 *
 * Flow 1: Client posts a job
 *   1. Generate job key → Generate salt
 *   2. Compute agreementHash = keccak256(salt || plaintext)
 *   3. Encrypt (salt || plaintext) with job key → ciphertext
 *   4. Upload ciphertext to IPFS → CID
 *   5. Call postJob(agreementHash, ..., CID)
 *   6. Store job key in localStorage
 *
 * Flow 2: Freelancer applies
 *   1. Compute proposalHash = keccak256(proposalText)
 *   2. Call applyForJob(jobId, proposalHash)
 *
 * Flow 3: Client selects freelancer
 *   1. Retrieve job key from localStorage
 *   2. Encrypt job key for freelancer (key exchange)
 *   3. Call selectFreelancer(jobId, freelancerAddr, encryptedKey)
 *
 * Flow 4: Freelancer submits milestone
 *   1. Retrieve/decrypt job key
 *   2. Encrypt deliverable with job key → ciphertext
 *   3. Upload to IPFS → CID
 *   4. Compute deliverableHash = keccak256(ciphertext)
 *   5. Call submitMilestone(jobId, msIdx, hash, CID)
 *
 * Flow 5: Client reviews and approves milestone
 *   1. Fetch ciphertext from IPFS
 *   2. Decrypt with job key → plaintext deliverable
 *   3. Call approveMilestone(jobId, msIdx)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  generateJobKey,
  generateSalt,
  bufferToHex,
  hexToBuffer,
} from "../../crypto/jobKey";
import { encrypt, decrypt, encryptFile, decryptFile } from "../../crypto/aes";
import { computeAgreementHash, computeContentHash } from "../../crypto/hash";
import { encryptedKeyToHex, hexToEncryptedKey } from "../../crypto/keyExchange";
import { storeJobKey, getJobKey, removeJobKey } from "../../utils/storage";
import { ethers } from "ethers";

describe("Integration: Full Job Lifecycle Data Flows", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // ─── Flow 1: Client Posts a Job ───

  describe("Flow 1: Client posts a job (crypto + IPFS prep)", () => {
    it("should generate job key, salt, compute hash, encrypt agreement", async () => {
      // Step 1: Generate job key and salt
      const jobKeyHex = await generateJobKey();
      const saltHex = generateSalt();

      expect(jobKeyHex).toHaveLength(64);
      expect(saltHex).toHaveLength(64);

      // Step 2: Compute agreement hash
      const agreementText = "Client agrees to pay 1000 USDC for website development.";
      const agreementHash = computeAgreementHash(saltHex, agreementText);
      expect(agreementHash).toMatch(/^0x[0-9a-f]{64}$/);

      // Step 3: Build plaintext payload (salt || text) and encrypt
      const saltBytes = hexToBuffer(saltHex);
      const textBytes = new TextEncoder().encode(agreementText);
      const payload = new Uint8Array(saltBytes.length + textBytes.length);
      payload.set(saltBytes);
      payload.set(textBytes, saltBytes.length);

      // Verify the hash matches what we'd compute manually
      const verifyHash = ethers.keccak256(payload);
      expect(verifyHash).toBe(agreementHash);

      // Encrypt the agreement
      const fullPlaintext = saltHex + agreementText;
      const ciphertext = await encrypt(fullPlaintext, jobKeyHex);
      expect(ciphertext).toBeInstanceOf(Uint8Array);
      expect(ciphertext.byteLength).toBeGreaterThan(12); // at least IV

      // Step 4: Verify we can decrypt it back
      const decrypted = await decrypt(ciphertext, jobKeyHex);
      expect(decrypted).toBe(fullPlaintext);

      // Step 5: Store job key
      const jobId = 0;
      storeJobKey(jobId, jobKeyHex);
      expect(getJobKey(jobId)).toBe(jobKeyHex);
    });

    it("should produce correct encrypted hash for on-chain registration", async () => {
      const jobKeyHex = await generateJobKey();
      const plaintext = "Agreement content";
      const ciphertext = await encrypt(plaintext, jobKeyHex);

      // The encrypted hash is keccak256 of the ciphertext bytes
      const encryptedHashHex = ethers.keccak256(ciphertext);
      expect(encryptedHashHex).toMatch(/^0x[0-9a-f]{64}$/);
    });
  });

  // ─── Flow 2: Freelancer Applies ───

  describe("Flow 2: Freelancer applies to a job", () => {
    it("should compute proposalHash from proposal text", () => {
      const proposalText = "I can build this website in 2 weeks with React + Tailwind.";
      const proposalHash = computeContentHash(proposalText);

      expect(proposalHash).toMatch(/^0x[0-9a-f]{64}$/);

      // Should be deterministic
      expect(computeContentHash(proposalText)).toBe(proposalHash);
    });
  });

  // ─── Flow 3: Client Selects Freelancer ───

  describe("Flow 3: Client selects freelancer (key exchange)", () => {
    it("should serialize encrypted key for on-chain storage", async () => {
      const jobKeyHex = await generateJobKey();

      // Simulate encrypting the job key for the freelancer
      // (In production, this uses ECDH via MetaMask signature)
      // Here we test the serialization helpers
      const mockEncryptedKey = new Uint8Array([
        ...crypto.getRandomValues(new Uint8Array(12)), // IV
        ...crypto.getRandomValues(new Uint8Array(48)), // encrypted key + tag
      ]);

      // Convert to hex for on-chain storage
      const hexForOnChain = encryptedKeyToHex(mockEncryptedKey);
      expect(hexForOnChain.startsWith("0x")).toBe(true);

      // Convert back from on-chain hex
      const restored = hexToEncryptedKey(hexForOnChain);
      expect(restored).toEqual(mockEncryptedKey);
    });
  });

  // ─── Flow 4: Freelancer Submits Milestone ───

  describe("Flow 4: Freelancer submits milestone deliverable", () => {
    it("should encrypt deliverable text and compute hash", async () => {
      const jobKeyHex = await generateJobKey();
      const deliverable =
        "Here is the completed homepage. See attached screenshots.";

      // Encrypt the deliverable
      const ciphertext = await encrypt(deliverable, jobKeyHex);

      // Compute deliverable hash (hash of the ciphertext)
      const deliverableHash = ethers.keccak256(ciphertext);
      expect(deliverableHash).toMatch(/^0x[0-9a-f]{64}$/);

      // Verify decryption
      const decrypted = await decrypt(ciphertext, jobKeyHex);
      expect(decrypted).toBe(deliverable);
    });

    it("should encrypt a deliverable file", async () => {
      const jobKeyHex = await generateJobKey();
      const content = "function hello() { console.log('hello'); }";
      const file = new File([content], "app.js", {
        type: "application/javascript",
      });

      const encrypted = await encryptFile(file, jobKeyHex);
      const { blob, filename, mimeType } = await decryptFile(
        encrypted,
        jobKeyHex
      );

      expect(filename).toBe("app.js");
      expect(mimeType).toBe("application/javascript");
      const text = await blob.text();
      expect(text).toBe(content);
    });
  });

  // ─── Flow 5: Client Reviews Milestone ───

  describe("Flow 5: Client reviews and decrypts milestone", () => {
    it("should decrypt deliverable using stored job key", async () => {
      const jobKeyHex = await generateJobKey();
      const jobId = 42;

      // Client stored the key when they posted the job
      storeJobKey(jobId, jobKeyHex);

      // Freelancer encrypted and submitted
      const deliverable = "Milestone 1 deliverable: API endpoints implemented.";
      const ciphertext = await encrypt(deliverable, jobKeyHex);

      // Client retrieves the key from localStorage
      const retrievedKey = getJobKey(jobId);
      expect(retrievedKey).toBe(jobKeyHex);

      // Client decrypts the deliverable
      const decrypted = await decrypt(ciphertext, retrievedKey!);
      expect(decrypted).toBe(deliverable);
    });
  });

  // ─── Full E2E Data Flow ───

  describe("Full end-to-end data flow", () => {
    it("should complete full lifecycle: post → apply → select → submit → review", async () => {
      const jobId = 1;

      // ═══ CLIENT: Post Job ═══
      const jobKeyHex = await generateJobKey();
      const saltHex = generateSalt();
      const agreementText =
        "Build a DeFi dashboard. 3 milestones. Total: 3000 USDC.";
      const agreementHash = computeAgreementHash(saltHex, agreementText);
      const agreementPlaintext = saltHex + agreementText;
      const encryptedAgreement = await encrypt(agreementPlaintext, jobKeyHex);
      storeJobKey(jobId, jobKeyHex);

      // Verify agreement hash
      expect(agreementHash).toMatch(/^0x[0-9a-f]{64}$/);

      // ═══ FREELANCER: Apply ═══
      const proposalText = "I'll build this using React + ethers.js.";
      const proposalHash = computeContentHash(proposalText);
      expect(proposalHash).toMatch(/^0x[0-9a-f]{64}$/);

      // ═══ CLIENT: Select Freelancer ═══
      const retrievedKey = getJobKey(jobId);
      expect(retrievedKey).toBe(jobKeyHex);

      // Simulate key exchange (serialization only)
      const fakeEncryptedJobKey = new Uint8Array(60);
      crypto.getRandomValues(fakeEncryptedJobKey);
      const onChainHex = encryptedKeyToHex(fakeEncryptedJobKey);
      expect(onChainHex.startsWith("0x")).toBe(true);

      // ═══ FREELANCER: Submit Milestone ═══
      const deliverable1 = "Milestone 1: Smart contract integration layer completed.";
      const encryptedDeliverable = await encrypt(deliverable1, jobKeyHex);
      const deliverableHash = ethers.keccak256(encryptedDeliverable);
      expect(deliverableHash).toMatch(/^0x[0-9a-f]{64}$/);

      // ═══ CLIENT: Review & Approve Milestone ═══
      const decryptedDeliverable = await decrypt(encryptedDeliverable, jobKeyHex);
      expect(decryptedDeliverable).toBe(deliverable1);

      // ═══ Cleanup ═══
      removeJobKey(jobId);
      expect(getJobKey(jobId)).toBeNull();
    });
  });

  // ─── Encrypted Payload Format Verification ───

  describe("Encrypted payload binary format (Stage 2 §7.4)", () => {
    it("should produce [IV (12 bytes) | ciphertext + GCM tag]", async () => {
      const keyHex = await generateJobKey();
      const plaintext = "Test payload";
      const encrypted = await encrypt(plaintext, keyHex);

      // First 12 bytes are IV
      const iv = encrypted.slice(0, 12);
      expect(iv.byteLength).toBe(12);

      // Remaining bytes are ciphertext + 16-byte GCM tag
      const ciphertextWithTag = encrypted.slice(12);
      // plaintext "Test payload" = 12 bytes + 16 byte tag = at least 28 bytes
      expect(ciphertextWithTag.byteLength).toBeGreaterThanOrEqual(28);
    });

    it("should produce agreement plaintext format [salt (32 bytes) | text]", async () => {
      const saltHex = generateSalt();
      const agreementText = "Agreement terms here";

      const saltBytes = hexToBuffer(saltHex);
      expect(saltBytes.byteLength).toBe(32);

      const textBytes = new TextEncoder().encode(agreementText);
      const combined = new Uint8Array(saltBytes.length + textBytes.length);
      combined.set(saltBytes);
      combined.set(textBytes, saltBytes.length);

      // Total = 32 (salt) + 20 (text) = 52 bytes
      expect(combined.byteLength).toBe(32 + textBytes.length);

      // Hash should be deterministic
      const hash = ethers.keccak256(combined);
      expect(hash).toBe(computeAgreementHash(saltHex, agreementText));
    });
  });
});
