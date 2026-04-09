import React from "react";
import { useParams } from "react-router-dom";
import { User, Briefcase, Star } from "lucide-react";
import { useWallet } from "../contexts/WalletContext";
import { useUserReputation } from "../hooks/useReputation";
import { useJobList } from "../hooks/useJobList";
import { ScoreCard } from "../components/reputation/ScoreCard";
import { JobCard } from "../components/job/JobCard";
import { Tier } from "../config/constants";

export default function Profile() {
  const { address: routeAddress } = useParams<{ address: string }>();
  const { address: walletAddress, isConnected } = useWallet();

  // Use route param address if present, otherwise fall back to connected wallet
  const profileAddress = routeAddress || walletAddress;
  const isOwnProfile = !routeAddress || routeAddress.toLowerCase() === walletAddress?.toLowerCase();

  const {
    freelancerProfile,
    clientProfile,
    clientTier,
    freelancerTier,
    loading: repLoading,
  } = useUserReputation(profileAddress ?? null);
  const { jobs, loading: jobsLoading } = useJobList();

  if (!profileAddress) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <User className="h-16 w-16 text-gray-300 mb-4" />
        <h2 className="text-xl font-semibold text-gray-600">
          {isConnected
            ? "No address specified"
            : "Connect your wallet to view your profile"}
        </h2>
      </div>
    );
  }

  const myClientJobs = jobs.filter(
    (j) => j.client.toLowerCase() === profileAddress.toLowerCase()
  );
  const myFreelancerJobs = jobs.filter(
    (j) => j.freelancer.toLowerCase() === profileAddress.toLowerCase()
  );

  // Compute freelancer success rate (in BPS)
  const freelancerSuccessRate =
    freelancerProfile && freelancerProfile.jobsCompleted > 0
      ? Math.round(
          ((freelancerProfile.jobsCompleted - freelancerProfile.disputesLost) /
            freelancerProfile.jobsCompleted) *
            10000
        )
      : 0;

  // Compute client success rate
  const clientSuccessRate =
    clientProfile && clientProfile.jobsCompleted > 0
      ? Math.round(
          ((clientProfile.jobsCompleted - clientProfile.disputesLost) /
            clientProfile.jobsCompleted) *
            10000
        )
      : 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          {isOwnProfile ? "My Profile" : "User Profile"}
        </h1>
        <p className="text-sm text-gray-500 font-mono">{profileAddress}</p>
      </div>

      {/* Reputation cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Freelancer reputation */}
        <ScoreCard
          address={profileAddress}
          tier={freelancerTier}
          completedJobs={freelancerProfile?.jobsCompleted ?? 0}
          disputesFiled={freelancerProfile?.disputesLost ?? 0}
          disputesLost={freelancerProfile?.disputesLost ?? 0}
          totalScore={Number(freelancerProfile?.reputationScore ?? 0n)}
          successRate={freelancerSuccessRate}
          isFreelancer={true}
        />

        {/* Client reputation */}
        <ScoreCard
          address={profileAddress}
          tier={clientTier}
          completedJobs={clientProfile?.jobsCompleted ?? 0}
          disputesFiled={clientProfile?.disputesLost ?? 0}
          disputesLost={clientProfile?.disputesLost ?? 0}
          totalScore={Number(clientProfile?.reputationScore ?? 0n)}
          successRate={clientSuccessRate}
          isFreelancer={false}
        />
      </div>

      {/* Client stats */}
      {clientProfile && (
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
            <Briefcase className="h-4 w-4" /> Client Activity
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div className="rounded-lg bg-gray-50 p-3">
              <p className="text-xs text-gray-400">Jobs Posted</p>
              <p className="font-semibold text-gray-700">
                {clientProfile.jobsPosted}
              </p>
            </div>
            <div className="rounded-lg bg-gray-50 p-3">
              <p className="text-xs text-gray-400">Cancelled After Selection</p>
              <p className="font-semibold text-gray-700">
                {clientProfile.jobsCancelledAfterSelection}
              </p>
            </div>
            <div className="rounded-lg bg-gray-50 p-3">
              <p className="text-xs text-gray-400">Auto-Approves</p>
              <p className="font-semibold text-yellow-600">
                {clientProfile.autoApproveCount}
              </p>
            </div>
            <div className="rounded-lg bg-gray-50 p-3">
              <p className="text-xs text-gray-400">Disputes Lost</p>
              <p className="font-semibold text-red-600">
                {clientProfile.disputesLost}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* My jobs */}
      {myClientJobs.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-1.5">
            <Briefcase className="h-5 w-5" /> Jobs as Client
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {myClientJobs.map((job) => (
              <JobCard key={job.jobId} job={job} />
            ))}
          </div>
        </section>
      )}

      {myFreelancerJobs.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-1.5">
            <Star className="h-5 w-5" /> Jobs as Freelancer
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {myFreelancerJobs.map((job) => (
              <JobCard key={job.jobId} job={job} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
