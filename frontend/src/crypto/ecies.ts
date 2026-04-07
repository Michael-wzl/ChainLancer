/**
 * ECIES (Elliptic Curve Integrated Encryption Scheme) using secp256k1.
 *
 * Provides true asymmetric encryption:
 *   - Anyone with the recipient's **public key** can encrypt.
 *   - Only the holder of the corresponding **private key** can decrypt.
 *
 * Uses @noble/curves for the ECDH shared-secret derivation, then
 * AES-256-GCM via the Web Crypto API for symmetric encryption.
 *
 * Binary format of an ECIES ciphertext:
 *   [33-byte compressed ephemeral pubkey | 12-byte IV | ciphertext+GCM-tag]
 */

import { secp256k1 } from "@noble/curves/secp256k1.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bufferToHex, hexToBuffer } from "./jobKey";

// ─── Constants ───

const ECIES_INFO = new TextEncoder().encode("ChainLancer-ECIES-v1");
const COMPRESSED_PUBKEY_LEN = 33;
const IV_LEN = 12;

// ─── Public-key helpers ───

/**
 * Recover the caller's secp256k1 **public key** that pairs with
 * the private scalar derived in `recoverPrivateScalar()`.
 *
 * Asks MetaMask to `personal_sign` a deterministic message, then
 * derives the same scalar used for ECIES decryption and computes
 * the corresponding public key.  This guarantees that
 * encrypt(pubKey) ↔ decrypt(privScalar) are perfectly paired.
 *
 * @returns Hex-encoded **compressed** public key (33 bytes, 0x prefix).
 */
export async function recoverPublicKey(): Promise<string> {
  // Derive the private scalar (same path as eciesDecrypt)
  const privScalar = await recoverPrivateScalar();

  // Compute the matching compressed public key
  const compressed = secp256k1.getPublicKey(privScalar, true); // 33 bytes

  return "0x" + bufferToHex(compressed);
}

// ─── Derive symmetric key from ECDH shared secret ───

function deriveAesKey(sharedSecret: Uint8Array): Promise<CryptoKey> {
  // HKDF-SHA256 → 32-byte AES key
  const derived = hkdf(sha256, sharedSecret, /*salt=*/ undefined, ECIES_INFO, 32);
  return crypto.subtle.importKey(
    "raw",
    derived.buffer as ArrayBuffer,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

// ─── Encrypt / Decrypt ───

/**
 * Encrypt `plainBytes` so that only the holder of `recipientPubKeyHex`'s
 * private key can decrypt.
 *
 * @param plainBytes          The data to encrypt (arbitrary bytes).
 * @param recipientPubKeyHex  Hex-encoded compressed public key (33 bytes, with/without 0x).
 * @returns ECIES ciphertext:  [ephemeralPub (33) | IV (12) | ciphertext+tag]
 */
export async function eciesEncrypt(
  plainBytes: Uint8Array,
  recipientPubKeyHex: string
): Promise<Uint8Array> {
  const recipientPub = hexToBuffer(recipientPubKeyHex);

  // 1. Generate an ephemeral keypair
  const ephemeralPriv = secp256k1.utils.randomSecretKey();
  const ephemeralPub = secp256k1.getPublicKey(ephemeralPriv, true); // compressed

  // 2. ECDH shared secret  (x-coordinate of ephPriv * recipientPub)
  const sharedPoint = secp256k1.getSharedSecret(ephemeralPriv, recipientPub);
  // getSharedSecret returns uncompressed (65 bytes) — take x-coordinate (bytes 1..33)
  const sharedX = sharedPoint.slice(1, 33);

  // 3. Derive AES-256-GCM key via HKDF
  const aesKey = await deriveAesKey(sharedX);

  // 4. Encrypt
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, plainBytes.buffer as ArrayBuffer)
  );

  // 5. Pack:  ephemeralPub || iv || ciphertext
  const result = new Uint8Array(
    COMPRESSED_PUBKEY_LEN + IV_LEN + ciphertext.byteLength
  );
  result.set(ephemeralPub, 0);
  result.set(iv, COMPRESSED_PUBKEY_LEN);
  result.set(ciphertext, COMPRESSED_PUBKEY_LEN + IV_LEN);
  return result;
}

