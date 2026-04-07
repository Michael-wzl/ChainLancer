import React, { useState, useCallback } from "react";
import { FileText, Lock, Unlock, Loader2, AlertTriangle, Clock, User } from "lucide-react";
import { retrieveFromIPFS, retrieveBinaryFromIPFS } from "../../ipfs/gateway";
import { decrypt } from "../../crypto/aes";
import { formatDateTime, truncateAddress } from "../../utils/format";

// ─── Types ───

interface EvidenceItemData {
  submitter: string;
  evidenceCID: string;
  submittedAt: number;
  isClient: boolean;
}

interface EvidenceDecryptorProps {
  evidenceItems: EvidenceItemData[];
  jobKeyHex: string | null;
}

interface DecryptedEvidence {
  index: number;
  plaintext: string | null;
  error: string | null;
  loading: boolean;
}

// ─── Component ───

export function EvidenceDecryptor({ evidenceItems, jobKeyHex }: EvidenceDecryptorProps) {
  const [decryptedMap, setDecryptedMap] = useState<Record<number, DecryptedEvidence>>({});

  const decryptEvidence = useCallback(
    async (index: number, cid: string) => {
      if (!jobKeyHex) return;

      setDecryptedMap((prev) => ({
        ...prev,
        [index]: { index, plaintext: null, error: null, loading: true },
      }));

      try {
        const raw = await retrieveFromIPFS(cid);

        let plaintext: string;
        try {
          // Try JSON parse first (might be Pinata-wrapped JSON, or legacy encrypted payload)
          const parsed = JSON.parse(raw);

          // Check if it's a Pinata-wrapped JSON (pinataContent exists)
          if (parsed.pinataContent) {
            // Evidence was uploaded as JSON via uploadJSON — not encrypted
            plaintext = JSON.stringify(parsed.pinataContent, null, 2);
          } else if (parsed.version && parsed.encrypted) {
            // New envelope format: { version, salt, encrypted (hex) }
            const { hexToBuffer } = await import("../../crypto/jobKey");
            const encrypted = hexToBuffer(parsed.encrypted);
            plaintext = await decrypt(encrypted, jobKeyHex);
          } else if (parsed.iv && parsed.ciphertext) {
            // Legacy encrypted format
            plaintext = await decrypt(parsed, jobKeyHex);
          } else {
            // Plain JSON content
            plaintext = JSON.stringify(parsed, null, 2);
          }
        } catch {
          // Not JSON — try as raw binary encrypted data
          try {
            const binaryData = await retrieveBinaryFromIPFS(cid);
            plaintext = await decrypt(binaryData, jobKeyHex);
          } catch {
            // Final fallback: show raw text
            plaintext = raw;
          }
        }

        setDecryptedMap((prev) => ({
          ...prev,
          [index]: { index, plaintext, error: null, loading: false },
        }));
      } catch (err) {
        setDecryptedMap((prev) => ({
          ...prev,
          [index]: {
            index,
            plaintext: null,
            error: "Failed to fetch or decrypt evidence",
            loading: false,
          },
        }));
      }
    },
    [jobKeyHex]
  );

  if (evidenceItems.length === 0) {
    return (
      <div className="text-center py-6 text-gray-400 text-sm">
        No evidence submitted yet.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
        <FileText className="h-4 w-4" />
        Evidence ({evidenceItems.length})
      </h4>

      {!jobKeyHex && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 flex items-center gap-2 text-sm text-yellow-800">
          <Lock className="h-4 w-4 flex-shrink-0" />
          Decrypt the job key first to view evidence content.
        </div>
      )}

      <div className="space-y-2">
        {evidenceItems.map((ev, idx) => {
          const decrypted = decryptedMap[idx];

          return (
            <div
              key={idx}
              className="rounded-lg border border-gray-200 bg-white overflow-hidden"
            >
              {/* Header */}
              <div className="px-4 py-3 bg-gray-50 flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm">
                  <User className="h-3.5 w-3.5 text-gray-400" />
                  <span className="font-medium text-gray-700">
                    {ev.isClient ? "Client" : "Freelancer"}
                  </span>
                  <span className="text-gray-400 font-mono text-xs">
                    ({truncateAddress(ev.submitter)})
                  </span>
                </div>
                <div className="flex items-center gap-1 text-xs text-gray-400">
                  <Clock className="h-3 w-3" />
                  {formatDateTime(ev.submittedAt)}
                </div>
              </div>

              {/* Content */}
              <div className="p-4">
                <p className="text-xs text-gray-400 font-mono break-all mb-2">
                  CID: {ev.evidenceCID}
                </p>

                {decrypted?.loading && (
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Fetching and decrypting...
                  </div>
                )}

                {decrypted?.error && (
                  <div className="flex items-center gap-2 text-sm text-red-600">
                    <AlertTriangle className="h-4 w-4" />
                    {decrypted.error}
                  </div>
                )}

                {decrypted?.plaintext && (
                  <div className="mt-2">
                    <div className="flex items-center gap-1 text-xs text-green-600 mb-1">
                      <Unlock className="h-3 w-3" />
                      Decrypted
                    </div>
                    <pre className="max-h-48 overflow-auto rounded bg-gray-50 p-3 text-xs text-gray-700 border whitespace-pre-wrap">
                      {decrypted.plaintext}
                    </pre>
                  </div>
                )}

                {!decrypted && jobKeyHex && (
                  <button
                    onClick={() => decryptEvidence(idx, ev.evidenceCID)}
                    className="btn-secondary text-xs py-1.5 px-3"
                  >
                    <Unlock className="h-3 w-3 mr-1" />
                    Decrypt & View
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
