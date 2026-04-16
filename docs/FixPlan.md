# Fix Plan: Browse Jobs first-load missing latest jobs

## Bug summary

On the live app, the first visit to the Browse Jobs page may show an incomplete job list.
Recent jobs such as `job 6` and `job 7` may be missing from the default list and from the `Completed` filter, even though the jobs exist on-chain and can be opened directly via `/job/:id`.

After visiting a job detail page and returning to Browse Jobs, the missing jobs may appear again.

## Most likely root causes

### 1. Read-only contract access always uses the fallback public RPC

In [frontend/src/contexts/ContractContext.tsx](frontend/src/contexts/ContractContext.tsx), `readContracts` always use the fallback `JsonRpcProvider` instead of preferring the connected wallet provider.

This can cause stale or inconsistent reads on Base Sepolia when the public RPC is behind or load-balanced across nodes with different sync states.

### 2. Job list loading silently drops jobs when any single read fails

In [frontend/src/hooks/useJobList.ts](frontend/src/hooks/useJobList.ts), `fetchSingleJob()` returns `null` for all exceptions, not only for true non-existent jobs.

That means transient RPC errors, timeouts, or inconsistent node responses can make a valid job disappear from the Browse Jobs list.

### 3. Browse Jobs performs a single initial fetch with no recovery path

In [frontend/src/pages/BrowseJobs.tsx](frontend/src/pages/BrowseJobs.tsx), the page relies on a one-time fetch from `useJobList()` and does not auto-refresh on focus, visibility change, or relevant contract events.

If the first fetch is stale, the UI remains stale until the page is revisited.

## Fix plan

### Phase 1: Make read provider selection deterministic

**File:** [frontend/src/contexts/ContractContext.tsx](frontend/src/contexts/ContractContext.tsx)

1. Update `readContracts` so they prefer the wallet `provider` when:
   - the wallet is connected, and
   - the user is on the correct network.
2. Only fall back to `fallbackProvider` when no suitable wallet provider is available.
3. Keep write contracts unchanged.

**Expected effect:**
Connected users read from the same network/provider context as MetaMask, reducing stale list results.

### Phase 2: Make job enumeration resilient

**File:** [frontend/src/hooks/useJobList.ts](frontend/src/hooks/useJobList.ts)

1. Add retry logic for `nextJobId()`.
   - Retry 2-3 times with a short delay.
2. Replace `Promise.all()` for job fetches with `Promise.allSettled()`.
3. Distinguish between:
   - a real missing job (`client === ethers.ZeroAddress`), and
   - temporary read failure.
4. For temporary failures:
   - log a warning with the `jobId`,
   - retry the failed job reads once or twice,
   - only discard the job after retries are exhausted.
5. Expose partial failure metadata from `useJobList()`, for example:
   - `hasPartialFailures`
   - `failedJobIds`

**Expected effect:**
Valid jobs are no longer silently hidden because of transient RPC issues.

### Phase 3: Add recovery behavior to Browse Jobs

**File:** [frontend/src/pages/BrowseJobs.tsx](frontend/src/pages/BrowseJobs.tsx)

1. Use the `refresh()` function returned by `useJobList()`.
2. Refresh the list when:
   - the tab becomes visible again, or
   - the window regains focus.
3. Optionally add a small manual `Refresh` button near the filters.
4. If `hasPartialFailures` is true, show a non-blocking warning banner such as:
   - "Some jobs may not have loaded. Retry."

**Expected effect:**
Even if the first fetch is stale, the list can self-correct without requiring the user to navigate away and back.

### Phase 4: Optional event-driven refresh

**Files:**

- [frontend/src/hooks/useJobEvents.ts](frontend/src/hooks/useJobEvents.ts)
- [frontend/src/pages/BrowseJobs.tsx](frontend/src/pages/BrowseJobs.tsx)

1. Subscribe Browse Jobs to relevant events:
   - `JobPosted`
   - `JobCompleted`
   - `JobCancelled`
   - optionally `FreelancerSelected` / `JobActivated`
2. Debounce event-triggered refreshes to avoid excessive RPC calls.

**Expected effect:**
The listing stays current after on-chain state changes.

## Implementation order

1. Fix provider selection in [frontend/src/contexts/ContractContext.tsx](frontend/src/contexts/ContractContext.tsx)
2. Harden loading logic in [frontend/src/hooks/useJobList.ts](frontend/src/hooks/useJobList.ts)
3. Add UI recovery in [frontend/src/pages/BrowseJobs.tsx](frontend/src/pages/BrowseJobs.tsx)
4. Add optional event-driven refresh in [frontend/src/hooks/useJobEvents.ts](frontend/src/hooks/useJobEvents.ts)

## Validation plan

### Manual checks

1. Connect MetaMask on Base Sepolia.
2. Open Browse Jobs on a clean session.
3. Confirm the newest jobs appear on first load.
4. Switch to the `Completed` filter and confirm completed jobs such as `job 7` appear immediately.
5. Refresh the page multiple times and confirm the result is stable.
6. Open a job detail page and return; confirm the list does not change unexpectedly.
7. Test with wallet disconnected to confirm fallback reads still work.

### Failure simulation

1. Mock intermittent failures in `getJobInfo()` or `jobs(jobId)`.
2. Confirm temporary failures do not permanently remove valid jobs from the rendered list.
3. Confirm warning UI appears when partial failures occur.

### Regression coverage

Add or update frontend tests for:

1. `useJobList()` retry behavior
2. partial failure handling with `Promise.allSettled()`
3. Browse Jobs refresh on focus/visibility restore
4. correct filtering of `Completed` jobs after resilient loading

## Success criteria

The bug is considered fixed when:

1. the latest jobs appear on the first Browse Jobs load,
2. the `Completed` filter includes those jobs without needing manual URL navigation,
3. temporary RPC/read failures no longer silently hide valid jobs, and
4. the page can recover automatically from stale initial reads.
