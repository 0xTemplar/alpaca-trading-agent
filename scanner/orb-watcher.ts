import { getSnapshots } from "@/trading/broker/alpaca";
import { env } from "@/shared/env";
import { minutesFromOpen } from "@/shared/time";
import type { WatchlistEntry, VariantName } from "@/shared/types";

export interface EntrySignal {
  ticker: string;
  variant: VariantName;
  entry_price: number;  // ask price at signal time
  or_low: number;       // hard stop
  or_high: number;      // trigger level
  conviction_score: number;
}

/**
 * Checks whether a WatchlistEntry meets the entry rule for a given variant.
 * Called after the no-trade window (minutesFromOpen >= ORB_MIN_MINS).
 */
export async function checkEntry(
  entry: WatchlistEntry,
  variant: VariantName,
  snapshot?: { latestQuote: { ap: number } }
): Promise<EntrySignal | null> {
  if (!entry.or_high || !entry.or_low) return null;
  if (minutesFromOpen() < env.ORB_MIN_MINS()) return null;

  const snaps = snapshot
    ? { [entry.ticker]: snapshot }
    : await getSnapshots([entry.ticker]);
  const snap = snaps[entry.ticker];
  if (!snap) return null;

  const ask = snap.latestQuote.ap;

  switch (variant) {
    case "orb-immediate":
      if (!entry.orb_triggered && ask > entry.or_high) {
        return makeSignal(entry, variant, ask);
      }
      break;

    case "orb-retest":
      // orb triggered + price pulled back to within 1% of OR high + now back above
      if (
        entry.orb_triggered &&
        ask > entry.or_high &&
        ask <= entry.or_high * 1.02
      ) {
        return makeSignal(entry, variant, ask);
      }
      break;

    case "orb-shakeout":
      if (entry.shakeout_reclaim_fired) {
        return makeSignal(entry, variant, ask);
      }
      break;
  }

  return null;
}

/**
 * Process a real-time price tick and update WatchlistEntry state.
 * Returns the mutated entry.
 */
export function processTick(
  entry: WatchlistEntry,
  price: number,
  minsFromOpen: number
): WatchlistEntry {
  if (!entry.or_high || !entry.or_low) return entry;

  const updated: WatchlistEntry = { ...entry };

  // Detect OR break
  if (!entry.orb_triggered && price > entry.or_high) {
    updated.orb_triggered = true;
    updated.breakout_mins_from_open = minsFromOpen;
    updated.orb_high_conviction =
      minsFromOpen <= env.ORB_HC_BREAKOUT_MINS();
  }

  // Detect shakeout flush (price dips below OR low by > 0.5%)
  if (entry.orb_triggered && !entry.shakeout_active && price < entry.or_low * 0.995) {
    updated.shakeout_active = true;
    updated.shakeout_lod = price;
  }

  // Track shakeout LOD
  if (entry.shakeout_active && entry.shakeout_lod !== null && price < entry.shakeout_lod) {
    updated.shakeout_lod = price;
  }

  // Detect shakeout reclaim
  if (entry.shakeout_active && !entry.shakeout_reclaim_fired && price > entry.or_low) {
    updated.shakeout_reclaim_fired = true;
  }

  return updated;
}

function makeSignal(
  entry: WatchlistEntry,
  variant: VariantName,
  ask: number
): EntrySignal {
  return {
    ticker: entry.ticker,
    variant,
    entry_price: ask,
    or_low: entry.or_low!,
    or_high: entry.or_high!,
    conviction_score: entry.conviction_score,
  };
}
