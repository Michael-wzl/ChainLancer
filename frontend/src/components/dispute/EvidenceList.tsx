import React, { useState, useCallback } from "react";
import { FileText, Clock, User, Unlock, Loader2, AlertTriangle, Lock } from "lucide-react";
import { retrieveFromIPFS, retrieveBinaryFromIPFS } from "../../ipfs/gateway";
import { decrypt } from "../../crypto/aes";
import { formatDateTime } from "../../utils/format";

interface EvidenceItem {
  submitter: string;
  ipfsCid: string;
  timestamp: number;
  isClient: boolean;
}

interface DecryptedEvidence {
  plaintext: string | null;
  error: string | null;
  loading: boolean;
}

interface EvidenceListProps {
  evidences: EvidenceItem[];
  currentUser?: string;
  /** Only client, freelancer and assigned judge may view evidence content */
  isAuthorized?: boolean;
  /** Hex-encoded job key for decrypting evidence */
  jobKeyHex?: string | null;
}

export function EvidenceList({ evidences, currentUser, isAuthorized = false, jobKeyHex }: EvidenceListProps) {
  const [decryptedMap, setDecryptedMap] = useState<Record<number, DecryptedEvidence>>({});

  const decryptEvidence = useCallback(
    async (index: number, cid: string) => {
      if (!jobKeyHex) return;

      setDecryptedMap((prev) => ({
        ...prev,
        [index]: { plaintext: null, error: null, loading: true },
      }));

      try {
        const raw = await retrieveFromIPFS(cid);

        let plaintext: string;
        try {
          // Try JSON parse first (might be Pinata-wrapped JSON, or legacy encrypted payload)
          const parsed = JSON.parse(raw);

          if (parsed.pinataContent) {
            // Evidence was uploaded as JSON via uploadJSON — not encrypted
            plaintext = JSON.stringify(parsed.pinataContent, null, 2);
          } else if (parsed.version && parsed.encrypted) {
            // Envelope format: { version, salt, encrypted (hex) }
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

        // Try to pretty-print the decrypted content if it's JSON
        try {
          const obj = JSON.parse(plaintext);
          if (obj.content) {
            // Show just the evidence content field for readability
            plaintext = obj.content;
          }
        } catch {
          // Not JSON, keep as-is
        }

        setDecryptedMap((prev) => ({
          ...prev,
          [index]: { plaintext, error: null, loading: false },
        }));
      } catch (err) {
        setDecryptedMap((prev) => ({
          ...prev,
          [index]: {
            plaintext: null,
            error: "Failed to fetch or decrypt evidence",
            loading: false,
          },
        }));
      }
    },
    [jobKeyHex]
  );

  if (evidences.length === 0) {
    return (
      <div className="text-center py-8 text-gray-400 text-sm">
        No evidence submitted yet.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
        <FileText className="h-4 w-4" />
        Evidence ({evidences.length})
      </h4>

      {isAuthorized && !jobKeyHex && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 flex items-center gap-2 text-sm text-yellow-800">
          <Lock className="h-4 w-4 flex-shrink-0" />
          No decryption key available. Evidence may appear encrypted.
        </div>
      )}

      <div className="space-y-2">
        {evidences.map((ev, idx) => {
          const isSelf =
            currentUser?.toLowerCase() === ev.submitter.toLowerCase();
          const decrypted = decryptedMap[idx];

          return (
            <div
              key={idx}
              className={`rounded-lg border p-3 ${
                isSelf ? "bg-blue-50 border-blue-200" : "bg-gray-50 border-gray-200"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm">
                  <User className="h-3.5 w-3.5 text-gray-400" />
                  <span className="font-medium text-gray-700">
                    {ev.isClient ? "Client" : "Freelancer"}
                    {isSelf && (
                      <span className="ml-1 text-xs text-blue-600">(you)</span>
                    )}
                  </span>
                </div>
                <div className="flex items-center gap-1 text-xs text-gray-400">
                  <Clock className="h-3 w-3" />
                  {formatDateTime(ev.timestamp)}
                </div>
              </div>

              <div className="mt-2">
                {isAuthorized ? (
                  <>
                    <code className="text-xs text-gray-500 truncate block mb-2">
                      {ev.ipfsCid}
                    </code>

                    {decrypted?.loading && (
                      <div className="flex items-center gap-2 text-sm text-gray-500">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Fetching and decrypting…
                      </div>
                    )}

                    {decrypted?.error && (
                      <div className="flex items-center gap-2 text-sm text-red-600">
                        <AlertTriangle className="h-4 w-4" />
                        {decrypted.error}
                      </div>
                    )}

                    {decrypted?.plaintext && (
                      <div className="mt-1">
                        <div className="flex items-center gap-1 text-xs text-green-600 mb-1">
                          <Unlock className="h-3 w-3" />
                          Decrypted
                        </div>
                        <pre className="max-h-48 overflow-auto rounded bg-white p-3 text-xs text-gray-700 border whitespace-pre-wrap">
                          {decrypted.plaintext}
                        </pre>
                      </div>
                    )}

                    {!decrypted && jobKeyHex && (
                      <button
                        onClick={() => decryptEvidence(idx, ev.ipfsCid)}
                        className="btn-secondary text-xs py-1.5 px-3"
                      >
                        <Unlock className="h-3 w-3 mr-1" />
                        Decrypt & View
                      </button>
                    )}
                  </>
                ) : (
                  <span className="text-xs text-gray-400 italic">
                    Evidence content restricted to involved parties and assigned judge.
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
