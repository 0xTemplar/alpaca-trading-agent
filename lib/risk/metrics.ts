import type { RiskMetrics } from "@/types";

export interface ClosedTrade {
  entryPrice: number;
  exitPrice: number;
  qty: number;
  side: "long" | "short";
  entryTime: string;
  exitTime: string;
}

const ANNUALIZATION_FACTOR = Math.sqrt(252);
const RISK_FREE_DAILY = 0.05 / 252; // 5% annual → daily

/**
 * Computes all risk-adjusted metrics from a list of closed trades.
 * These are the metrics used by the Window Review to rank strategies
 * and determine which lesson gets merged into strategy/main.
 */
export function computeMetrics(trades: ClosedTrade[]): RiskMetrics {
  if (trades.length === 0) {
    return {
      sharpe: 0,
      sortino: 0,
      maxDrawdown: 0,
      hitRate: 0,
      profitFactor: 0,
      totalTrades: 0,
    };
  }

  const returns = trades.map((t) => tradeReturn(t));

  return {
    sharpe: sharpeRatio(returns),
    sortino: sortinoRatio(returns),
    maxDrawdown: maxDrawdown(returns),
    hitRate: hitRate(returns),
    profitFactor: profitFactor(returns),
    totalTrades: trades.length,
  };
}

function tradeReturn(trade: ClosedTrade): number {
  const raw =
    trade.side === "long"
      ? (trade.exitPrice - trade.entryPrice) / trade.entryPrice
      : (trade.entryPrice - trade.exitPrice) / trade.entryPrice;
  return raw;
}

function mean(arr: number[]): number {
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function stdDev(arr: number[], avg = mean(arr)): number {
  const variance = arr.reduce((s, v) => s + (v - avg) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

function sharpeRatio(returns: number[]): number {
  const avg = mean(returns);
  const sd = stdDev(returns, avg);
  if (sd === 0) return 0;
  return ((avg - RISK_FREE_DAILY) / sd) * ANNUALIZATION_FACTOR;
}

function sortinoRatio(returns: number[]): number {
  const avg = mean(returns);
  const downsideReturns = returns.filter((r) => r < RISK_FREE_DAILY);
  if (downsideReturns.length === 0) return avg > 0 ? Infinity : 0;
  const downsideDeviation = stdDev(downsideReturns, RISK_FREE_DAILY);
  if (downsideDeviation === 0) return 0;
  return ((avg - RISK_FREE_DAILY) / downsideDeviation) * ANNUALIZATION_FACTOR;
}

/**
 * Maximum peak-to-trough drawdown on the compounded equity curve.
 * Returns as a positive percentage (e.g. 0.12 = 12% drawdown).
 */
function maxDrawdown(returns: number[]): number {
  let peak = 1;
  let equity = 1;
  let maxDD = 0;

  for (const r of returns) {
    equity *= 1 + r;
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak;
    if (dd > maxDD) maxDD = dd;
  }

  return maxDD;
}

function hitRate(returns: number[]): number {
  const winners = returns.filter((r) => r > 0).length;
  return winners / returns.length;
}

function profitFactor(returns: number[]): number {
  const grossProfit = returns.filter((r) => r > 0).reduce((s, r) => s + r, 0);
  const grossLoss = Math.abs(
    returns.filter((r) => r < 0).reduce((s, r) => s + r, 0)
  );
  if (grossLoss === 0) return grossProfit > 0 ? Infinity : 0;
  return grossProfit / grossLoss;
}