/**
 * Decrypt an ECIES ciphertext using the recipient's private key.
 *
 * The private key is obtained via MetaMask `personal_sign` + ecrecover,
 * **not** exported directly.  We ask MetaMask to sign a deterministic
 * message and derive the same scalar that was used when the public key
 * was first registered.
 *
 * ⚠️  In a real product you would use `eth_getEncryptionPublicKey` or
 *     a dedicated key-management solution.  For this demo, the private
 *     scalar is derived from a deterministic signature.
 *
 * @param ciphertext  ECIES blob:  [ephPub (33) | IV (12) | ciphertext+tag]
 * @returns           Decrypted plaintext bytes.
 */
export async function eciesDecrypt(ciphertext: Uint8Array): Promise<Uint8Array> {
  // 1. Unpack
  const ephemeralPub = ciphertext.slice(0, COMPRESSED_PUBKEY_LEN);
  const iv = ciphertext.slice(COMPRESSED_PUBKEY_LEN, COMPRESSED_PUBKEY_LEN + IV_LEN);
  const encrypted = ciphertext.slice(COMPRESSED_PUBKEY_LEN + IV_LEN);

  // 2. Recover private scalar from deterministic signature
  const privScalar = await recoverPrivateScalar();

  // 3. ECDH shared secret
  const sharedPoint = secp256k1.getSharedSecret(privScalar, ephemeralPub);
  const sharedX = sharedPoint.slice(1, 33);

  // 4. Derive same AES key
  const aesKey = await deriveAesKey(sharedX);

  // 5. Decrypt
  const plainBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    aesKey,
    encrypted
  );

  return new Uint8Array(plainBuffer);
}

// ─── Private-key recovery (demo approach) ───

/**
 * Derive a deterministic private scalar from a MetaMask `personal_sign`.
 *
 * This is a **demo-only** technique.  We ask the wallet to sign a fixed
 * domain-separated message, then hash the signature to produce a 32-byte
 * scalar that is used as a secp256k1 private key.
 *
 * Because `personal_sign` is deterministic for the same message+key,
 * the same scalar is recovered every time — which means the
 * corresponding public key is also deterministic.
 *
 * The public key registered on-chain (via `recoverPublicKey`) is derived
 * from the *same* signature, so encrypt(pubKey) ↔ decrypt(privScalar)
 * are perfectly paired.
 *
 * @param expectedAddress  If provided, verifies that the MetaMask signer
 *                         matches this address.  Throws if they differ
 *                         (catches accidental account-switch issues).
 */
async function recoverPrivateScalar(expectedAddress?: string): Promise<Uint8Array> {
  const { ethers } = await import("ethers");
  const provider = new ethers.BrowserProvider((window as any).ethereum);
  const signer = await provider.getSigner();
  const address = await signer.getAddress();

  // Guard: verify the active MetaMask account is the one we expect
  if (expectedAddress && address.toLowerCase() !== expectedAddress.toLowerCase()) {
    throw new Error(
      `Wallet mismatch: expected ${expectedAddress} but MetaMask is using ${address}. ` +
      `Please switch to the correct account in MetaMask and try again.`
    );
  }

  const message = `ChainLancer-PubKey-Recovery:${address.toLowerCase()}`;
  const signature = await signer.signMessage(message);

  // Hash the signature to get a uniform 32-byte scalar
  const sigBytes = hexToBuffer(signature);
  const scalar = sha256(sigBytes);

  // Ensure the scalar is valid for secp256k1 (non-zero, < curve order).
  // sha256 output is 32 bytes — overwhelmingly likely to be in range.
  // We reduce modulo n just in case.
  const n = secp256k1.Point.Fn.ORDER;
  let num = BigInt("0x" + bufferToHex(scalar));
  num = ((num - 1n) % (n - 1n)) + 1n; // map to [1, n-1]
  const hexScalar = num.toString(16).padStart(64, "0");
  return hexToBuffer(hexScalar);
}
