import { getMemClient } from "@/memory/client";
import { getPositions } from "@/trading/broker/alpaca";
import { VARIANTS } from "@/strategies/config";
import type { VariantName, AlpacaPosition } from "@/shared/types";

export interface Disagreement {
  ticker: string;
  variants: Array<{
    variant: VariantName;
    branch: string;
    thesis: string;
    shares: number;
    side: "long" | "short" | "flat";
  }>;
  summary: string;
}

/**
 * Detects conflicting views on the same ticker across variant branches.
 * A disagreement exists when:
 *  - Two or more variants have different positions on the same ticker, OR
 *  - All three are positioned but at materially different conviction levels.
 */
export async function detectDisagreements(): Promise<Disagreement[]> {
  const [mem, positions] = await Promise.all([
    getMemClient(),
    getPositions(),
  ]);

  // Group positions by ticker
  const byTicker = new Map<string, AlpacaPosition[]>();
  for (const pos of positions) {
    const key = pos.symbol;
    if (!byTicker.has(key)) byTicker.set(key, []);
    byTicker.get(key)!.push(pos);
  }

  // Only tickers touched by multiple variant-keyed orders are interesting
  const disagreements: Disagreement[] = [];

  for (const ticker of byTicker.keys()) {
    const variantViews: Disagreement["variants"] = [];

    for (const variant of VARIANTS) {
      const pos = positions.find(
        (p) => p.symbol === ticker && p.qty !== "0"
      );
      const shares = pos ? parseInt(pos.qty) : 0;
      const side   = shares > 0 ? "long" : shares < 0 ? "short" : "flat";

      // Recall the latest thesis for this variant × ticker
      const recalled = await mem.recall(
        `entry thesis for ${ticker}`,
        { branch: variant.branch, limit: 1 }
      );
      const thesis = recalled[0]?.text ?? "(no thesis on record)";

      variantViews.push({ variant: variant.name, branch: variant.branch, thesis, shares, side });
    }

    // Disagreement: not all variants agree on direction or one is flat
    const sides = [...new Set(variantViews.map((v) => v.side))];
    const isDisagreement =
      sides.length > 1 ||
      variantViews.some((v) => v.side === "flat") ||
      variantViews.some((v, i, arr) =>
        Math.abs(v.shares - arr[0].shares) / (arr[0].shares || 1) > 0.25
      );

    if (isDisagreement) {
      const summary = variantViews
        .map((v) => `${v.variant}: ${v.side} ${Math.abs(v.shares)} shs — "${v.thesis.slice(0, 80)}"`)
        .join(" | ");

      disagreements.push({ ticker, variants: variantViews, summary });
    }
  }

  return disagreements;
}
