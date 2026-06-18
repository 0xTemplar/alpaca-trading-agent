import { getSnapshots, getORBars } from "@/trading/broker/alpaca";
import { env } from "@/shared/env";
import { nowET } from "@/shared/time";
import type { Candidate, EntryType, WatchlistEntry } from "@/shared/types";

const ET_DATE_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric", month: "2-digit", day: "2-digit",
});

function todayET(): string {
  return ET_DATE_FMT.format(new Date());
}

/**
 * Filter a list of tickers from an external screener against
 * gap-and-go quality gates — mirrors project-scanner gap filter logic.
 *
 * Input: raw tickers (from a data provider or manual list).
 * Output: Candidate[] that passed all gates.
 */
export async function buildCandidates(tickers: string[]): Promise<Candidate[]> {
  if (tickers.length === 0) return [];

  const snaps = await getSnapshots(tickers);
  const results: Candidate[] = [];

  for (const [ticker, snap] of Object.entries(snaps)) {
    try {
      const price       = snap.latestTrade.p;
      const prev_close  = snap.prevDailyBar.c;
      const gap_pct     = (price - prev_close) / prev_close;
      const day_volume  = snap.dailyBar.v;
      const ask         = snap.latestQuote.ap;
      const bid         = snap.latestQuote.bp;
      const spread_pct  = ask > 0 ? (ask - bid) / ask * 100 : 999;

      if (price < env.MIN_PRICE()  || price > env.MAX_PRICE())   continue;
      if (gap_pct < env.MIN_GAP_PCT())                           continue;
      if (day_volume < env.MIN_VOLUME())                         continue;
      if (spread_pct > env.MAX_SPREAD_PCT())                     continue;

      // Conviction score (0–12): each point below adds risk, subtract.
      // Full breakdown mirrors project-scanner scoring.
      let score = 0;
      if (gap_pct >= 0.10) score += 3;
      else if (gap_pct >= 0.07) score += 2;
      else if (gap_pct >= 0.04) score += 1;
      if (day_volume >= 500_000) score += 2;
      else if (day_volume >= 200_000) score += 1;
      if (spread_pct < 0.5) score += 2;
      else if (spread_pct < 1.0) score += 1;
      // catalyst check is external — we assume input tickers have it unless flagged
      const has_catalyst = true;
      if (has_catalyst) score += 3;
      // float / rvol not available from snapshots alone — add externally later
      const pm_volume = 0;
      const rvol = null;

      if (score < env.MIN_ORB_SCORE()) continue;

      const entry_type: EntryType =
        score >= 10 ? "ORB" :
        gap_pct >= 0.08 ? "PRE-MKT" : "CONTINUATION";

      results.push({
        ticker,
        price,
        prev_close,
        gap_pct,
        day_volume,
        pm_volume,
        pm_volume_pct_float: null,
        float_shares: null,
        rvol,
        has_catalyst,
        pm_high_time: null,
        pm_high_price: null,
        ask,
        bid,
        conviction_score: score,
        entry_type,
      });
    } catch { /* skip this ticker */ }
  }

  return results.sort((a, b) => b.conviction_score - a.conviction_score);
}

/**
 * Attach OR levels to filtered candidates and produce the WatchlistEntry list.
 * Call this after the 9:31 bar is available.
 */
export async function buildWatchlist(
  candidates: Candidate[]
): Promise<WatchlistEntry[]> {
  if (candidates.length === 0) return [];

  const tickers = candidates.map((c) => c.ticker);
  const orBars  = await getORBars(tickers, todayET());

  return candidates.map((c) => {
    const or = orBars[c.ticker];
    const or_range_pct =
      or ? (or.or_high - or.or_low) / or.or_low : null;
    return {
      ...c,
      or_high:   or?.or_high ?? null,
      or_low:    or?.or_low  ?? null,
      or_range_pct,
      pm_fade_pct: c.pm_high_price
        ? (c.pm_high_price - c.price) / c.pm_high_price
        : null,
      orb_triggered:        false,
      orb_high_conviction:  (c.conviction_score >= env.MIN_ORB_SCORE()),
      breakout_mins_from_open: null,
      shakeout_active:       false,
      shakeout_lod:          null,
      shakeout_reclaim_fired:false,
      added_at: new Date().toISOString(),
    };
  });
}
