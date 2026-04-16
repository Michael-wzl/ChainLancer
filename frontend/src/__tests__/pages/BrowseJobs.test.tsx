import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";

const mockUseJobList = vi.fn();
const mockUseJobEvents = vi.fn();

vi.mock("../../hooks/useJobList", () => ({
  useJobList: () => mockUseJobList(),
}));

vi.mock("../../hooks/useJobEvents", () => ({
  useJobEvents: (...args: unknown[]) => mockUseJobEvents(...args),
}));

vi.mock("../../components/job/JobCard", () => ({
  JobCard: ({ job }: any) => React.createElement("div", null, `Job ${job.jobId}`),
}));

import BrowseJobs from "../../pages/BrowseJobs";
import { JobState } from "../../config/constants";

describe("pages/BrowseJobs", () => {
  const refresh = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseJobEvents.mockImplementation(() => undefined);
    mockUseJobList.mockReturnValue({
      jobs: [
        {
          jobId: 7,
          client: "0xclient",
          freelancer: "0xfreelancer",
          totalValue: 1_000_000n,
          freelancerDeposit: 50_000n,
          behaviorBond: 50_000n,
          agreementHash: "0xagreement",
          reviewTimeout: 604800,
          createdAt: 1000,
          selectedAt: 1100,
          activatedAt: 1200,
          milestoneCount: 1,
          milestonesCompleted: 1,
          state: JobState.Completed,
          cancellationRequested: false,
          cancellationRequestor: null,
        },
      ],
      loading: false,
      totalJobs: 1,
      hasPartialFailures: true,
      failedJobIds: [6, 7],
      refresh,
    });
  });

  it("shows a warning banner and allows manual retry", () => {
    render(React.createElement(BrowseJobs));

    expect(screen.getByText(/Some jobs may not have loaded completely/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Retry$/i }));

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes when focus or visibility returns", () => {
    render(React.createElement(BrowseJobs));

    window.dispatchEvent(new Event("focus"));
    expect(refresh).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
