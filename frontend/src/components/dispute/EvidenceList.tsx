import React from "react";
import { FileText, ExternalLink, Clock, User } from "lucide-react";
import { getGatewayUrl } from "../../ipfs/gateway";
import { formatDateTime } from "../../utils/format";

interface EvidenceItem {
  submitter: string;
  ipfsCid: string;
  timestamp: number;
  isClient: boolean;
}

interface EvidenceListProps {
  evidences: EvidenceItem[];
  currentUser?: string;
  /** Only client, freelancer and assigned judge may view evidence content */
  isAuthorized?: boolean;
}

export function EvidenceList({ evidences, currentUser, isAuthorized = false }: EvidenceListProps) {
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

      <div className="space-y-2">
        {evidences.map((ev, idx) => {
          const isSelf =
            currentUser?.toLowerCase() === ev.submitter.toLowerCase();
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

              <div className="mt-2 flex items-center gap-2">
                {isAuthorized ? (
                  <>
                    <code className="text-xs text-gray-500 truncate flex-1">
                      {ev.ipfsCid}
                    </code>
                    <a
                      href={getGatewayUrl(ev.ipfsCid)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-brand-600 hover:text-brand-700 flex items-center gap-1 text-xs"
                    >
                      View <ExternalLink className="h-3 w-3" />
                    </a>
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
