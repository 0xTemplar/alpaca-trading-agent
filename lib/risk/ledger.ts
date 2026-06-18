import { getFills } from "@/lib/broker/orders";
import { computeMetrics } from "./metrics";
import type { StrategyName, RiskMetrics, AlpacaActivity } from "@/types";
import type { ClosedTrade } from "./metrics";

/**
 * Generates a client_order_id that tags a fill with its originating strategy.
 * Format: `{strategy}::{symbol}::{side}::{timestamp}`
 *
 * Every order submitted by a strategy loop must use this as client_order_id
 * so the ledger can attribute fills back to their strategy.
 */
export function makeOrderId(
  strategy: StrategyName,
  symbol: string,
  side: "buy" | "sell"
): string {
  return `${strategy}::${symbol}::${side}::${Date.now()}`;
}

/**
 * Parses the strategy name out of a tagged client_order_id.
 * Returns null if the order was not tagged (e.g. manually placed orders).
 */
export function parseStrategyFromOrderId(
  clientOrderId: string
): StrategyName | null {
  const parts = clientOrderId.split("::");
  if (parts.length < 4) return null;
  return parts[0] as StrategyName;
}

/**
 * Fetches all fills since `after` and groups them by strategy.
 */
export async function getFillsByStrategy(
  after?: string
): Promise<Record<StrategyName, AlpacaActivity[]>> {
  const fills = await getFills(after);
  const grouped = {} as Record<StrategyName, AlpacaActivity[]>;

  for (const fill of fills) {
    const strategy = parseStrategyFromOrderId(fill.order_id);
    if (!strategy) continue;
    if (!grouped[strategy]) grouped[strategy] = [];
    grouped[strategy].push(fill);
  }

  return grouped;
}

/**
 * Converts raw fill activities into closed trades by matching buys to sells.
 * Handles both long (buy→sell) and short (sell→buy) round trips.
 * Partial fills are accumulated until the position is fully closed.
 */
export function fillsToClosedTrades(fills: AlpacaActivity[]): ClosedTrade[] {
  const sorted = [...fills].sort(
    (a, b) =>
      new Date(a.transaction_time).getTime() -
      new Date(b.transaction_time).getTime()
  );

  const trades: ClosedTrade[] = [];
  const openPositions: Map<
    string,
    { price: number; qty: number; side: "long" | "short"; time: string }
  > = new Map();

  for (const fill of sorted) {
    const symbol = fill.symbol;
    const price = parseFloat(fill.price);
    const qty = parseFloat(fill.qty);
    const side = fill.side;

    const open = openPositions.get(symbol);

    if (!open) {
      // Opening a position
      openPositions.set(symbol, {
        price,
        qty,
        side: side === "buy" ? "long" : "short",
        time: fill.transaction_time,
      });
    } else {
      // Closing a position
      trades.push({
        entryPrice: open.price,
        exitPrice: price,
        qty: Math.min(open.qty, qty),
        side: open.side,
        entryTime: open.time,
        exitTime: fill.transaction_time,
      });

      const remaining = open.qty - qty;
      if (remaining > 0.001) {
        openPositions.set(symbol, { ...open, qty: remaining });
      } else {
        openPositions.delete(symbol);
      }
    }
  }

  return trades;
}

/**
 * Computes risk metrics for a specific strategy over a window.
 * This is what Window Review calls to rank strategies before the merge.
 */
export async function getStrategyMetrics(
  strategy: StrategyName,
  after?: string
): Promise<RiskMetrics> {
  const grouped = await getFillsByStrategy(after);
  const fills = grouped[strategy] ?? [];
  const trades = fillsToClosedTrades(fills);
  return computeMetrics(trades);
}

/**
 * Computes metrics for all strategies and returns them ranked by Sharpe ratio.
 */
export async function rankStrategies(
  after?: string
): Promise<Array<{ strategy: StrategyName; metrics: RiskMetrics; rank: number }>> {
  const grouped = await getFillsByStrategy(after);

  const results = await Promise.all(
    (Object.entries(grouped) as [StrategyName, AlpacaActivity[]][]).map(
      async ([strategy, fills]) => {
        const trades = fillsToClosedTrades(fills);
        const metrics = computeMetrics(trades);
        return { strategy, metrics };
      }
    )
  );

  return results
    .sort((a, b) => b.metrics.sharpe - a.metrics.sharpe)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}
