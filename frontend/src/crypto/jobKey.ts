/**
 * Job key generation using Web Crypto API.
 * Generates AES-256 symmetric keys and cryptographic salts.
 */

/**
 * Generate a random 256-bit AES key for a job.
 * Returns the raw key bytes as a hex string.
 */
export async function generateJobKey(): Promise<string> {
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
  const rawKey = await crypto.subtle.exportKey("raw", key);
  return bufferToHex(new Uint8Array(rawKey));
}

/**
 * Generate a cryptographically random 256-bit salt.
 */
export function generateSalt(): string {
  const salt = new Uint8Array(32);
  crypto.getRandomValues(salt);
  return bufferToHex(salt);
}

/**
 * Import a hex-encoded key for use with Web Crypto API.
 */
export async function importJobKey(hexKey: string): Promise<CryptoKey> {
  const keyBytes = hexToBuffer(hexKey);
  return crypto.subtle.importKey(
    "raw",
    keyBytes.buffer as ArrayBuffer,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

// ─── Hex helpers ───

export function bufferToHex(buffer: Uint8Array): string {
  return Array.from(buffer)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function hexToBuffer(hex: string): Uint8Array {
  const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.substr(i * 2, 2), 16);
  }
  return bytes;
}
