import { useEffect, useCallback } from "react";
import { useContracts } from "../contexts/ContractContext";

/**
 * Hook for subscribing to real-time contract events.
 */
export function useJobEvents(callbacks: {
  onJobPosted?: (jobId: number, client: string, totalValue: bigint) => void;
  onApplicationSubmitted?: (jobId: number, freelancer: string) => void;
  onFreelancerSelected?: (jobId: number, freelancer: string) => void;
  onJobActivated?: (jobId: number, freelancer: string) => void;
  onMilestoneSubmitted?: (jobId: number, milestoneIdx: number) => void;
  onMilestoneApproved?: (jobId: number, milestoneIdx: number) => void;
  onMilestoneAutoApproved?: (jobId: number, milestoneIdx: number) => void;
  onDisputeRaised?: (jobId: number, milestoneIdx: number, disputeId: number) => void;
  onJobCompleted?: (jobId: number) => void;
  onJobCancelled?: (jobId: number) => void;
  onFundsWithdrawn?: (user: string, amount: bigint) => void;
}) {
  const { readContracts } = useContracts();

  useEffect(() => {
    const contract = readContracts.jobEscrow;
    if (!contract) return;

    const listeners: Array<{ event: string; handler: (...args: unknown[]) => void }> = [];

    const addListener = (event: string, handler: (...args: unknown[]) => void) => {
      contract.on(event, handler);
      listeners.push({ event, handler });
    };

    if (callbacks.onJobPosted) {
      addListener("JobPosted", (jobId, client, totalValue) => {
        callbacks.onJobPosted!(Number(jobId), client as string, totalValue as bigint);
      });
    }

    if (callbacks.onApplicationSubmitted) {
      addListener("ApplicationSubmitted", (jobId, freelancer) => {
        callbacks.onApplicationSubmitted!(Number(jobId), freelancer as string);
      });
    }

    if (callbacks.onFreelancerSelected) {
      addListener("FreelancerSelected", (jobId, freelancer) => {
        callbacks.onFreelancerSelected!(Number(jobId), freelancer as string);
      });
    }

    if (callbacks.onJobActivated) {
      addListener("JobActivated", (jobId, freelancer) => {
        callbacks.onJobActivated!(Number(jobId), freelancer as string);
      });
    }

    if (callbacks.onMilestoneSubmitted) {
      addListener("MilestoneSubmitted", (jobId, milestoneIdx) => {
        callbacks.onMilestoneSubmitted!(Number(jobId), Number(milestoneIdx));
      });
    }

    if (callbacks.onMilestoneApproved) {
      addListener("MilestoneApproved", (jobId, milestoneIdx) => {
        callbacks.onMilestoneApproved!(Number(jobId), Number(milestoneIdx));
      });
    }

    if (callbacks.onMilestoneAutoApproved) {
      addListener("MilestoneAutoApproved", (jobId, milestoneIdx) => {
        callbacks.onMilestoneAutoApproved!(Number(jobId), Number(milestoneIdx));
      });
    }

    if (callbacks.onDisputeRaised) {
      addListener("DisputeRaised", (jobId, milestoneIdx, disputeId) => {
        callbacks.onDisputeRaised!(Number(jobId), Number(milestoneIdx), Number(disputeId));
      });
    }

    if (callbacks.onJobCompleted) {
      addListener("JobCompleted", (jobId) => {
        callbacks.onJobCompleted!(Number(jobId));
      });
    }

    if (callbacks.onJobCancelled) {
      addListener("JobCancelled", (jobId) => {
        callbacks.onJobCancelled!(Number(jobId));
      });
    }

    if (callbacks.onFundsWithdrawn) {
      addListener("FundsWithdrawn", (user, amount) => {
        callbacks.onFundsWithdrawn!(user as string, amount as bigint);
      });
    }

    return () => {
      listeners.forEach(({ event, handler }) => {
        contract.off(event, handler);
      });
    };
  }, [readContracts.jobEscrow, callbacks]);
}
