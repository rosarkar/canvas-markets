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

/**
 * Parse user bid input: "$0.35", "0.35", "$1", "1.50", etc.
 * Returns microunits (bigint).
 */
export function parseBidInput(input: string): bigint {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Bid amount is required");

  // Allow leading-dot decimals like ".36" in addition to "0.36"
  const withDollar = trimmed.match(/^\$\s*([\d,]*\.?\d+)\s*$/);
  if (withDollar) return toMicroUnits(withDollar[1]!.replace(/,/g, ""));

  const plain = trimmed.match(/^([\d,]*\.?\d+)\s*$/);
  if (plain) return toMicroUnits(plain[1]!.replace(/,/g, ""));

  throw new Error(`Could not parse bid amount: ${input}`);
}
