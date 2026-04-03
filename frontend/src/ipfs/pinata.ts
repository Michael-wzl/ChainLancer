/**
 * Pinata IPFS pinning wrapper for uploads.
 *
 * Uses raw fetch against the Pinata pinning API.
 * Gateway retrieval logic lives in ./gateway.ts.
 *
 * In the demo, the Pinata JWT is embedded in the frontend bundle via env vars.
 */

const PINATA_JWT = () => import.meta.env.VITE_PINATA_JWT || "";

/**
 * Upload a JSON object to Pinata IPFS.
 * Returns the IPFS CID (Content Identifier).
 */
export async function uploadJSON(
  data: unknown,
  name?: string,
): Promise<string> {
  const jwt = PINATA_JWT();
  if (!jwt) {
    throw new Error("Pinata JWT not configured. Set VITE_PINATA_JWT.");
  }

  const body = JSON.stringify({
    pinataContent: data,
    pinataMetadata: {
      name: name || `chainlancer-${Date.now()}`,
    },
  });

  const response = await fetch(
    "https://api.pinata.cloud/pinning/pinJSONToIPFS",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`,
      },
      body,
    },
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Pinata upload failed: ${response.status} — ${errText}`);
  }

  const result = await response.json();
  return result.IpfsHash as string;
}

/**
 * Upload a raw file to Pinata IPFS.
 * Returns the IPFS CID.
 */
export async function uploadFile(
  file: File | Blob,
  name?: string,
): Promise<string> {
  const jwt = PINATA_JWT();
  if (!jwt) {
    throw new Error("Pinata JWT not configured. Set VITE_PINATA_JWT.");
  }

  const formData = new FormData();
  formData.append("file", file, name || `chainlancer-${Date.now()}`);
  formData.append(
    "pinataMetadata",
    JSON.stringify({ name: name || `chainlancer-file-${Date.now()}` }),
  );

  const response = await fetch(
    "https://api.pinata.cloud/pinning/pinFileToIPFS",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
      },
      body: formData,
    },
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(
      `Pinata file upload failed: ${response.status} — ${errText}`,
    );
  }

  const result = await response.json();
  return result.IpfsHash as string;
}
