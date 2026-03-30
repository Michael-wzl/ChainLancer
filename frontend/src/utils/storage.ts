/**
 * localStorage helpers for persisting job keys per-session.
 * Job keys are stored locally so the user can decrypt content
 * without re-deriving from ECDH every time.
 */

const JOB_KEY_PREFIX = "chainlancer_jobkey_";
const JOB_TITLE_PREFIX = "chainlancer_jobtitle_";

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

/**
 * Store a job key for a given job ID.
 */
export function storeJobKey(jobId: number, keyHex: string): void {
  try {
    localStorage.setItem(`${JOB_KEY_PREFIX}${jobId}`, keyHex);
  } catch {
    console.warn("Failed to store job key in localStorage");
  }
}

/**
 * Retrieve a job key for a given job ID.
 */
export function getJobKey(jobId: number): string | null {
  try {
    return localStorage.getItem(`${JOB_KEY_PREFIX}${jobId}`);
  } catch {
    return null;
  }
}

/**
 * Remove a job key.
 */
export function removeJobKey(jobId: number): void {
  try {
    localStorage.removeItem(`${JOB_KEY_PREFIX}${jobId}`);
  } catch {
    // ignore
  }
}

/**
 * Get all stored job keys (for debug/admin purposes).
 */
export function getAllJobKeys(): Record<string, string> {
  const keys: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(JOB_KEY_PREFIX)) {
        const jobId = key.replace(JOB_KEY_PREFIX, "");
        const value = localStorage.getItem(key);
        if (value) keys[jobId] = value;
      }
    }
  } catch {
    // ignore
  }
  return keys;
}
