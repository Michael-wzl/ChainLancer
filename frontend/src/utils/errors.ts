/**
 * User-friendly error message mapping for contract reverts.
 */

const ERROR_MESSAGES: Record<string, string> = {
  "Only client": "This action can only be performed by the job client.",
  "Only freelancer": "This action can only be performed by the assigned freelancer.",
  "Not selected freelancer": "You are not the selected freelancer for this job.",
  "Not a party": "You are not a party to this job.",
  "Job not accepting applications": "This job is not currently accepting applications.",
  "Client cannot apply": "The job client cannot apply to their own job.",
  "Already applied": "You have already applied to this job.",
  "Not in applications": "This job is not in the applications phase.",
  "Freelancer has not applied": "The selected freelancer has not applied to this job.",
  "Stake window expired": "The stake window has expired. The offer is no longer valid.",
  "Job not active": "This job is not currently active.",
  "Invalid milestone index": "Invalid milestone index.",
  "Milestone not pending": "This milestone is not in pending status.",
  "Milestone deadline passed": "The milestone deadline has passed.",
  "Not in review": "This milestone is not currently in review.",
  "Review timeout not expired": "The review timeout has not expired yet.",
  "Not pending": "This milestone is not pending.",
  "Deadline not passed": "The milestone deadline has not passed yet.",
  "Cannot cancel in current state": "The job cannot be cancelled in its current state.",
  "Milestone in review or disputed": "Cannot cancel while a milestone is in review or disputed.",
  "Cancellation already pending": "A cancellation request is already pending.",
  "No pending cancellation": "There is no pending cancellation request.",
  "Only counterparty": "Only the counterparty can accept the cancellation.",
  "Not expired yet": "The acceptance timeout has not expired yet.",
  "Nothing to withdraw": "You have no funds available to withdraw.",
  "No milestones": "At least one milestone is required.",
  "Array length mismatch": "Milestone values and deadlines arrays must have the same length.",
  "Too many milestones": "Maximum 20 milestones allowed.",
  "Invalid review timeout": "Invalid review timeout value.",
  "Empty agreement hash": "Agreement hash cannot be empty.",
  "Zero total value": "Total job value must be greater than zero.",
  "Milestone below minimum": "Each milestone must be at least 10% of the total job value.",
  "Deadline in the past": "Milestone deadline cannot be in the past.",
  "Offer not expired": "The offer has not expired yet.",
  "No previous selection": "No previous freelancer was selected.",
  "Previous selection not expired": "The previous freelancer selection has not expired.",
  "Not in evidence phase": "The dispute is not in the evidence submission phase.",
  "Evidence window closed": "The evidence submission window has closed.",
  "Not a party to this dispute": "You are not a party to this dispute.",
  // ERC20 errors
  "ERC20: insufficient allowance": "Insufficient USDC allowance. Please approve the contract first.",
  "ERC20: transfer amount exceeds balance": "Insufficient USDC balance.",
};

/**
 * Parse a contract revert error into a user-friendly message.
 */
export function parseContractError(error: unknown): string {
  const errorStr = String(error);

  // Check for known revert reasons
  for (const [key, message] of Object.entries(ERROR_MESSAGES)) {
    if (errorStr.includes(key)) {
      return message;
    }
  }

  // Check for user rejection
  if (
    errorStr.includes("user rejected") ||
    errorStr.includes("User denied") ||
    errorStr.includes("ACTION_REJECTED")
  ) {
    return "Transaction was rejected by user.";
  }

  // Check for insufficient funds
  if (errorStr.includes("insufficient funds")) {
    return "Insufficient ETH for gas fees.";
  }

  // Fallback
  return "Transaction failed. Please try again.";
}
