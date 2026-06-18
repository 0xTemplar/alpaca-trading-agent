import type { ClosedTrade, RMetrics } from "@/shared/types";

/**
 * R-based metrics. Annualized Sharpe is meaningless on intraday
 * day-trade samples. These are the numbers that actually matter:
 * avg R, win rate, profit factor, expectancy.
 */
export function computeRMetrics(trades: ClosedTrade[]): RMetrics {
  if (trades.length === 0) {
    return {
      avg_r: 0, win_rate: 0, profit_factor: 0,
      expectancy_r: 0, total_trades: 0,
      winning_trades: 0, losing_trades: 0, total_r: 0,
    };
  }

  const winners = trades.filter((t) => t.pnl_r > 0);
  const losers  = trades.filter((t) => t.pnl_r <= 0);

  const grossProfit = winners.reduce((s, t) => s + t.pnl_r, 0);
  const grossLoss   = Math.abs(losers.reduce((s, t) => s + t.pnl_r, 0));
  const totalR      = trades.reduce((s, t) => s + t.pnl_r, 0);

  const winRate       = winners.length / trades.length;
  const lossRate      = 1 - winRate;
  const avgWinR       = winners.length ? grossProfit / winners.length : 0;
  const avgLossR      = losers.length  ? grossLoss   / losers.length  : 0;
  const expectancy    = winRate * avgWinR - lossRate * avgLossR;

  return {
    avg_r:           round4(totalR / trades.length),
    win_rate:        round4(winRate),
    profit_factor:   grossLoss > 0 ? round4(grossProfit / grossLoss) : grossProfit > 0 ? Infinity : 0,
    expectancy_r:    round4(expectancy),
    total_trades:    trades.length,
    winning_trades:  winners.length,
    losing_trades:   losers.length,
    total_r:         round4(totalR),
  };
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
