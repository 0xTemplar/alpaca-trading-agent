import type { VariantName } from "@/shared/types";

export interface VariantConfig {
  name: VariantName;
  branch: `strategy/${VariantName}`;
  description: string;
  /**
   * Entry rule — determines when the variant fires on a watchlist ticker.
   * Execution (sizing, bracket, scaling, exits) is identical across all variants.
   * Only the entry timing and thesis differ.
   */
  entryRule: string;
}

export const VARIANTS: VariantConfig[] = [
  {
    name: "orb-immediate",
    branch: "strategy/orb-immediate",
    description:
      "Enters the moment price breaks above OR high after the 6-minute gate. " +
      "Thesis: strong-momentum names hold the break and trend. " +
      "Risk: chasing extended moves on low-quality setups.",
    entryRule:
      "Enter when ask > or_high AND minutes_from_open >= ORB_MIN_MINS AND orb_triggered=false.",
  },
  {
    name: "orb-retest",
    branch: "strategy/orb-retest",
    description:
      "Waits for price to break OR high, pull back toward it, then reclaim from above. " +
      "Thesis: the pullback shakes out weak hands and offers a tighter stop. " +
      "Risk: missing moves that never pull back.",
    entryRule:
      "Enter after orb_triggered=true AND price has pulled back within 1% of or_high " +
      "AND ask has reclaimed above or_high again (retest qualified).",
  },
  {
    name: "orb-shakeout",
    branch: "strategy/orb-shakeout",
    description:
      "Only enters after a shakeout: price breaks OR high, flushes below OR low, " +
      "then reclaims OR low from beneath. " +
      "Thesis: shakeouts flush retail stops and create a clean second-leg entry. " +
      "Risk: the shakeout may signal a failed break rather than a reset.",
    entryRule:
      "Enter only after shakeout_reclaim_fired=true: price broke OR high, " +
      "dipped below or_low * 0.995, then reclaimed or_low.",
  },
];

/** House rules seeded into strategy/main — every variant inherits these. */
export const HOUSE_RULES: string[] = [
  "Max position size: 5% of current equity, hard-capped at MAX_POSITION_USD.",
  "Every entry is a bracket order: market in, take_profit at 2R, stop_loss at OR low.",
  "Scale out half at 1R; trail the remainder at TRAIL_PERCENT%.",
  "Hard stop: exit any position that hits OR low. No averaging down.",
  "No new entries in the first 6 minutes after the open (9:30–9:36 ET).",
  "EOD flat: all positions closed by 15:55 ET.",
  "Daily loss limit: halt new entries if realized P&L reaches -DAILY_LOSS_LIMIT.",
  "Post a postmortem commit after every closed trade: entry thesis, exit reason, what surprised you.",
  "Only trade tickers from the gap-and-go scanner with conviction_score >= 7 and a catalyst.",
];

export const MAIN_BRANCH = "strategy/main" as const;
export const VARIANT_BRANCHES = VARIANTS.map((v) => v.branch);
