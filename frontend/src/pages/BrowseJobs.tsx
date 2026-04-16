import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, Filter, RefreshCw, AlertTriangle } from "lucide-react";
import { useJobList } from "../hooks/useJobList";
import { JobCard } from "../components/job/JobCard";
import { JobState, JOB_STATE_LABELS } from "../config/constants";
import { useJobEvents } from "../hooks/useJobEvents";

export default function BrowseJobs() {
  const { jobs, loading, refresh, hasPartialFailures, failedJobIds } = useJobList();
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<JobState | "all">("all");
  const refreshTimeoutRef = useRef<number | null>(null);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimeoutRef.current !== null) {
      window.clearTimeout(refreshTimeoutRef.current);
    }

    refreshTimeoutRef.current = window.setTimeout(() => {
      void refresh();
      refreshTimeoutRef.current = null;
    }, 250);
  }, [refresh]);

  useEffect(() => {
    const handleFocus = () => {
      void refresh();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refresh]);

  useEffect(() => {
    return () => {
      if (refreshTimeoutRef.current !== null) {
        window.clearTimeout(refreshTimeoutRef.current);
      }
    };
  }, []);

  useJobEvents(
    useMemo(
      () => ({
        onJobPosted: () => scheduleRefresh(),
        onJobCompleted: () => scheduleRefresh(),
        onJobCancelled: () => scheduleRefresh(),
      }),
      [scheduleRefresh],
    ),
  );

  const filtered = useMemo(() => {
    let list = jobs;

    if (stateFilter !== "all") {
      list = list.filter((j) => j.state === stateFilter);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (j) =>
          j.client.toLowerCase().includes(q) ||
          j.freelancer.toLowerCase().includes(q) ||
          String(j.jobId).includes(q)
      );
    }

    return list;
  }, [jobs, search, stateFilter]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Browse Jobs</h1>
        <p className="text-sm text-gray-500">
          Explore available freelance opportunities
        </p>
      </div>

      {hasPartialFailures && (
        <div className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
            <p>
              Some jobs may not have loaded completely.
              {failedJobIds.length > 0 ? ` Retry recommended. Failed job IDs: ${failedJobIds.join(", ")}.` : " Retry recommended."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-amber-300 bg-white px-3 py-2 font-medium text-amber-700 transition-colors hover:bg-amber-100"
          >
            <RefreshCw className="h-4 w-4" />
            Retry
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search by job ID or address..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input pl-10"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-gray-400" />
          <select
            value={stateFilter}
            onChange={(e) =>
              setStateFilter(
                e.target.value === "all"
                  ? "all"
                  : (Number(e.target.value) as JobState)
              )
            }
            className="input w-auto"
          >
            <option value="all">All States</option>
            {Object.entries(JOB_STATE_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void refresh()}
            className="inline-flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:border-brand-200 hover:text-brand-600"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Results */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading jobs...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          No jobs found matching your criteria.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((job) => (
            <JobCard key={job.jobId} job={job} />
          ))}
        </div>
      )}

      <div className="text-center text-xs text-gray-400">
        Showing {filtered.length} of {jobs.length} jobs
      </div>
    </div>
  );
}
