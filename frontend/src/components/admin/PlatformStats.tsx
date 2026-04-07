import React, { useState, useEffect, useCallback } from "react";
import {
  Briefcase,
  CheckCircle,
  Clock,
  DollarSign,
  Gavel,
  Loader2,
  RefreshCw,
  XCircle,
  BarChart3,
} from "lucide-react";
import { useAdmin, type PlatformStats as Stats } from "../../hooks/useAdmin";
import { formatUSDC } from "../../utils/format";

// ─── Component ───

export function PlatformStats() {
  const { fetchPlatformStats } = useAdmin();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await fetchPlatformStats();
      setStats(s);
    } catch (err) {
      console.error("Failed to fetch stats:", err);
    } finally {
      setLoading(false);
    }
  }, [fetchPlatformStats]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading || !stats) {
    return (
      <div className="text-center py-12 text-gray-400">
        <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
        Loading platform statistics...
      </div>
    );
  }

  const cards = [
    {
      label: "Total Jobs",
      value: stats.totalJobs.toString(),
      icon: Briefcase,
      color: "text-blue-600",
      bg: "bg-blue-50",
    },
    {
      label: "Open Jobs",
      value: stats.openJobs.toString(),
      icon: Clock,
      color: "text-yellow-600",
      bg: "bg-yellow-50",
    },
    {
      label: "Active Jobs",
      value: stats.activeJobs.toString(),
      icon: BarChart3,
      color: "text-green-600",
      bg: "bg-green-50",
    },
    {
      label: "Completed Jobs",
      value: stats.completedJobs.toString(),
      icon: CheckCircle,
      color: "text-emerald-600",
      bg: "bg-emerald-50",
    },
    {
      label: "Total Escrowed",
      value: formatUSDC(stats.totalEscrowedValue),
      icon: DollarSign,
      color: "text-green-600",
      bg: "bg-green-50",
    },
    {
      label: "Total Disputes",
      value: stats.totalDisputes.toString(),
      icon: Gavel,
      color: "text-indigo-600",
      bg: "bg-indigo-50",
    },
    {
      label: "Active Disputes",
      value: stats.activeDisputes.toString(),
      icon: Clock,
      color: "text-orange-600",
      bg: "bg-orange-50",
    },
    {
      label: "Resolved Disputes",
      value: stats.resolvedDisputes.toString(),
      icon: CheckCircle,
      color: "text-teal-600",
      bg: "bg-teal-50",
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-indigo-500" />
          Platform Statistics
        </h3>
        <button
          onClick={load}
          className="text-gray-400 hover:text-gray-600"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="card flex items-start gap-3">
            <div className={`p-2 rounded-lg ${c.bg}`}>
              <c.icon className={`h-5 w-5 ${c.color}`} />
            </div>
            <div>
              <p className="text-xs text-gray-500">{c.label}</p>
              <p className="text-lg font-bold text-gray-900">{c.value}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
