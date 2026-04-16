import { useCallback, useRef, useState } from "react";

/**
 * Prevent duplicate execution of the same user intent while an async action is still in-flight.
 */
export function useSingleFlight() {
  const activeKeysRef = useRef<Set<string>>(new Set());
  const [activeKeys, setActiveKeys] = useState<Set<string>>(new Set());

  const isLocked = useCallback(
    (key: string) => activeKeysRef.current.has(key) || activeKeys.has(key),
    [activeKeys]
  );

  const runWithLock = useCallback(
    async <T>(
      key: string,
      fn: () => Promise<T>,
      onLocked?: () => void
    ): Promise<T | undefined> => {
      if (activeKeysRef.current.has(key)) {
        onLocked?.();
        return undefined;
      }

      activeKeysRef.current.add(key);
      setActiveKeys((prev) => new Set(prev).add(key));

      try {
        return await fn();
      } finally {
        activeKeysRef.current.delete(key);
        setActiveKeys((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    []
  );

  return {
    runWithLock,
    isLocked,
  };
}