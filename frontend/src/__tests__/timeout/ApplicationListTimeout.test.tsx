/**
 * Tests for ApplicationList — Offer expiry (T_STAKE timeout) logic
 *
 * Bug-hunting targets:
 * - ApplicationList used Date.now() instead of blockchain time (the original bug)
 * - nowTimestamp prop fallback: if not provided, falls back to Date.now() silently
 * - Offer expiry boundary: `now > selectedAt + tStake` (strict greater-than)
 * - Countdown text showing negative remaining time
 * - hasSelection check: what if freelancer is set but selectedAt is 0?
 * - Reselect/Select button visibility with expired offers
 * - Multiple applications with one selected — button states
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import React from "react";
import { ApplicationList } from "../../components/job/ApplicationList";
import type { ApplicationData } from "../../hooks/useJobList";

// Mock dependencies that ApplicationList imports
vi.mock("../../hooks/useReputation", () => ({
  useReputation: () => ({
    getFreelancerProfile: vi.fn().mockResolvedValue(null),
    getFreelancerTier: vi.fn(),
    getClientTier: vi.fn(),
  }),
}));

vi.mock("../../contexts/ContractContext", () => ({
  useContracts: () => ({
    readContracts: {
      reputation: {
        getFreelancerTier: vi.fn().mockResolvedValue(0),
      },
    },
  }),
}));

vi.mock("../../ipfs/gateway", () => ({
  retrieveFromIPFS: vi.fn(),
}));

vi.mock("../../crypto/ecies", () => ({
  eciesDecrypt: vi.fn(),
}));

vi.mock("../../crypto/aes", () => ({
  decrypt: vi.fn(),
}));

vi.mock("../../crypto/jobKey", () => ({
  hexToBuffer: vi.fn(),
  bufferToHex: vi.fn(),
}));

vi.mock("../../utils/storage", () => ({
  getProposalKey: vi.fn(() => null),
}));

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const CLIENT_ADDR = "0x1111111111111111111111111111111111111111";
const FREELANCER_A = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const FREELANCER_B = "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

const T_STAKE = 259200; // 3 days in seconds

const baseApps: ApplicationData[] = [
  {
    freelancer: FREELANCER_A,
    proposalHash: "0xhash_a",
    proposalCID: "",
    appliedAt: 1000000,
  },
  {
    freelancer: FREELANCER_B,
    proposalHash: "0xhash_b",
    proposalCID: "",
    appliedAt: 1000100,
  },
];

describe("ApplicationList — T_STAKE offer expiry logic", () => {
  const onSelect = vi.fn();
  const onReselect = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ═══════════════════════════════════════════════════════════
  //  Core expiry detection
  // ═══════════════════════════════════════════════════════════

  it("should show 'Waiting for freelancer confirmation' when within T_STAKE window", () => {
    const selectedAt = 1000000;
    const nowTimestamp = selectedAt + T_STAKE - 3600; // 1 hour before expiry

    render(
      <ApplicationList
        applications={baseApps}
        onSelect={onSelect}
        selectedFreelancer={FREELANCER_A}
        isSelecting={false}
        userAddress={CLIENT_ADDR}
        isClient={true}
        selectedAt={selectedAt}
        tStake={T_STAKE}
        nowTimestamp={nowTimestamp}
      />
    );

    expect(screen.getByText("Waiting for freelancer confirmation")).toBeInTheDocument();
    expect(screen.queryByText("Offer expired")).not.toBeInTheDocument();
  });

  it("should show 'Offer expired' when past T_STAKE window", () => {
    const selectedAt = 1000000;
    const nowTimestamp = selectedAt + T_STAKE + 1; // 1 second past expiry

    render(
      <ApplicationList
        applications={baseApps}
        onSelect={onSelect}
        onReselect={onReselect}
        selectedFreelancer={FREELANCER_A}
        isSelecting={false}
        userAddress={CLIENT_ADDR}
        isClient={true}
        selectedAt={selectedAt}
        tStake={T_STAKE}
        nowTimestamp={nowTimestamp}
      />
    );

    expect(screen.getByText("Offer expired")).toBeInTheDocument();
    expect(screen.queryByText("Waiting for freelancer confirmation")).not.toBeInTheDocument();
  });

  it("BUG PROBE: exactly at boundary (now === selectedAt + T_STAKE) — offer should NOT be expired", () => {
    // The condition is: `now > selectedAt + tStake` (strict greater-than)
    // At exactly the boundary, the offer is NOT expired.
    // The contract also uses strict `>`: `block.timestamp > job.selectedAt + T_STAKE`
    const selectedAt = 1000000;
    const nowTimestamp = selectedAt + T_STAKE; // exactly at boundary

    render(
      <ApplicationList
        applications={baseApps}
        onSelect={onSelect}
        selectedFreelancer={FREELANCER_A}
        isSelecting={false}
        userAddress={CLIENT_ADDR}
        isClient={true}
        selectedAt={selectedAt}
        tStake={T_STAKE}
        nowTimestamp={nowTimestamp}
      />
    );

    // `now > selectedAt + tStake` → 1259200 > 1259200 → false
    // So we should still see "Waiting for freelancer confirmation"
    expect(screen.getByText("Waiting for freelancer confirmation")).toBeInTheDocument();
    expect(screen.queryByText("Offer expired")).not.toBeInTheDocument();
  });

  it("BUG PROBE: 1 second past boundary — should be expired", () => {
    const selectedAt = 1000000;
    const nowTimestamp = selectedAt + T_STAKE + 1;

    render(
      <ApplicationList
        applications={baseApps}
        onSelect={onSelect}
        onReselect={onReselect}
        selectedFreelancer={FREELANCER_A}
        isSelecting={false}
        userAddress={CLIENT_ADDR}
        isClient={true}
        selectedAt={selectedAt}
        tStake={T_STAKE}
        nowTimestamp={nowTimestamp}
      />
    );

    expect(screen.getByText("Offer expired")).toBeInTheDocument();
  });

  // ═══════════════════════════════════════════════════════════
  //  nowTimestamp prop vs Date.now() fallback
  // ═══════════════════════════════════════════════════════════

  it("BUG PROBE: without nowTimestamp prop, falls back to Date.now() — diverges from blockchain time", () => {
    // When nowTimestamp is NOT provided, the component falls back to
    // `Math.floor(Date.now() / 1000)`. In test mode with time-travel,
    // this would be WRONG.
    //
    // Set selectedAt far in the past so that even system time would show expired.
    const selectedAt = Math.floor(Date.now() / 1000) - T_STAKE - 86400;

    render(
      <ApplicationList
        applications={baseApps}
        onSelect={onSelect}
        onReselect={onReselect}
        selectedFreelancer={FREELANCER_A}
        isSelecting={false}
        userAddress={CLIENT_ADDR}
        isClient={true}
        selectedAt={selectedAt}
        tStake={T_STAKE}
        // NOTE: no nowTimestamp prop — uses Date.now()
      />
    );

    // This should still work because the offer is old enough for even Date.now() to detect
    expect(screen.getByText("Offer expired")).toBeInTheDocument();
  });

  it("BUG PROBE: without nowTimestamp, recent offer appears NOT expired even if blockchain time has advanced", () => {
    // This simulates the original bug scenario:
    // - Freelancer was selected 1 hour ago (system time)
    // - Blockchain time was advanced by 6 days (evm_increaseTime)
    // - Without nowTimestamp, Date.now() is used → offer appears NOT expired
    const systemNow = Math.floor(Date.now() / 1000);
    const selectedAt = systemNow - 3600; // 1 hour ago in system time
    // Blockchain would be at systemNow + 6*86400, but without nowTimestamp,
    // the component uses Date.now()

    render(
      <ApplicationList
        applications={baseApps}
        onSelect={onSelect}
        selectedFreelancer={FREELANCER_A}
        isSelecting={false}
        userAddress={CLIENT_ADDR}
        isClient={true}
        selectedAt={selectedAt}
        tStake={T_STAKE}
        // No nowTimestamp → falls back to Date.now()
      />
    );

    // Date.now()-based "now" = systemNow, selectedAt = systemNow - 3600
    // now > selectedAt + T_STAKE → systemNow > (systemNow - 3600) + 259200 → false
    // The offer appears NOT expired — this is the bug when blockchain time has advanced!
    expect(screen.getByText("Waiting for freelancer confirmation")).toBeInTheDocument();
  });

  it("FIX VERIFICATION: with nowTimestamp reflecting blockchain time, same scenario shows expired", () => {
    const systemNow = Math.floor(Date.now() / 1000);
    const selectedAt = systemNow - 3600; // 1 hour ago in system time
    const blockchainNow = systemNow + 6 * 86400; // 6 days ahead

    render(
      <ApplicationList
        applications={baseApps}
        onSelect={onSelect}
        onReselect={onReselect}
        selectedFreelancer={FREELANCER_A}
        isSelecting={false}
        userAddress={CLIENT_ADDR}
        isClient={true}
        selectedAt={selectedAt}
        tStake={T_STAKE}
        nowTimestamp={blockchainNow}
      />
    );

    expect(screen.getByText("Offer expired")).toBeInTheDocument();
  });

  // ═══════════════════════════════════════════════════════════
  //  Edge cases in selection state
  // ═══════════════════════════════════════════════════════════

  it("should not show expiry banner when no freelancer is selected", () => {
    render(
      <ApplicationList
        applications={baseApps}
        onSelect={onSelect}
        selectedFreelancer={ZERO_ADDRESS}
        isSelecting={false}
        userAddress={CLIENT_ADDR}
        isClient={true}
        nowTimestamp={999999999}
      />
    );

    expect(screen.queryByText("Waiting for freelancer confirmation")).not.toBeInTheDocument();
    expect(screen.queryByText("Offer expired")).not.toBeInTheDocument();
  });

  it("should not show expiry banner when selectedFreelancer is undefined", () => {
    render(
      <ApplicationList
        applications={baseApps}
        onSelect={onSelect}
        isSelecting={false}
        userAddress={CLIENT_ADDR}
        isClient={true}
        nowTimestamp={999999999}
      />
    );

    expect(screen.queryByText("Waiting for freelancer confirmation")).not.toBeInTheDocument();
    expect(screen.queryByText("Offer expired")).not.toBeInTheDocument();
  });

  it("BUG PROBE: freelancer selected but selectedAt is 0 — should not show expired", () => {
    // If selectedAt is 0 (falsy), the offerExpired check should be false.
    // Code: `offerExpired = hasSelection && selectedAt ? now > selectedAt + tStake : false`
    // selectedAt = 0 is falsy in JS → ternary goes to `false`.
    render(
      <ApplicationList
        applications={baseApps}
        onSelect={onSelect}
        selectedFreelancer={FREELANCER_A}
        isSelecting={false}
        userAddress={CLIENT_ADDR}
        isClient={true}
        selectedAt={0}
        tStake={T_STAKE}
        nowTimestamp={999999999}
      />
    );

    // selectedAt = 0 is falsy → offerExpired = false
    // But selectedAt=0 with a selected freelancer is an inconsistent state!
    // The UI shows "Waiting for freelancer confirmation" with a time of "3 days" (hardcoded fallback)
    expect(screen.getByText("Waiting for freelancer confirmation")).toBeInTheDocument();
  });

  it("BUG PROBE: selectedAt is undefined — should not show expired", () => {
    render(
      <ApplicationList
        applications={baseApps}
        onSelect={onSelect}
        selectedFreelancer={FREELANCER_A}
        isSelecting={false}
        userAddress={CLIENT_ADDR}
        isClient={true}
        // selectedAt not provided (undefined)
        tStake={T_STAKE}
        nowTimestamp={999999999}
      />
    );

    // undefined is falsy → offerExpired = false
    expect(screen.getByText("Waiting for freelancer confirmation")).toBeInTheDocument();
  });

  // ═══════════════════════════════════════════════════════════
  //  Countdown text in banner
  // ═══════════════════════════════════════════════════════════

  it("should show remaining time in the waiting banner", () => {
    const selectedAt = 1000000;
    const nowTimestamp = selectedAt + T_STAKE - 86400; // 1 day left

    render(
      <ApplicationList
        applications={baseApps}
        onSelect={onSelect}
        selectedFreelancer={FREELANCER_A}
        isSelecting={false}
        userAddress={CLIENT_ADDR}
        isClient={true}
        selectedAt={selectedAt}
        tStake={T_STAKE}
        nowTimestamp={nowTimestamp}
      />
    );

    // Should show "1d 0h" in the countdown text
    expect(screen.getByText(/1d 0h/)).toBeInTheDocument();
  });

  it("BUG PROBE: countdown should show '0s' when exactly at boundary, not negative time", () => {
    const selectedAt = 1000000;
    const nowTimestamp = selectedAt + T_STAKE; // exactly at boundary

    render(
      <ApplicationList
        applications={baseApps}
        onSelect={onSelect}
        selectedFreelancer={FREELANCER_A}
        isSelecting={false}
        userAddress={CLIENT_ADDR}
        isClient={true}
        selectedAt={selectedAt}
        tStake={T_STAKE}
        nowTimestamp={nowTimestamp}
      />
    );

    // remaining = selectedAt + tStake - now = 0, so "0s" should appear
    expect(screen.getByText(/0s/)).toBeInTheDocument();
  });

  it("BUG PROBE: when 1 second past boundary, should NOT show waiting banner at all (shows expired)", () => {
    const selectedAt = 1000000;
    const nowTimestamp = selectedAt + T_STAKE + 1;

    render(
      <ApplicationList
        applications={baseApps}
        onSelect={onSelect}
        onReselect={onReselect}
        selectedFreelancer={FREELANCER_A}
        isSelecting={false}
        userAddress={CLIENT_ADDR}
        isClient={true}
        selectedAt={selectedAt}
        tStake={T_STAKE}
        nowTimestamp={nowTimestamp}
      />
    );

    // The expired branch shows instead of waiting branch
    expect(screen.queryByText("Waiting for freelancer confirmation")).not.toBeInTheDocument();
    expect(screen.getByText("Offer expired")).toBeInTheDocument();
  });

  // ═══════════════════════════════════════════════════════════
  //  Button state management
  // ═══════════════════════════════════════════════════════════

  it("should disable Select buttons for non-selected freelancers when offer is pending", () => {
    const selectedAt = 1000000;
    const nowTimestamp = selectedAt + 100; // well within T_STAKE

    render(
      <ApplicationList
        applications={baseApps}
        onSelect={onSelect}
        selectedFreelancer={FREELANCER_A}
        isSelecting={false}
        userAddress={CLIENT_ADDR}
        isClient={true}
        selectedAt={selectedAt}
        tStake={T_STAKE}
        nowTimestamp={nowTimestamp}
      />
    );

    // FREELANCER_A should show "Selected" badge
    expect(screen.getByText("Selected")).toBeInTheDocument();

    // FREELANCER_B should have a disabled "Select" button
    const selectButtons = screen.getAllByRole("button", { name: /Select/i });
    const disabledSelects = selectButtons.filter((btn) => btn.hasAttribute("disabled"));
    expect(disabledSelects.length).toBeGreaterThanOrEqual(1);
  });

  it("should show Reselect button for non-selected freelancers when offer expired", () => {
    const selectedAt = 1000000;
    const nowTimestamp = selectedAt + T_STAKE + 1;

    render(
      <ApplicationList
        applications={baseApps}
        onSelect={onSelect}
        onReselect={onReselect}
        selectedFreelancer={FREELANCER_A}
        isSelecting={false}
        userAddress={CLIENT_ADDR}
        isClient={true}
        selectedAt={selectedAt}
        tStake={T_STAKE}
        nowTimestamp={nowTimestamp}
      />
    );

    // FREELANCER_A should show "Expired" badge
    expect(screen.getByText("Expired")).toBeInTheDocument();

    // FREELANCER_B should have "Reselect" button
    expect(screen.getByText("Reselect")).toBeInTheDocument();
  });

  // ═══════════════════════════════════════════════════════════
  //  Non-client view
  // ═══════════════════════════════════════════════════════════

  it("should NOT show expiry banner when user is not the client", () => {
    const selectedAt = 1000000;
    const nowTimestamp = selectedAt + T_STAKE + 86400; // well past expiry

    render(
      <ApplicationList
        applications={baseApps}
        onSelect={onSelect}
        selectedFreelancer={FREELANCER_A}
        isSelecting={false}
        userAddress={FREELANCER_B}
        isClient={false}
        selectedAt={selectedAt}
        tStake={T_STAKE}
        nowTimestamp={nowTimestamp}
      />
    );

    // Banner should only show for isClient
    expect(screen.queryByText("Waiting for freelancer confirmation")).not.toBeInTheDocument();
    expect(screen.queryByText("Offer expired")).not.toBeInTheDocument();
  });
});
