import { USDC_DECIMALS } from "../config/constants";

/**
 * Format a USDC BigInt value (6 decimals) to a human-readable string.
 */
export function formatUSDC(value: bigint): string {
  const divisor = BigInt(10 ** USDC_DECIMALS);
  const integerPart = value / divisor;
  const fractionalPart = value % divisor;

  const fracStr = fractionalPart.toString().padStart(USDC_DECIMALS, "0");
  // Always show exactly 2 decimal places for currency display
  const twoDecimals = fracStr.slice(0, 2).padEnd(2, "0");
  return `$${integerPart.toLocaleString()}.${twoDecimals}`;
}

/**
 * Parse a human-entered USDC string to BigInt (6 decimals).
 */
export function parseUSDC(value: string): bigint {
  const cleaned = value.replace(/[$,\s]/g, "");
  const parts = cleaned.split(".");
  const integerPart = BigInt(parts[0] || "0");

  let fractionalPart = 0n;
  if (parts[1]) {
    const padded = parts[1].slice(0, USDC_DECIMALS).padEnd(USDC_DECIMALS, "0");
    fractionalPart = BigInt(padded);
  }

  return integerPart * BigInt(10 ** USDC_DECIMALS) + fractionalPart;
}

/**
 * Format a timestamp (seconds) to a human-readable date string.
 */
export function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Format a timestamp to date + time.
 */
export function formatDateTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Format a duration in seconds to a human-readable string.
 */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return "Expired";

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 && days === 0) parts.push(`${minutes}m`);
  if (parts.length === 0) parts.push("<1m");

  return parts.join(" ");
}

/**
 * Format review timeout to human-readable label.
 */
export function formatReviewTimeout(seconds: number): string {
  const days = seconds / 86400;
  return `${days} Day${days !== 1 ? "s" : ""}`;
}

/**
 * Truncate an Ethereum address for display.
 */
export function truncateAddress(address: string): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * Format BPS to percentage string.
 */
export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`;
}
