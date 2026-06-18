import { env } from "@/shared/env";
import type { SizingResult } from "@/shared/types";

/**
 * Compute R-based position size.
 * Direct port of sizing.py::compute_size.
 *
 * shares = floor((risk_dollars / R) × conviction_mult)
 * Capped at MAX_POSITION_USD.
 */
export function computeSize(
  entry: number,
  stop: number,
  convictionScore: number,        // raw 0–12 gap-scanner score
  accountEquity: number
): SizingResult {
  const r = entry - stop;
  if (r <= 0) throw new Error(`Stop ${stop} must be below entry ${entry}`);

  const { scale_target, final_target } = computeTargets(entry, stop);
  const riskDollars = Math.min(
    env.MAX_RISK_PER_TRADE(),
    accountEquity * env.MAX_RISK_PCT()
  );

  const norm = normalizeScore(convictionScore);
  const mult = convictionMultiplier(norm);

  let shares = Math.floor((riskDollars / r) * mult);
  shares = Math.max(1, shares);

  let positionDollars = shares * entry;
  if (positionDollars > env.MAX_POSITION_USD()) {
    shares = Math.max(1, Math.floor(env.MAX_POSITION_USD() / entry));
    positionDollars = shares * entry;
  }

  return {
    shares,
    r_size: r,
    risk_dollars: riskDollars,
    scale_target: round4(scale_target),
    final_target:  round4(final_target),
    conviction_norm: norm,
    position_dollars: round4(positionDollars),
  };
}

/**
 * scale_target = entry + max(1R, SCALE_MIN_PCT × entry)
 * final_target = entry + max(2R, FINAL_MIN_PCT × entry)
 */
export function computeTargets(
  entry: number,
  stop: number
): { r_size: number; scale_target: number; final_target: number } {
  const r = entry - stop;
  if (r <= 0) throw new Error(`Stop ${stop} must be below entry ${entry}`);
  const scalePct = env.SCALE_MIN_PCT();
  const finalPct = env.FINAL_MIN_PCT();
  return {
    r_size:       r,
    scale_target: entry + Math.max(r,       scalePct * entry),
    final_target: entry + Math.max(2 * r,   finalPct * entry),
  };
}

/**
 * Normalise gap-scanner conviction_score (0–12) to 0–10.
 * Other strategy types would use their own raw score ranges.
 */
export function normalizeScore(rawScore: number): number {
  return Math.min(10, Math.round(rawScore * 10 / 12));
}

export function convictionMultiplier(normScore: number): number {
  if (normScore >= 9) return env.CONV_MULT_9();
  if (normScore >= 8) return env.CONV_MULT_8();
  return env.CONV_MULT_7();
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
