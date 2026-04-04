import React from "react";
import { Link } from "react-router-dom";
import {
  Briefcase,
  PlusCircle,
  DollarSign,
  AlertTriangle,
  Award,
} from "lucide-react";
import { useWallet } from "../contexts/WalletContext";
import { useJobList } from "../hooks/useJobList";
import { useUserReputation } from "../hooks/useReputation";
import { JobCard } from "../components/job/JobCard";
import { ReputationBadge } from "../components/reputation/ReputationBadge";
import { FaucetPanel } from "../components/testnet/FaucetPanel";
import { JobState } from "../config/constants";
import { formatUSDC } from "../utils/format";

type DashboardProps = {
  appName: string;
};

export default function Dashboard({ appName }: DashboardProps) {
  const { address, isConnected } = useWallet();
  const { jobs, loading } = useJobList();
  const {
    freelancerProfile,
    clientProfile,
    clientTier,
    loading: repLoading,
  } = useUserReputation(address);

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Briefcase className="h-16 w-16 text-gray-300 mb-4" />
        <h2 className="text-2xl font-bold text-gray-700 mb-2">
          Welcome to {appName} Dashboard
        </h2>
        <p className="text-gray-500 max-w-md mb-6">
          Decentralized freelance escrow platform. Connect your wallet to get
          started.
        </p>
      </div>
    );
  }

  const myClientJobs = jobs.filter(
    (j) => j.client.toLowerCase() === address?.toLowerCase(),
  );
  const myFreelancerJobs = jobs.filter(
    (j) => j.freelancer.toLowerCase() === address?.toLowerCase(),
  );
  const activeJobs = [...myClientJobs, ...myFreelancerJobs].filter(
    (j) => j.state === JobState.Active,
  );
  const openJobs = myClientJobs.filter(
    (j) => j.state === JobState.Open || j.state === JobState.Applications,
  );

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500">
            Overview of your {appName} activity
          </p>
        </div>
        <Link to="/post-job" className="btn-primary flex items-center gap-2">
          <PlusCircle className="h-4 w-4" /> Post Job
        </Link>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<Briefcase className="h-5 w-5 text-brand-500" />}
          label="Active Jobs"
          value={activeJobs.length.toString()}
        />
        <StatCard
          icon={<DollarSign className="h-5 w-5 text-green-500" />}
          label="Total Value Completed"
          value={formatUSDC(
            (freelancerProfile?.totalValueCompleted ?? 0n) +
              (clientProfile?.totalValueCompleted ?? 0n),
          )}
        />
        <StatCard
          icon={<AlertTriangle className="h-5 w-5 text-yellow-500" />}
          label="Disputes Lost"
          value={String(
            (freelancerProfile?.disputesLost ?? 0) +
              (clientProfile?.disputesLost ?? 0),
          )}
        />
        <StatCard
          icon={<Award className="h-5 w-5 text-purple-500" />}
          label="Client Tier"
          value={<ReputationBadge tier={clientTier} size="sm" />}
        />
      </div>

      {/* Active jobs */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-gray-800">Active Jobs</h2>
          <Link to="/browse" className="text-sm text-brand-600 hover:underline">
            Browse all →
          </Link>
        </div>
        {loading ? (
          <p className="text-sm text-gray-400">Loading...</p>
        ) : activeJobs.length === 0 ? (
          <div className="card text-center py-8 text-gray-400 text-sm">
            No active jobs.{" "}
            <Link to="/browse" className="text-brand-600 underline">
              Browse jobs
            </Link>{" "}
            or{" "}
            <Link to="/post-job" className="text-brand-600 underline">
              post a new one
            </Link>
            .
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {activeJobs.slice(0, 6).map((job) => (
              <JobCard key={job.jobId} job={job} />
            ))}
          </div>
        )}
      </section>

      {/* Open / hiring jobs */}
      {openJobs.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-gray-800 mb-3">
            Your Open Listings
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {openJobs.map((job) => (
              <JobCard key={job.jobId} job={job} />
            ))}
          </div>
        </section>
      )}

      {/* Freelancer jobs */}
      {myFreelancerJobs.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-gray-800 mb-3">
            Jobs as Freelancer
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {myFreelancerJobs.slice(0, 6).map((job) => (
              <JobCard key={job.jobId} job={job} />
            ))}
          </div>
        </section>
      )}

      {/* Testnet faucet */}
      <section>
        <FaucetPanel />
      </section>
    </div>
  );
}

// ─── small stat card ───

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="card flex items-center gap-4">
      <div className="rounded-lg bg-gray-50 p-2.5">{icon}</div>
      <div>
        <p className="text-xs text-gray-400">{label}</p>
        <div className="text-lg font-semibold text-gray-800">{value}</div>
      </div>
    </div>
  );
}
