import type { StrategyConfig, HouseRule } from "@/types";

/**
 * House rules seeded into strategy/main.
 * These are inherited by every strategy branch and enforced in the risk-check node
 * before any order is submitted — they are not advisory, they gate real orders.
 */
export const HOUSE_RULES: HouseRule[] = [
  { fact: "Max position size: 5% of current account equity per ticker." },
  { fact: "Max portfolio exposure: 25% gross notional across all open positions." },
  { fact: "Hard stop-loss: exit any position that moves 2% against entry. No exceptions." },
  { fact: "No new entries in the first 15 minutes after market open (9:30–9:45 ET)." },
  { fact: "Max daily loss: 3% of opening equity. If breached, halt all new entries for the session." },
  { fact: "Record a postmortem commit after every closed position: entry thesis, exit reason, what surprised you." },
  { fact: "Do not size into illiquid tickers — require 30-day avg daily volume > 1M shares." },
];

export const STRATEGIES: StrategyConfig[] = [
  {
    name: "momentum",
    branch: "strategy/momentum",
    description: "Trend-following breakout strategy. Buys tickers printing 20-day highs on above-average volume (1.5x 20-day avg). Uses a 10/30 EMA crossover as trend filter — only long when 10 EMA > 30 EMA. Sizes up proportionally to relative strength vs SPY. Trails stop at ATR(14) x 2.",
    universe: ["NVDA", "AMD", "TSLA", "META", "MSFT", "AAPL", "AMZN", "GOOGL", "NFLX", "CRM"],
    params: {
      breakoutLookback: 20,
      volumeMultiplier: 1.5,
      emaFast: 10,
      emaSlow: 30,
      atrMultiplier: 2,
      atrPeriod: 14,
    },
  },
  {
    name: "mean-reversion",
    branch: "strategy/mean-reversion",
    description: "Fades extreme intraday moves. Enters short when RSI(14) > 75 and price is > 2 standard deviations above the 20-period VWAP band. Enters long when RSI(14) < 25 and price is < 2 std devs below VWAP band. Target: reversion to VWAP. Hard exit if move extends beyond 3 std devs.",
    universe: ["NVDA", "AMD", "TSLA", "META", "MSFT", "AAPL", "AMZN", "GOOGL", "NFLX", "CRM"],
    params: {
      rsiPeriod: 14,
      rsiOverbought: 75,
      rsiOversold: 25,
      vwapBandStdDev: 2,
      exitStdDev: 3,
    },
  },
  {
    name: "news-aware",
    branch: "strategy/news-aware",
    description: "Catalyst-driven trades triggered by material news events. Uses sentiment scoring on headlines — enters in the direction of strong positive/negative sentiment (score > 0.7 or < -0.7) only when the move has not yet exceeded 3% from prior close. Avoids earnings days for new entries; runs a postmortem within 30 minutes of any earnings print.",
    universe: ["NVDA", "AMD", "TSLA", "META", "MSFT", "AAPL", "AMZN", "GOOGL", "NFLX", "CRM"],
    params: {
      sentimentThreshold: 0.7,
      maxPreMovePercent: 3,
      avoidEarnings: true,
    },
  },
  {
    name: "risk-parity",
    branch: "strategy/risk-parity",
    description: "Equal risk contribution across asset classes. Allocates notional inversely proportional to each ticker's realized 20-day volatility so every position contributes the same dollar vol to the portfolio. Rebalances daily. Shifts allocation toward lower-vol assets when VIX > 25.",
    universe: ["SPY", "QQQ", "IWM", "TLT", "GLD", "XLE", "XLK", "XLF", "XLV", "XLI"],
    params: {
      volLookback: 20,
      rebalanceFreqHours: 24,
      vixFlightThreshold: 25,
    },
  },
  {
    name: "sector-rotation",
    branch: "strategy/sector-rotation",
    description: "Relative-strength rotation across SPDR sector ETFs. Ranks sectors by 4-week risk-adjusted momentum (return / realized vol). Long the top 2 sectors, flat or short the bottom 2. Rotates weekly. Sector RS must exceed SPY RS by at least 1.5% before entering — avoids noise-driven rotations.",
    universe: ["XLK", "XLF", "XLV", "XLE", "XLI", "XLU", "XLP", "XLB", "XLRE", "XLC"],
    params: {
      rankingPeriodWeeks: 4,
      longCount: 2,
      shortCount: 2,
      minExcessRS: 1.5,
      rotationFreqDays: 7,
    },
  },
];

export const MAIN_BRANCH = "strategy/main" as const;

export const STRATEGY_BRANCHES = STRATEGIES.map((s) => s.branch);
