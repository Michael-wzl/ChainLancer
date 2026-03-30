/**
 * Hashing utilities for agreement verification.
 */

import { ethers } from "ethers";

/**
 * Compute agreementHash = keccak256(salt || plaintext)
 * Matches the on-chain verification logic.
 *
 * @param salt - Hex-encoded 256-bit salt (no 0x prefix)
 * @param plaintext - The agreement plaintext
 * @returns bytes32 hash string
 */
export function computeAgreementHash(salt: string, plaintext: string): string {
  const saltBytes = ethers.getBytes("0x" + salt);
  const textBytes = ethers.toUtf8Bytes(plaintext);
  const combined = new Uint8Array(saltBytes.length + textBytes.length);
  combined.set(saltBytes);
  combined.set(textBytes, saltBytes.length);
  return ethers.keccak256(combined);
}

/**
 * Compute the hash of encrypted content (for on-chain deliverable hash).
 */
export function computeContentHash(content: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(content));
}
