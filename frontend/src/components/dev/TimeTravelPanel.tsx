import React, { useState, useCallback } from "react";
import { ethers } from "ethers";
import toast from "react-hot-toast";
import { getTargetNetwork } from "../../config/networks";
import {
  T_ACCEPTANCE,
  T_STAKE,
  T_EVIDENCE,
  T_KEY_DISTRIBUTION,
  T_RULING,
} from "../../config/constants";
import { useBlockTimestamp } from "../../hooks/useBlockTimestamp";

/* ── Preset quick-skip buttons ──────────────────────────────────── */

interface Preset {
  label: string;
  seconds: number;
  description: string;
  color: string;
}

const PRESETS: Preset[] = [
  {
    label: "+3 days",
    seconds: T_STAKE + 1,
    description: "Skip past T_STAKE (freelancer stake window)",
    color: "bg-blue-600 hover:bg-blue-700",
  },
  {
    label: "+5 days",
    seconds: T_EVIDENCE + 1,
    description: "Skip past T_EVIDENCE (evidence submission window)",
    color: "bg-indigo-600 hover:bg-indigo-700",
  },
  {
    label: "+2 days",
    seconds: T_KEY_DISTRIBUTION + 1,
    description: "Skip past T_KEY_DISTRIBUTION (key distribution window)",
    color: "bg-violet-600 hover:bg-violet-700",
  },
  {
    label: "+14 days",
    seconds: T_ACCEPTANCE + 1,
    description: "Skip past T_ACCEPTANCE / T_RULING",
    color: "bg-orange-600 hover:bg-orange-700",
  },
  {
    label: "+30 days",
    seconds: 30 * 86400 + 1,
    description: "Skip past max review timeout (30 days)",
    color: "bg-red-600 hover:bg-red-700",
  },
];

/* ── Helper: advance EVM time ───────────────────────────────────── */

async function advanceTime(seconds: number): Promise<void> {
  const network = getTargetNetwork();
  const provider = new ethers.JsonRpcProvider(network.rpcUrl);

  // Increase time and mine a new block so the timestamp takes effect
  await provider.send("evm_increaseTime", [seconds]);
  await provider.send("evm_mine", []);
}

/* ── Panel component ────────────────────────────────────────────── */

