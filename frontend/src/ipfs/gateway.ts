/**
 * IPFS gateway retrieval utilities.
 *
 * Separated from pinata.ts upload logic to maintain a clean decoupled
 * architecture — uploads go through the Pinata pinning API while
 * reads go through any public/private IPFS gateway.
 */

const GATEWAY_URL = () =>
  import.meta.env.VITE_PINATA_GATEWAY_URL || "https://gateway.pinata.cloud/ipfs";

/**
 * Retrieve raw content from IPFS via the configured gateway.
 * Retries on transient errors (403/429/5xx) with exponential backoff.
 */
export async function retrieveFromIPFS(cid: string): Promise<string> {
  const gatewayUrl = GATEWAY_URL();
  const url = `${gatewayUrl}/${cid}`;

  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch(url);
    if (response.ok) {
      return response.text();
    }
    // Retry on transient errors from Pinata rate limiting
    if ((response.status === 403 || response.status === 429 || response.status >= 500) && attempt < MAX_RETRIES) {
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      continue;
    }
    throw new Error(`IPFS retrieval failed: ${response.status}`);
  }
  throw new Error(`IPFS retrieval failed after ${MAX_RETRIES} retries`);
}

/**
 * Retrieve and parse JSON from IPFS.
 */
export async function retrieveJSON<T = unknown>(cid: string): Promise<T> {
  const text = await retrieveFromIPFS(cid);
  return JSON.parse(text) as T;
}

/**
 * Retrieve raw binary content from IPFS as a Uint8Array.
 * Retries on transient errors (403/429/5xx) with exponential backoff.
 */
export async function retrieveBinaryFromIPFS(cid: string): Promise<Uint8Array> {
  const gatewayUrl = GATEWAY_URL();
  const url = `${gatewayUrl}/${cid}`;

  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch(url);
    if (response.ok) {
      const buffer = await response.arrayBuffer();
      return new Uint8Array(buffer);
    }
    // Retry on transient errors from Pinata rate limiting
    if ((response.status === 403 || response.status === 429 || response.status >= 500) && attempt < MAX_RETRIES) {
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      continue;
    }
    throw new Error(`IPFS binary retrieval failed: ${response.status}`);
  }
  throw new Error(`IPFS binary retrieval failed after ${MAX_RETRIES} retries`);
}

/**
 * Build a gateway URL for a given CID (for linking/preview).
 */
export function getGatewayUrl(cid: string): string {
  const gatewayUrl = GATEWAY_URL();
  return `${gatewayUrl}/${cid}`;
}
