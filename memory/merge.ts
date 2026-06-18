import { getMemClient } from "./client";
import { MAIN_BRANCH, VARIANTS } from "@/strategies/config";
import { computeRMetrics } from "@/trading/metrics";
import type { ClosedTrade, RMetrics, VariantName } from "@/shared/types";

export interface SessionResult {
  variant: VariantName;
  trades: ClosedTrade[];
  metrics: RMetrics;
  rank: number;
}

/**
 * Rank variants by expectancy_r (avg R × win rate − avg loss R × loss rate).
 * More honest than raw return for small intraday samples.
 */
export function rankVariants(results: Omit<SessionResult, "rank">[]): SessionResult[] {
  return [...results]
    .sort((a, b) => b.metrics.expectancy_r - a.metrics.expectancy_r)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

/**
 * Distil a single durable rule from the winner's closed trades and
 * commit it as a lesson branch, then merge into strategy/main.
 *
 * This is gate part 2: a merge that measurably changes what
 * strategy/main knows. Losers are never merged.
 */
export async function promoteWinnerLesson(
  winner: SessionResult,
  windowId: string
): Promise<{ mergedCount: number; lessonBranch: string }> {
  const mem = await getMemClient();
  const winnerBranch = `strategy/${winner.variant}` as const;
  const lessonBranch = `strategy/${winner.variant}/lesson` as `strategy/${string}`;

  // Recall the winner's top patterns from its branch
  const recalled = await mem.recall(
    "what setups worked, what entry timing was most reliable, what to avoid",
    { branch: winnerBranch, limit: 8 }
  );
  const pattern = recalled.map((f: { text: string }) => f.text).join("\n");

  const m = winner.metrics;
  const facts = [
    `RULE from window ${windowId}: ${winner.variant} ranked #1 by expectancy (${m.expectancy_r.toFixed(2)}R).`,
    `Evidence: ${m.total_trades} trades | win rate ${(m.win_rate * 100).toFixed(0)}% | profit factor ${m.profit_factor.toFixed(2)} | avg R ${m.avg_r.toFixed(2)}.`,
    `Pattern: ${pattern}`,
    `Do not merge: ${VARIANTS.filter((v) => v.name !== winner.variant).map((v) => v.name).join(", ")} (losers this window — review their branches for cautionary context).`,
  ];

  // Stage on lesson branch
  await mem.branch(lessonBranch, { from: winnerBranch });
  await mem.commit(lessonBranch, {
    facts,
    message: `Window ${windowId} lesson — promote ${winner.variant}`,
  });

  // Merge into main
  const { mergedCount } = await mem.merge(lessonBranch, MAIN_BRANCH, {
    recallQueries: [
      "validated entry rules and risk-adjusted lessons",
      "what setups work and what to avoid",
    ],
  });

  return { mergedCount, lessonBranch };
}
