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
 */
export async function retrieveFromIPFS(cid: string): Promise<string> {
  const gatewayUrl = GATEWAY_URL();
  const url = `${gatewayUrl}/${cid}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`IPFS retrieval failed: ${response.status}`);
  }

  return response.text();
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
 */
export async function retrieveBinaryFromIPFS(cid: string): Promise<Uint8Array> {
  const gatewayUrl = GATEWAY_URL();
  const url = `${gatewayUrl}/${cid}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`IPFS binary retrieval failed: ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * Build a gateway URL for a given CID (for linking/preview).
 */
export function getGatewayUrl(cid: string): string {
  const gatewayUrl = GATEWAY_URL();
  return `${gatewayUrl}/${cid}`;
}
