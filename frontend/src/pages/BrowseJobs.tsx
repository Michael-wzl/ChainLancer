import React, { useMemo, useState } from "react";
import { Search, Filter } from "lucide-react";
import { useJobList } from "../hooks/useJobList";
import { JobCard } from "../components/job/JobCard";
import { JobState, JOB_STATE_LABELS } from "../config/constants";

export default function BrowseJobs() {
  const { jobs, loading } = useJobList();
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<JobState | "all">("all");

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

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
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
