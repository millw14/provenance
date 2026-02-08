/**
 * Formatting utilities for the observatory UI.
 * All numbers displayed as monospace. BigInt-safe.
 */

const LAMPORTS_PER_SOL = 1_000_000_000n;

/**
 * Format lamports as SOL with specified decimal places.
 */
export function lamportsToSol(lamports: bigint, decimals = 4): string {
  const whole = lamports / LAMPORTS_PER_SOL;
  const frac = lamports % LAMPORTS_PER_SOL;
  const fracStr = frac.toString().padStart(9, "0").slice(0, decimals);
  return `${whole}.${fracStr}`;
}

/**
 * Format basis points as percentage string.
 * e.g. 50 bps -> "0.50%"
 */
export function bpsToPercent(bps: bigint | number): string {
  const n = typeof bps === "bigint" ? Number(bps) : bps;
  return (n / 100).toFixed(2) + "%";
}

/**
 * Format a slot count as approximate human-readable duration.
 * ~400ms per slot on Solana.
 */
export function slotsToHumanDuration(slots: bigint): string {
  const seconds = Number(slots) * 0.4;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`;
  return `${(seconds / 86400).toFixed(1)}d`;
}

/**
 * Format slot difference as "Day N" since a reference.
 * Assumes ~400ms/slot, ~216,000 slots/day.
 */
export function slotsToDays(slotDiff: bigint): number {
  return Number(slotDiff) * 0.4 / 86400;
}

/**
 * Format large BigInt with comma separators.
 */
export function formatBigInt(n: bigint): string {
  return n.toLocaleString();
}

/**
 * Compute coverage ratio: insurance / OI as percentage.
 * Returns "N/A" if OI is zero.
 */
export function coverageRatio(insurance: bigint, oi: bigint): string {
  if (oi === 0n) return "N/A";
  const pct = (Number(insurance) / Number(oi)) * 100;
  return pct.toFixed(2) + "%";
}

/**
 * Short address: first 4 + last 4.
 */
export function shortAddr(addr: string): string {
  if (addr.length <= 12) return addr;
  return addr.slice(0, 4) + "..." + addr.slice(-4);
}
