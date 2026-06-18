import { NextResponse } from "next/server";
import { rankVariants, promoteWinnerLesson } from "@/memory/merge";
import { computeRMetrics } from "@/trading/metrics";
import type { ClosedTrade, VariantName } from "@/shared/types";

/**
 * POST /api/session/close
 *
 * Called at end-of-day (or end of a test window) with the closed trades
 * from all three variant agents. Ranks by expectancy_r and promotes
 * the winner's lesson into strategy/main via MemForks merge.
 *
 * Body: { windowId: string, trades: ClosedTrade[] }
 */
export async function POST(req: Request) {
  const body = await req.json() as { windowId: string; trades: ClosedTrade[] };

  if (!body?.windowId || !Array.isArray(body?.trades)) {
    return NextResponse.json({ error: "windowId and trades[] required" }, { status: 400 });
  }

  // Group trades by variant
  const byVariant = new Map<VariantName, ClosedTrade[]>();
  for (const trade of body.trades) {
    if (!byVariant.has(trade.variant)) byVariant.set(trade.variant, []);
    byVariant.get(trade.variant)!.push(trade);
  }

  const results = Array.from(byVariant.entries()).map(([variant, trades]) => ({
    variant,
    trades,
    metrics: computeRMetrics(trades),
  }));

  const ranked = rankVariants(results);

  // Only merge if the winner has at least 3 trades and positive expectancy
  const winner = ranked[0];
  if (winner.metrics.total_trades < 3 || winner.metrics.expectancy_r <= 0) {
    return NextResponse.json({
      ok: true,
      message: "Not enough evidence to merge — winner did not clear minimum thresholds.",
      ranked: ranked.map((r) => ({
        rank: r.rank, variant: r.variant, metrics: r.metrics,
      })),
    });
  }

  try {
    const { mergedCount, lessonBranch } = await promoteWinnerLesson(winner, body.windowId);
    return NextResponse.json({
      ok: true,
      winner: winner.variant,
      lessonBranch,
      mergedCount,
      ranked: ranked.map((r) => ({
        rank: r.rank, variant: r.variant, metrics: r.metrics,
      })),
    });
  } catch (err) {
    console.error("[session/close] merge failed:", err);
    return NextResponse.json(
      { error: "merge failed", detail: String(err) },
      { status: 500 }
    );
  }
}
