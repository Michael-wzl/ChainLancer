import { useState, useCallback } from "react";
import { ethers } from "ethers";
import { useContracts } from "../contexts/ContractContext";
import { useWallet } from "../contexts/WalletContext";
import { parseContractError } from "../utils/errors";
import toast from "react-hot-toast";

/**
 * Hooks for all JobEscrow write operations.
 */
export function useJobEscrow() {
  const { contracts } = useContracts();
  const { address } = useWallet();
  const [isLoading, setIsLoading] = useState(false);

  const execute = useCallback(
    async (fn: () => Promise<ethers.ContractTransactionResponse>, successMsg: string) => {
      setIsLoading(true);
      try {
        const tx = await fn();
        toast.loading("Transaction pending...", { id: "tx" });
        const receipt = await tx.wait();
        toast.success(successMsg, { id: "tx" });
        return { tx, receipt };
      } catch (err) {
        const msg = parseContractError(err);
        toast.error(msg, { id: "tx" });
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const postJob = useCallback(
    async (
      agreementHash: string,
      milestoneValues: bigint[],
      milestoneDeadlines: number[],
      reviewTimeout: number,
      agreementCID: string
    ) => {
      if (!contracts.jobEscrow) throw new Error("Contract not ready");
      return execute(
        () =>
          contracts.jobEscrow!.postJob(
            agreementHash,
            milestoneValues,
            milestoneDeadlines,
            reviewTimeout,
            agreementCID
          ),
        "Job posted successfully!"
      );
    },
    [contracts.jobEscrow, execute]
  );

  const applyForJob = useCallback(
    async (jobId: number, proposalHash: string) => {
      if (!contracts.jobEscrow) throw new Error("Contract not ready");
      return execute(
        () => contracts.jobEscrow!.applyForJob(jobId, proposalHash),
        "Application submitted!"
      );
    },
    [contracts.jobEscrow, execute]
  );

  const selectFreelancer = useCallback(
    async (jobId: number, freelancerAddr: string, encryptedKey: Uint8Array) => {
      if (!contracts.jobEscrow) throw new Error("Contract not ready");
      return execute(
        () =>
          contracts.jobEscrow!.selectFreelancer(jobId, freelancerAddr, encryptedKey),
        "Freelancer selected!"
      );
    },
    [contracts.jobEscrow, execute]
  );

  const confirmAndStake = useCallback(
    async (jobId: number) => {
      if (!contracts.jobEscrow) throw new Error("Contract not ready");
      return execute(
        () => contracts.jobEscrow!.confirmAndStake(jobId),
        "Deposit staked — job is now active!"
      );
    },
    [contracts.jobEscrow, execute]
  );

  const rejectOffer = useCallback(
    async (jobId: number) => {
      if (!contracts.jobEscrow) throw new Error("Contract not ready");
      return execute(
        () => contracts.jobEscrow!.rejectOffer(jobId),
        "Offer rejected."
      );
    },
    [contracts.jobEscrow, execute]
  );

  const submitMilestone = useCallback(
    async (
      jobId: number,
      milestoneIdx: number,
      deliverableHash: string,
      deliverableCID: string
    ) => {
      if (!contracts.jobEscrow) throw new Error("Contract not ready");
      return execute(
        () =>
          contracts.jobEscrow!.submitMilestone(
            jobId,
            milestoneIdx,
            deliverableHash,
            deliverableCID
          ),
        "Milestone submitted for review!"
      );
    },
    [contracts.jobEscrow, execute]
  );

  const approveMilestone = useCallback(
    async (jobId: number, milestoneIdx: number) => {
      if (!contracts.jobEscrow) throw new Error("Contract not ready");
      return execute(
        () => contracts.jobEscrow!.approveMilestone(jobId, milestoneIdx),
        "Milestone approved — funds released!"
      );
    },
    [contracts.jobEscrow, execute]
  );

  const triggerAutoApprove = useCallback(
    async (jobId: number, milestoneIdx: number) => {
      if (!contracts.jobEscrow) throw new Error("Contract not ready");
      return execute(
        () => contracts.jobEscrow!.triggerAutoApprove(jobId, milestoneIdx),
        "Auto-approval triggered!"
      );
    },
    [contracts.jobEscrow, execute]
  );

  const raiseDispute = useCallback(
    async (jobId: number, milestoneIdx: number) => {
      if (!contracts.jobEscrow) throw new Error("Contract not ready");
      return execute(
        () => contracts.jobEscrow!.raiseDispute(jobId, milestoneIdx),
        "Dispute raised!"
      );
    },
    [contracts.jobEscrow, execute]
  );

  const cancelJob = useCallback(
    async (jobId: number) => {
      if (!contracts.jobEscrow) throw new Error("Contract not ready");
      return execute(
        () => contracts.jobEscrow!.cancelJob(jobId),
        "Job cancelled — funds returned."
      );
    },
    [contracts.jobEscrow, execute]
  );

  const requestCancellation = useCallback(
    async (jobId: number) => {
      if (!contracts.jobEscrow) throw new Error("Contract not ready");
      return execute(
        () => contracts.jobEscrow!.requestCancellation(jobId),
        "Cancellation requested."
      );
    },
    [contracts.jobEscrow, execute]
  );

  const acceptCancellation = useCallback(
    async (jobId: number) => {
      if (!contracts.jobEscrow) throw new Error("Contract not ready");
      return execute(
        () => contracts.jobEscrow!.acceptCancellation(jobId),
        "Cancellation accepted — job cancelled."
      );
    },
    [contracts.jobEscrow, execute]
  );

  const withdraw = useCallback(async () => {
    if (!contracts.jobEscrow) throw new Error("Contract not ready");
    return execute(
      () => contracts.jobEscrow!.withdraw(),
      "Funds withdrawn successfully!"
    );
  }, [contracts.jobEscrow, execute]);

  const claimAbandonment = useCallback(
    async (jobId: number, milestoneIdx: number) => {
      if (!contracts.jobEscrow) throw new Error("Contract not ready");
      return execute(
        () => contracts.jobEscrow!.claimAbandonment(jobId, milestoneIdx),
        "Abandonment claimed."
      );
    },
    [contracts.jobEscrow, execute]
  );

  const withdrawExpiredJob = useCallback(
    async (jobId: number) => {
      if (!contracts.jobEscrow) throw new Error("Contract not ready");
      return execute(
        () => contracts.jobEscrow!.withdrawExpiredJob(jobId),
        "Expired job withdrawn."
      );
    },
    [contracts.jobEscrow, execute]
  );

  const expireOffer = useCallback(
    async (jobId: number) => {
      if (!contracts.jobEscrow) throw new Error("Contract not ready");
      return execute(
        () => contracts.jobEscrow!.expireOffer(jobId),
        "Offer expired."
      );
    },
    [contracts.jobEscrow, execute]
  );

  return {
    isLoading,
    address,
    postJob,
    applyForJob,
    selectFreelancer,
    confirmAndStake,
    rejectOffer,
    submitMilestone,
    approveMilestone,
    triggerAutoApprove,
    raiseDispute,
    cancelJob,
    requestCancellation,
    acceptCancellation,
    withdraw,
    claimAbandonment,
    withdrawExpiredJob,
    expireOffer,
  };
}
