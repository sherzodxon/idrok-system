// Exact decimal arithmetic for points, percentages and weights. Floats are forbidden (CLAUDE.md §4).
// Rounding happens only here, only on final displayed values, and only by the configured rule.
import Decimal from "decimal.js";

export { Decimal };
export type DecimalInput = Decimal.Value;

export type RoundingMode = "HALF_UP" | "FLOOR" | "CEIL";
export interface RoundingRule {
  mode: RoundingMode;
  decimals: number;
}

const MODES: Record<RoundingMode, Decimal.Rounding> = {
  HALF_UP: Decimal.ROUND_HALF_UP,
  FLOOR: Decimal.ROUND_FLOOR,
  CEIL: Decimal.ROUND_CEIL,
};

export const D = (value: DecimalInput): Decimal => new Decimal(value);

export function sum(values: readonly DecimalInput[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(v), new Decimal(0));
}

/** numerator / denominator, or null when the denominator is zero (no result, not 0%). */
export function ratio(numerator: DecimalInput, denominator: DecimalInput): Decimal | null {
  const den = new Decimal(denominator);
  return den.isZero() ? null : new Decimal(numerator).dividedBy(den);
}

export function roundTo(value: DecimalInput, rule: RoundingRule): Decimal {
  if (!Number.isInteger(rule.decimals) || rule.decimals < 0 || rule.decimals > 6) {
    throw new RangeError(`Invalid number of decimals: ${rule.decimals}`);
  }
  return new Decimal(value).toDecimalPlaces(rule.decimals, MODES[rule.mode]);
}

/** Serialised form for JSON payloads: a string, so no precision is lost on the way. */
export function toDecimalString(value: DecimalInput, decimals?: number): string {
  const d = new Decimal(value);
  return decimals === undefined ? d.toString() : d.toFixed(decimals);
}
