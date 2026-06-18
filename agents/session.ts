import { buildAgentGraph } from "@/agents/graph";
import { VARIANTS } from "@/strategies/config";
import { buildWatchlist } from "@/scanner/gap-scanner";
import { isMarketHours, isPastEOD, nowET } from "@/shared/time";
import { env } from "@/shared/env";
import type { VariantName, WatchlistEntry, ClosedTrade } from "@/shared/types";

export interface SessionSummary {
  windowId:   string;
  startedAt:  string;
  endedAt:    string;
  closedTrades: ClosedTrade[];
  errors: Array<{ variant: VariantName; error: string }>;
}

/**
 * Run a single trading session for all three ORB variants in parallel.
 *
 * @param tickers — pre-screened gap-and-go candidates (from external screener or buildCandidates)
 * @param pollIntervalMs — how often each agent re-runs its graph (default: 15 s)
 *
 * The session keeps all three variant graphs alive and polling until EOD_FLAT_TIME.
 * Each variant graph runs independently; they share the watchlist state but make
 * independent entry decisions via their own MemForks branch context.
 */
export async function runSession(
  tickers: string[],
  pollIntervalMs = 15_000
): Promise<SessionSummary> {
  const windowId  = `${nowET().toISOString().slice(0, 10)}_${Date.now()}`;
  const startedAt = new Date().toISOString();
  const allClosed: ClosedTrade[] = [];
  const errors:    SessionSummary["errors"] = [];

  // Build initial watchlist with OR levels
  let watchlist: WatchlistEntry[] = await buildWatchlist(
    await import("@/scanner/gap-scanner").then((m) => m.buildCandidates(tickers))
  );

  // One compiled graph per variant (each has its own checkpointer branch)
  const graphs = await Promise.all(
    VARIANTS.map(async (v) => ({ variant: v.name, app: await buildAgentGraph() }))
  );

  // Session loop — runs until EOD
  while (!isPastEOD(env.EOD_FLAT_TIME())) {
    if (!isMarketHours()) {
      await sleep(60_000);
      continue;
    }

    // Run all three variants in parallel on the current watchlist snapshot
    await Promise.all(
      graphs.map(async ({ variant, app }) => {
        // Refresh watchlist state (caller should update tick-by-tick in production)
        const threadId = `${variant}/${Date.now()}`;
        try {
          const result = await app.invoke(
            { variant, watchlist, signal: null, thesis: "", surprises: "",
              position: null, closedTrade: null, exitReason: null,
              error: null, skipReason: null },
            { configurable: { thread_id: threadId } }
          );
          if (result.closedTrade) allClosed.push(result.closedTrade);
        } catch (err) {
          errors.push({ variant, error: String(err) });
          console.error(`[session] ${variant} error:`, err);
        }
      })
    );

    await sleep(pollIntervalMs);
  }

  return {
    windowId,
    startedAt,
    endedAt: new Date().toISOString(),
    closedTrades: allClosed,
    errors,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
