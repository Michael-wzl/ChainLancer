/**
 * localStorage helpers for persisting job keys per-session.
 * Job keys are stored locally so the user can decrypt content
 * without re-deriving from ECDH every time.
 *
 * IMPORTANT: Job keys are now namespaced by wallet address so that
 * switching MetaMask accounts during local testing does not cause
 * keys from one identity to leak into or overwrite another's.
 *
 * Legacy (address-less) keys are migrated on first read.
 */

const JOB_KEY_PREFIX = "chainlancer_jobkey_";
const JOB_TITLE_PREFIX = "chainlancer_jobtitle_";
const PROPOSAL_KEY_PREFIX = "chainlancer_proposalkey_";

// ─── Internal helpers ───

/** Build the per-address storage key for a job key. */
function jobKeyStorageKey(walletAddress: string, jobId: number): string {
  return `${JOB_KEY_PREFIX}${walletAddress.toLowerCase()}_${jobId}`;
}

/** Legacy key format (no address). */
function legacyJobKeyStorageKey(jobId: number): string {
  return `${JOB_KEY_PREFIX}${jobId}`;
}

/**
 * Try to migrate a legacy (pre-address-namespacing) key for the
 * given jobId to the new per-address format.  Returns the migrated
 * value if found, otherwise null.
 */
function migrateLegacyJobKey(walletAddress: string, jobId: number): string | null {
  try {
    const legacyKey = legacyJobKeyStorageKey(jobId);
    const value = localStorage.getItem(legacyKey);
    if (value) {
      // Copy to new per-address key and remove legacy entry
      localStorage.setItem(jobKeyStorageKey(walletAddress, jobId), value);
      localStorage.removeItem(legacyKey);
      console.debug(`[storage] Migrated legacy job key for job ${jobId} to address ${walletAddress}`);
      return value;
    }
  } catch {
    // ignore
  }
  return null;
}

// ─── Job Titles (global, not sensitive) ───

/**
 * Store a job title for display on listings.
 * Titles are stored unencrypted in localStorage since they are not sensitive.
 */
export function storeJobTitle(jobId: number, title: string): void {
  try {
    localStorage.setItem(`${JOB_TITLE_PREFIX}${jobId}`, title);
  } catch {
    console.warn("Failed to store job title in localStorage");
  }
}

/**
 * Retrieve a cached job title.
 */
export function getJobTitle(jobId: number): string | null {
  try {
    return localStorage.getItem(`${JOB_TITLE_PREFIX}${jobId}`);
  } catch {
    return null;
  }
}

// ─── Job Keys (per-address) ───

/**
 * Store a job key for a given job ID, namespaced under the wallet address.
 */
export function storeJobKey(jobId: number, keyHex: string, walletAddress?: string): void {
  if (!walletAddress) {
    console.warn("[storage] storeJobKey called without walletAddress — key will be stored under legacy prefix");
    try { localStorage.setItem(legacyJobKeyStorageKey(jobId), keyHex); } catch { /* ignore */ }
    return;
  }
  try {
    localStorage.setItem(jobKeyStorageKey(walletAddress, jobId), keyHex);
  } catch {
    console.warn("Failed to store job key in localStorage");
  }
}

/**
 * Retrieve a job key for a given job ID.
 * Looks up the per-address key first, then falls back to legacy (and migrates it).
 */
export function getJobKey(jobId: number, walletAddress?: string): string | null {
  try {
    if (walletAddress) {
      const value = localStorage.getItem(jobKeyStorageKey(walletAddress, jobId));
      if (value) return value;
      // Try legacy migration
      return migrateLegacyJobKey(walletAddress, jobId);
    }
    // Fallback: try legacy key (no address supplied)
    return localStorage.getItem(legacyJobKeyStorageKey(jobId));
  } catch {
    return null;
  }
}

/**
 * Remove a job key.
 */
export function removeJobKey(jobId: number, walletAddress?: string): void {
  try {
    if (walletAddress) {
      localStorage.removeItem(jobKeyStorageKey(walletAddress, jobId));
    }
    // Also clean up any legacy key
    localStorage.removeItem(legacyJobKeyStorageKey(jobId));
  } catch {
    // ignore
  }
}

/**
 * Get all stored job keys for a specific wallet address.
 * Falls back to showing all keys (legacy + addressed) if no address given.
 */
export function getAllJobKeys(walletAddress?: string): Record<string, string> {
  const keys: Record<string, string> = {};
  try {
    const prefix = walletAddress
      ? `${JOB_KEY_PREFIX}${walletAddress.toLowerCase()}_`
      : JOB_KEY_PREFIX;

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) {
        // Extract the jobId portion
        const suffix = key.replace(prefix, "");
        // For per-address keys the suffix is just the jobId number.
        // For legacy keys (when no walletAddress filter) the suffix may
        // contain an address.  We only show clean numeric ids.
        const jobId = walletAddress ? suffix : suffix.replace(/^.*_/, "");
        const value = localStorage.getItem(key);
        if (value) keys[jobId] = value;
      }
    }
  } catch {
    // ignore
  }
  return keys;
}

// ─── Proposal Keys (already per-address via freelancerAddr) ───

/**
 * Store a proposal decryption key for a given job+freelancer.
 */
export function storeProposalKey(jobId: number, freelancerAddr: string, keyHex: string): void {
  try {
    localStorage.setItem(
      `${PROPOSAL_KEY_PREFIX}${jobId}_${freelancerAddr.toLowerCase()}`,
      keyHex
    );
  } catch {
    console.warn("Failed to store proposal key in localStorage");
  }
}

/**
 * Retrieve a proposal decryption key.
 */
export function getProposalKey(jobId: number, freelancerAddr: string): string | null {
  try {
    return localStorage.getItem(
      `${PROPOSAL_KEY_PREFIX}${jobId}_${freelancerAddr.toLowerCase()}`
    );
  } catch {
    return null;
  }
}
