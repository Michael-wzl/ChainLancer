import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSingleFlight } from "../../hooks/useSingleFlight";

describe("useSingleFlight", () => {
  it("blocks duplicate in-flight executions for the same key", async () => {
    let resolveWork: (() => void) | null = null;
    const workPromise = new Promise<void>((resolve) => {
      resolveWork = resolve;
    });
    const onLocked = vi.fn();
    const worker = vi.fn(async () => {
      await workPromise;
      return "done";
    });

    const { result } = renderHook(() => useSingleFlight());

    let firstCall: Promise<string | undefined>;
    await act(async () => {
      firstCall = result.current.runWithLock("job:1", worker, onLocked);
    });

    expect(result.current.isLocked("job:1")).toBe(true);

    let secondResult: string | undefined;
    await act(async () => {
      secondResult = await result.current.runWithLock("job:1", worker, onLocked);
    });

    expect(secondResult).toBeUndefined();
    expect(worker).toHaveBeenCalledTimes(1);
    expect(onLocked).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveWork?.();
      await firstCall!;
    });

    expect(result.current.isLocked("job:1")).toBe(false);
  });

  it("allows a new execution after the previous call finishes", async () => {
    const worker = vi.fn(async () => "ok");
    const { result } = renderHook(() => useSingleFlight());

    await act(async () => {
      await result.current.runWithLock("job:2", worker);
    });

    await act(async () => {
      await result.current.runWithLock("job:2", worker);
    });

    expect(worker).toHaveBeenCalledTimes(2);
    expect(result.current.isLocked("job:2")).toBe(false);
  });
});