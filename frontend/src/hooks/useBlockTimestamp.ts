import { useState, useEffect, useCallback, useRef } from "react";
import { ethers } from "ethers";
import { getTargetNetwork } from "../config/networks";

/**
 * Whether to use blockchain time instead of Date.now().
 *
 * When VITE_TEST_MODE is "true", the hook fetches block.timestamp from the
 * provider so that evm_increaseTime / evm_mine advances are reflected in the
 * UI.  In production (default) it falls back to Date.now() — fast, no RPC
 * overhead.
 */
export const IS_TEST_MODE =
  import.meta.env.VITE_TEST_MODE === "true";

/** Poll interval for fetching block timestamp in test mode (ms). */
const POLL_INTERVAL_MS = 5_000;

/**
 * Returns the current "now" timestamp in **seconds** (Unix epoch).
 *
 * - Test mode  → latest block.timestamp via JSON-RPC (polled every 5 s).
 * - Prod mode  → Math.floor(Date.now() / 1000), updated every second.
 */
export function useBlockTimestamp(): number {
  const [timestamp, setTimestamp] = useState(() =>
    Math.floor(Date.now() / 1000)
  );
  const providerRef = useRef<ethers.JsonRpcProvider | null>(null);

  // Lazily create a JSON-RPC provider for block timestamp queries.
  const getProvider = useCallback(() => {
    if (!providerRef.current) {
      const network = getTargetNetwork();
      providerRef.current = new ethers.JsonRpcProvider(network.rpcUrl);
    }
    return providerRef.current;
  }, []);

  useEffect(() => {
    if (IS_TEST_MODE) {
      // ── Test mode: poll blockchain for latest block timestamp ──
      let cancelled = false;

      const fetchBlockTimestamp = async () => {
        try {
          const provider = getProvider();
          const block = await provider.getBlock("latest");
          if (block && !cancelled) {
            setTimestamp(block.timestamp);
          }
        } catch (err) {
          console.warn("Failed to fetch block timestamp:", err);
          // Fallback to Date.now() on error
          if (!cancelled) {
            setTimestamp(Math.floor(Date.now() / 1000));
          }
        }
      };

      fetchBlockTimestamp();
      const interval = setInterval(fetchBlockTimestamp, POLL_INTERVAL_MS);

      return () => {
        cancelled = true;
        clearInterval(interval);
      };
    } else {
      // ── Production mode: use system clock ──
      const tick = () => setTimestamp(Math.floor(Date.now() / 1000));
      tick();
      const interval = setInterval(tick, 1_000);
      return () => clearInterval(interval);
    }
  }, [getProvider]);

  return timestamp;
}

/**
 * Non-hook helper: returns current "now" in seconds for one-off checks.
 * Prefer the hook version in React components.
 */
export async function getBlockTimestamp(): Promise<number> {
  if (!IS_TEST_MODE) {
    return Math.floor(Date.now() / 1000);
  }
  try {
    const network = getTargetNetwork();
    const provider = new ethers.JsonRpcProvider(network.rpcUrl);
    const block = await provider.getBlock("latest");
    return block ? block.timestamp : Math.floor(Date.now() / 1000);
  } catch {
    return Math.floor(Date.now() / 1000);
  }
}
