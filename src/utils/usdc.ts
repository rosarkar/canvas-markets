/** USDC on Base uses 6 decimal places. All bid amounts are integer microunits. */
export const USDC_DECIMALS = 6;
const MICRO_PER_UNIT = 1_000_000n;

export function toMicroUnits(dollars: number | string): bigint {
  const normalized = typeof dollars === "string" ? dollars.trim().replace(/^\$/, "") : String(dollars);
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid dollar amount: ${dollars}`);
  }
  return BigInt(Math.round(value * Number(MICRO_PER_UNIT)));
}

export function fromMicroUnits(micro: bigint): number {
  return Number(micro) / Number(MICRO_PER_UNIT);
}

/** Human-readable USD for Telegram messages (supports $0.01). */
export function formatUsdMicro(micro: bigint): string {
  const dollars = fromMicroUnits(micro);
  if (dollars >= 1) return `$${dollars.toFixed(2)}`;
  if (dollars >= 0.01) return `$${dollars.toFixed(2)}`;
  return `$${dollars.toFixed(4)}`;
}

/**
 * Parse user bid input: "$0.35", "0.35", ".01", "0,01", "0.01 USDC", etc.
 * Returns microunits (bigint).
 */
export function parseBidInput(input: string): bigint {
  let trimmed = input.trim();
  if (!trimmed) throw new Error("Bid amount is required");

  trimmed = trimmed.replace(/\s*(usd|usdc)\s*$/i, "").trim();
  trimmed = trimmed.replace(/^\$\s*/, "");

  let normalized = trimmed;
  if (normalized.includes(",") && !normalized.includes(".")) {
    normalized = normalized.replace(/,/g, ".");
  } else {
    normalized = normalized.replace(/,/g, "");
  }

  const match = normalized.match(/^(\d*(?:\.\d+)?|\.\d+)$/);
  if (!match?.[1] || match[1] === ".") {
    throw new Error(`Could not parse bid amount: ${input}`);
  }

  return toMicroUnits(match[1]);
}