export default function TimeTravelPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [customDays, setCustomDays] = useState("");
  const [customHours, setCustomHours] = useState("");
  const [customMinutes, setCustomMinutes] = useState("");
  const [isAdvancing, setIsAdvancing] = useState(false);
  const blockTimestamp = useBlockTimestamp();

  const handleAdvance = useCallback(
    async (seconds: number, label: string) => {
      if (isAdvancing) return;
      setIsAdvancing(true);
      try {
        await advanceTime(seconds);
        toast.success(`⏩ Time advanced: ${label}`, { duration: 3000 });
      } catch (err: any) {
        console.error("Time travel failed:", err);
        toast.error(`Time travel failed: ${err.message ?? err}`);
      } finally {
        setIsAdvancing(false);
      }
    },
    [isAdvancing]
  );

  const handleCustomAdvance = useCallback(() => {
    const d = parseInt(customDays || "0", 10);
    const h = parseInt(customHours || "0", 10);
    const m = parseInt(customMinutes || "0", 10);
    const totalSeconds = d * 86400 + h * 3600 + m * 60;
    if (totalSeconds <= 0) {
      toast.error("Enter a positive duration");
      return;
    }
    const parts: string[] = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    handleAdvance(totalSeconds, parts.join(" "));
  }, [customDays, customHours, customMinutes, handleAdvance]);

  const formattedTime = new Date(blockTimestamp * 1000).toLocaleString();

  /* ── Collapsed: just a small floating button ── */
  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 right-4 z-50 bg-gray-900 text-white 
                   rounded-full w-12 h-12 flex items-center justify-center 
                   shadow-lg hover:bg-gray-700 transition-colors
                   border-2 border-yellow-400"
        title="Open Time Travel Panel (Dev Mode)"
      >
        ⏳
      </button>
    );
  }

  /* ── Expanded panel ── */
  return (
    <div
      className="fixed bottom-4 right-4 z-50 w-80 bg-gray-900 text-white 
                    rounded-xl shadow-2xl border border-yellow-400/50 overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-yellow-500/20 border-b border-yellow-400/30">
        <div className="flex items-center gap-2">
          <span className="text-lg">⏳</span>
          <span className="font-semibold text-sm text-yellow-300">
            Time Travel
          </span>
          <span className="text-[10px] bg-yellow-500/30 text-yellow-200 px-1.5 py-0.5 rounded">
            DEV
          </span>
        </div>
        <button
          onClick={() => setIsOpen(false)}
          className="text-gray-400 hover:text-white text-lg leading-none"
        >
          ✕
        </button>
      </div>

      {/* Current blockchain time */}
      <div className="px-4 py-2 border-b border-gray-700">
        <div className="text-[10px] text-gray-500 uppercase tracking-wider">
          Block Timestamp
        </div>
        <div className="text-sm font-mono text-gray-200">{formattedTime}</div>
        <div className="text-[10px] font-mono text-gray-500">
          ({blockTimestamp})
        </div>
      </div>

      {/* Preset buttons */}
      <div className="px-4 py-3 space-y-1.5 border-b border-gray-700">
        <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">
          Quick Skip (matches contract timeouts)
        </div>
        {PRESETS.map((p) => (
          <button
            key={p.label}
            disabled={isAdvancing}
            onClick={() => handleAdvance(p.seconds, p.label)}
            className={`w-full text-left px-3 py-1.5 rounded text-xs font-medium 
                        text-white ${p.color} disabled:opacity-50 
                        disabled:cursor-not-allowed transition-colors
                        flex items-center justify-between`}
          >
            <span>{p.label}</span>
            <span className="text-[10px] opacity-70 font-normal">
              {p.description}
            </span>
          </button>
        ))}
      </div>

      {/* Custom time input */}
      <div className="px-4 py-3">
        <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">
          Custom Duration
        </div>
        <div className="flex gap-1.5 mb-2">
          <div className="flex-1">
            <input
              type="number"
              min="0"
              placeholder="0"
              value={customDays}
              onChange={(e) => setCustomDays(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 
                         text-xs text-white placeholder-gray-600 focus:border-yellow-400 
                         focus:outline-none"
            />
            <div className="text-[10px] text-gray-600 text-center mt-0.5">
              days
            </div>
          </div>
          <div className="flex-1">
            <input
              type="number"
              min="0"
              max="23"
              placeholder="0"
              value={customHours}
              onChange={(e) => setCustomHours(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 
                         text-xs text-white placeholder-gray-600 focus:border-yellow-400 
                         focus:outline-none"
            />
            <div className="text-[10px] text-gray-600 text-center mt-0.5">
              hrs
            </div>
          </div>
          <div className="flex-1">
            <input
              type="number"
              min="0"
              max="59"
              placeholder="0"
              value={customMinutes}
              onChange={(e) => setCustomMinutes(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 
                         text-xs text-white placeholder-gray-600 focus:border-yellow-400 
                         focus:outline-none"
            />
            <div className="text-[10px] text-gray-600 text-center mt-0.5">
              min
            </div>
          </div>
        </div>
        <button
          disabled={isAdvancing}
          onClick={handleCustomAdvance}
          className="w-full bg-yellow-600 hover:bg-yellow-500 disabled:opacity-50 
                     disabled:cursor-not-allowed text-white text-xs font-medium 
                     py-1.5 rounded transition-colors"
        >
          {isAdvancing ? "Advancing…" : "⏩ Advance Time"}
        </button>
      </div>

      {/* Timeout reference */}
      <div className="px-4 py-2 border-t border-gray-700 bg-gray-800/50">
        <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">
          Timeout Reference
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-gray-400">
          <span>T_STAKE</span>
          <span className="text-right">3 days</span>
          <span>T_EVIDENCE</span>
          <span className="text-right">5 days</span>
          <span>T_KEY_DIST</span>
          <span className="text-right">2 days</span>
          <span>T_ACCEPTANCE</span>
          <span className="text-right">14 days</span>
          <span>T_RULING</span>
          <span className="text-right">14 days</span>
          <span>Review Timeout</span>
          <span className="text-right">1–30 days</span>
        </div>
      </div>
    </div>
  );
}
