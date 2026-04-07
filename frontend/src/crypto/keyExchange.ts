/**
 * Key exchange for encrypting K_job to a recipient.
 *
 * Uses true ECIES (secp256k1 ECDH + AES-256-GCM) so that **only the
 * holder of the recipient's private key** can decrypt — not the sender.
 *
 * Public keys are registered on-chain (JobEscrow.encryptionPubKeys).
 * Callers look up the recipient's compressed public key from the contract
 * and pass it as `recipientPubKeyHex`.
 *
 * Output format:  [33-byte ephemeral pubkey | 12-byte IV | ciphertext+tag]
 */

import { bufferToHex, hexToBuffer } from "./jobKey";
import { eciesEncrypt, eciesDecrypt } from "./ecies";

/**
 * Encrypt a job key so that only the holder of the corresponding
 * secp256k1 private key can decrypt it.
 *
 * @param jobKeyHex           Hex-encoded 256-bit job key
 * @param recipientPubKeyHex  Hex-encoded compressed public key (33 bytes) of the recipient
 * @returns ECIES ciphertext blob
 */
export async function encryptForRecipient(
  jobKeyHex: string,
  recipientPubKeyHex: string
): Promise<Uint8Array> {
  const jobKeyBytes = hexToBuffer(jobKeyHex);
  return eciesEncrypt(jobKeyBytes, recipientPubKeyHex);
}

/**
 * Decrypt a job key that was encrypted with `encryptForRecipient`.
 *
 * The connected wallet must own the private key corresponding to the
 * public key that was used for encryption.  The private scalar is
 * recovered from a deterministic MetaMask signature (demo approach).
 *
 * @param encryptedBytes  ECIES blob from on-chain storage
 * @returns               Hex-encoded job key
 */
export async function decryptWithPrivateKey(
  encryptedBytes: Uint8Array,
  _recipientAddressHex?: string     // kept for API compat, no longer needed
): Promise<string> {
  const plainBytes = await eciesDecrypt(encryptedBytes);
  return bufferToHex(plainBytes);
}

/**
 * Convert encrypted key bytes to hex for on-chain storage.
 */
export function encryptedKeyToHex(encrypted: Uint8Array): string {
  return "0x" + bufferToHex(encrypted);
}

/**
 * Convert on-chain hex back to bytes.
 */
export function hexToEncryptedKey(hex: string): Uint8Array {
  return hexToBuffer(hex);
}
