import React, { useState, useEffect } from "react";
import { FileText, Download, Loader2, Lock } from "lucide-react";
import { retrieveFromIPFS, getGatewayUrl } from "../../ipfs";
import { decrypt, type EncryptedPayload } from "../../crypto";
import { hexToBuffer } from "../../crypto";

interface IPFSFileViewerProps {
  cid: string;
  jobKey?: string | null;
  label?: string;
}

export function IPFSFileViewer({ cid, jobKey, label = "IPFS Content" }: IPFSFileViewerProps) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDecrypted, setIsDecrypted] = useState(false);

  const fetchAndDecrypt = async () => {
    if (!cid) return;
    setLoading(true);
    setError(null);

    try {
      const raw = await retrieveFromIPFS(cid);

      if (jobKey) {
        try {
          // Try to decode as binary (new format)
          // retrieveFromIPFS returns text, so try legacy JSON first
          const parsed = JSON.parse(raw) as EncryptedPayload;
          const decrypted = await decrypt(parsed, jobKey);
          setContent(decrypted);
          setIsDecrypted(true);
        } catch {
          // Not JSON — might be raw binary fetched as text, show as-is
          setContent(raw);
          setIsDecrypted(false);
        }
      } else {
        setContent(raw);
        setIsDecrypted(false);
      }
    } catch (err) {
      setError("Failed to fetch from IPFS");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
          <FileText className="h-4 w-4" />
          {label}
          {isDecrypted && (
            <span className="text-xs text-green-600 flex items-center gap-1">
              <Lock className="h-3 w-3" /> Decrypted
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <a
            href={getGatewayUrl(cid)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-brand-600 hover:underline"
          >
            View on IPFS
          </a>
          {!content && (
            <button
              onClick={fetchAndDecrypt}
              disabled={loading}
              className="btn-secondary text-xs py-1 px-2"
            >
              {loading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Download className="h-3 w-3" />
              )}
            </button>
          )}
        </div>
      </div>

      <p className="text-xs text-gray-400 font-mono break-all mb-2">CID: {cid}</p>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {content && (
        <pre className="mt-2 max-h-60 overflow-auto rounded bg-white p-3 text-xs text-gray-700 border">
          {content}
        </pre>
      )}
    </div>
  );
}
