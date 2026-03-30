/**
 * ECDH-style key exchange for encrypting K_job to a recipient.
 *
 * Uses MetaMask's personal_sign to derive a deterministic shared secret from
 * the sender's private key + recipient's address.  This provides real
 * cryptographic protection (only the signer who controls the private key can
 * produce the same HKDF-derived AES wrapping key).
 *
 * Encryption:  sender signs a domain-separated message containing the
 *              recipient address → HKDF(signature) → AES-GCM wrapping key.
 * Decryption:  the original signer produces the same signature (deterministic
 *              EIP-191 personal_sign) and derives the same wrapping key.
 *
 * Output format: (12-byte IV || ciphertext)
 */

import { ethers } from "ethers";
import { bufferToHex, hexToBuffer } from "./jobKey";

/**
 * Derive a deterministic AES-256 wrapping key by having the current
 * wallet signer sign a domain-separated message that binds the recipient.
 *
 * The signature is used as secret key material for HKDF → AES-256.
 * Because personal_sign requires the private key, an observer who only
 * knows the public address **cannot** reproduce this key.
 */
async function deriveWrappingKey(recipientAddressHex: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();

  // Build a deterministic message so the same sender+recipient pair
  // always produces the same wrapping key.
  const message = `ChainLancer-KeyExchange-v1:${recipientAddressHex.toLowerCase()}`;

  // Request signature from the connected wallet (MetaMask).
  const provider = new ethers.BrowserProvider((window as any).ethereum);
  const signer = await provider.getSigner();
  const signature = await signer.signMessage(message);

  // Use the signature bytes as HKDF key material.
  const sigBytes = hexToBuffer(signature);
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    sigBytes.buffer as ArrayBuffer,
    "HKDF",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode("ChainLancer-KeyExchange-v1"),
      info: encoder.encode("job-key-wrapping"),
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypt a job key for a recipient.  The connected wallet signs a
 * deterministic message so that only the same signer can later decrypt.
 *
 * Returns (IV || ciphertext) as a single Uint8Array.
 *
 * @param jobKeyHex               Hex-encoded 256-bit job key
 * @param recipientAddressHex     Recipient Ethereum address (with or without 0x)
 */
export async function encryptForRecipient(
  jobKeyHex: string,
  recipientAddressHex: string
): Promise<Uint8Array> {
  const wrappingKey = await deriveWrappingKey(recipientAddressHex);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const jobKeyBytes = hexToBuffer(jobKeyHex);

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    wrappingKey,
    jobKeyBytes.buffer as ArrayBuffer
  );

  // Prepend IV to ciphertext → single binary blob
  const result = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(ciphertext), iv.byteLength);
  return result;
}

/**
 * Decrypt a job key that was encrypted with `encryptForRecipient`.
 *
 * The connected wallet must be the same signer that originally encrypted,
 * because the wrapping key is derived from a personal_sign signature.
 *
 * @param encryptedBytes      (IV || ciphertext) blob from on-chain storage
 * @param recipientAddressHex The recipient's Ethereum address (used in the
 *                            domain-separated message for signature reproduction)
 * @returns                   Hex-encoded job key
 */
export async function decryptWithPrivateKey(
  encryptedBytes: Uint8Array,
  recipientAddressHex: string
): Promise<string> {
  const wrappingKey = await deriveWrappingKey(recipientAddressHex);
  const iv = encryptedBytes.slice(0, 12);
  const ciphertext = encryptedBytes.slice(12);

  const plainBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    wrappingKey,
    ciphertext
  );

  return bufferToHex(new Uint8Array(plainBuffer));
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
