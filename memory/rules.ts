import { getMemClient } from "./client";
import type { VariantName } from "@/shared/types";

/**
 * Recall facts from a variant branch + house rules from main.
 * Used by the agents node before generating a thesis.
 */
export async function recallContext(
  variant: VariantName,
  query: string,
  limit = 5
): Promise<{ house: string[]; variant: string[] }> {
  const mem = await getMemClient();
  const branch = `strategy/${variant}` as const;

  const [houseFacts, variantFacts] = await Promise.all([
    mem.recall("trading rules and house risk rules", { branch: "strategy/main", limit: 4 }),
    mem.recall(query, { branch, limit }),
  ]);

  return {
    house:   houseFacts.map((f: { text: string }) => f.text),
    variant: variantFacts.map((f: { text: string }) => f.text),
  };
}

/**
 * Commit a confirmed entry thesis to the variant branch.
 * If convictionChange = "reverses", forks a conviction branch first
 * so the prior thesis is preserved.
 */
export async function commitThesis(
  variant: VariantName,
  thesis: string,
  meta: { ticker: string; entry: number; stop: number; tradeId: string },
  convictionChange: "new" | "confirms" | "reverses"
): Promise<string> {
  const mem = await getMemClient();
  const branch = `strategy/${variant}` as const;
  const facts = [
    `Ticker: ${meta.ticker} | Entry: ${meta.entry} | Stop: ${meta.stop} | Trade: ${meta.tradeId}`,
    `Thesis: ${thesis}`,
    `Conviction: ${convictionChange}`,
  ];

  if (convictionChange === "reverses") {
    const convBranch = `strategy/${variant}/conviction@${Date.now()}`;
    await mem.branch(convBranch, { from: branch });
    await mem.commit(convBranch, {
      facts: [`REVERSAL: ${thesis}`, ...facts.slice(1)],
      message: `Conviction reversal — ${meta.ticker}`,
    });
    return convBranch;
  }

  await mem.commit(branch, {
    facts,
    message: `${convictionChange === "new" ? "Entry" : "Confirmed"} — ${meta.ticker}`,
  });
  return branch;
}

/**
 * Commit a postmortem after a position closes.
 * This is always an append — it's what actually happened, not a belief change.
 */
export async function commitPostmortem(
  variant: VariantName,
  data: {
    ticker: string;
    pnl: number;
    pnl_r: number;
    exit_reason: string;
    thesis: string;
    surprises: string;
  }
): Promise<void> {
  const mem = await getMemClient();
  const branch = `strategy/${variant}` as const;
  await mem.commit(branch, {
    facts: [
      `POSTMORTEM: ${data.ticker} closed. P&L: $${data.pnl.toFixed(2)} (${data.pnl_r.toFixed(2)}R) | Exit: ${data.exit_reason}`,
      `Entry thesis: ${data.thesis}`,
      data.surprises ? `Surprises: ${data.surprises}` : "Surprises: none noted.",
    ],
    message: `Postmortem — ${data.ticker} ${data.exit_reason}`,
  });
}
