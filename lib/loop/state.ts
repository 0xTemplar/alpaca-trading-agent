import { Annotation } from "@langchain/langgraph";
import type { StrategyName, TradeSignal } from "@/types";
import type { RiskCheckResult } from "@/lib/risk/rules";

export const StrategyStateAnnotation = Annotation.Root({
  // ── Identity ────────────────────────────────────────────────────────────
  strategy: Annotation<StrategyName>,
  sessionOpenEquity: Annotation<number>,

  // ── observe node ────────────────────────────────────────────────────────
  observation: Annotation<string>,

  // ── recall node ─────────────────────────────────────────────────────────
  recalledFacts: Annotation<string[]>,

  // ── decide node ─────────────────────────────────────────────────────────
  signal: Annotation<TradeSignal | null>,

  // ── risk-check node ─────────────────────────────────────────────────────
  riskResult: Annotation<RiskCheckResult | null>,
  // Final notional after any risk clamping
  approvedNotional: Annotation<number | null>,

  // ── trade node ──────────────────────────────────────────────────────────
  orderId: Annotation<string | null>,
  // Symbol of a position that just closed this tick (triggers postmortem)
  closedSymbol: Annotation<string | null>,
  closedPnl: Annotation<number | null>,

  // ── record / postmortem nodes ────────────────────────────────────────────
  committedBranch: Annotation<string | null>,
  errors: Annotation<string[]>,
});

export type StrategyState = typeof StrategyStateAnnotation.State;
