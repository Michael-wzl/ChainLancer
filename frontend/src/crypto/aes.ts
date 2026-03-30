/**
 * AES-256-GCM encryption/decryption using Web Crypto API.
 *
 * Binary format: the 12-byte IV is prepended directly to the ciphertext,
 * producing a single compact Uint8Array suitable for IPFS storage.
 *
 *   Layout:  [ IV (12 bytes) | ciphertext + GCM tag ]
 */

import { importJobKey, bufferToHex, hexToBuffer } from "./jobKey";

/**
 * Legacy JSON payload type — kept for backward-compatible decryption of
 * any previously-stored data that used the old format.
 */
export interface EncryptedPayload {
  /** Hex-encoded initialization vector (12 bytes) */
  iv: string;
  /** Hex-encoded ciphertext (includes GCM auth tag) */
  ciphertext: string;
}

/**
 * Encrypt plaintext with AES-256-GCM.
 * @returns A compact binary blob: (12-byte IV || ciphertext).
 */
export async function encrypt(
  plaintext: string,
  keyHex: string
): Promise<Uint8Array> {
  const key = await importJobKey(keyHex);
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV for GCM
  const encoded = new TextEncoder().encode(plaintext);

  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoded
  );

  // Prepend IV directly to ciphertext → single binary blob
  const result = new Uint8Array(iv.byteLength + ciphertextBuffer.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(ciphertextBuffer), iv.byteLength);
  return result;
}

/**
 * Decrypt a binary payload produced by `encrypt`.
 * Also handles the legacy JSON format for backward compatibility.
 *
 * @param payload - Either a Uint8Array (IV || ciphertext) or an EncryptedPayload object
 * @param keyHex  - Hex-encoded 256-bit key
 * @returns The decrypted UTF-8 string
 */
export async function decrypt(
  payload: Uint8Array | EncryptedPayload,
  keyHex: string
): Promise<string> {
  const key = await importJobKey(keyHex);

  let iv: Uint8Array;
  let ciphertext: Uint8Array;

  if (payload instanceof Uint8Array) {
    // New binary format: first 12 bytes are IV
    iv = payload.slice(0, 12);
    ciphertext = payload.slice(12);
  } else {
    // Legacy JSON format
    iv = hexToBuffer(payload.iv);
    ciphertext = hexToBuffer(payload.ciphertext);
  }

  const plainBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv.buffer as ArrayBuffer },
    key,
    ciphertext.buffer as ArrayBuffer
  );

  return new TextDecoder().decode(plainBuffer);
}

/**
 * Encrypt a File to a binary encrypted blob.
 * Returns (12-byte IV || ciphertext) with filename/mimeType prepended as
 * a small header so we can reconstruct the file on decryption.
 *
 * Binary layout:
 *   [2 bytes header length (big-endian)] [JSON header] [12-byte IV] [ciphertext]
 */
export async function encryptFile(
  file: File,
  keyHex: string
): Promise<Uint8Array> {
  const arrayBuffer = await file.arrayBuffer();
  const key = await importJobKey(keyHex);
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    arrayBuffer
  );

  // Encode metadata as a small JSON header
  const header = new TextEncoder().encode(
    JSON.stringify({ filename: file.name, mimeType: file.type })
  );
  const headerLen = new Uint8Array(2);
  headerLen[0] = (header.byteLength >> 8) & 0xff;
  headerLen[1] = header.byteLength & 0xff;

  const result = new Uint8Array(
    2 + header.byteLength + iv.byteLength + ciphertextBuffer.byteLength
  );
  let offset = 0;
  result.set(headerLen, offset); offset += 2;
  result.set(header, offset); offset += header.byteLength;
  result.set(iv, offset); offset += iv.byteLength;
  result.set(new Uint8Array(ciphertextBuffer), offset);

  return result;
}

/**
 * Decrypt a file payload produced by `encryptFile` back to a Blob.
 */
export async function decryptFile(
  encrypted: Uint8Array,
  keyHex: string
): Promise<{ blob: Blob; filename: string; mimeType: string }> {
  // Read header length
  const headerLen = (encrypted[0] << 8) | encrypted[1];
  let offset = 2;

  // Read header
  const headerBytes = encrypted.slice(offset, offset + headerLen);
  offset += headerLen;
  const { filename, mimeType } = JSON.parse(new TextDecoder().decode(headerBytes));

  // Read IV
  const iv = encrypted.slice(offset, offset + 12);
  offset += 12;

  // Read ciphertext
  const ciphertext = encrypted.slice(offset);

  const key = await importJobKey(keyHex);
  const plainBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv.buffer as ArrayBuffer },
    key,
    ciphertext.buffer as ArrayBuffer
  );

  return {
    blob: new Blob([plainBuffer], { type: mimeType }),
    filename,
    mimeType,
  };
}
