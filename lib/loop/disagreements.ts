import { getOrders } from "@/lib/broker/orders";
import { getMemClient } from "@/lib/memory/client";
import { parseStrategyFromOrderId } from "@/lib/risk/ledger";
import type { StrategyName, AlpacaOrder } from "@/types";

export interface StrategyPosition {
  strategy: StrategyName;
  side: "long" | "short";
  entryPrice: number;
  qty: number;
  thesis: string;
  orderId: string;
  filledAt: string;
}

export interface Disagreement {
  ticker: string;
  long: StrategyPosition;
  short: StrategyPosition;
  detectedAt: string;
}

/**
 * Builds a map of symbol → list of strategy positions by scanning
 * all filled orders and attributing each fill to its strategy via
 * the tagged client_order_id.
 */
async function buildPositionMap(): Promise<Map<string, StrategyPosition[]>> {
  const orders = await getOrders("all");
  const filled = orders.filter(
    (o) => o.status === "filled" && o.client_order_id
  );

  // Net per strategy/symbol: pair buys with sells to find open positions
  type NetKey = `${StrategyName}::${string}`;
  const net = new Map<NetKey, { qty: number; side: "buy" | "sell"; order: AlpacaOrder }>();

  for (const order of filled) {
    const strategy = parseStrategyFromOrderId(order.client_order_id ?? "");
    if (!strategy) continue;

    const key: NetKey = `${strategy}::${order.symbol}`;
    const existing = net.get(key);
    const qty = parseFloat(order.filled_qty);

    if (!existing) {
      net.set(key, { qty, side: order.side, order });
    } else {
      // Opposite side = closing trade, reduce net qty
      if (existing.side !== order.side) {
        const remaining = existing.qty - qty;
        if (remaining <= 0) {
          net.delete(key);
        } else {
          net.set(key, { ...existing, qty: remaining });
        }
      } else {
        // Same side = adding to position
        net.set(key, { ...existing, qty: existing.qty + qty });
      }
    }
  }

  const positionMap = new Map<string, StrategyPosition[]>();

  for (const [key, { qty, side, order }] of net.entries()) {
    if (qty <= 0) continue;
    const [strategy, symbol] = key.split("::") as [StrategyName, string];

    if (!positionMap.has(symbol)) positionMap.set(symbol, []);
    positionMap.get(symbol)!.push({
      strategy,
      side: side === "buy" ? "long" : "short",
      entryPrice: parseFloat(order.filled_avg_price ?? "0"),
      qty,
      thesis: "",   // filled in by recallTheses below
      orderId: order.id,
      filledAt: order.filled_at ?? order.created_at,
    });
  }

  return positionMap;
}

/**
 * For each disagreeing position, recalls the strategy's current thesis
 * from its MemForks branch so the Disagreement View can show what each
 * agent was thinking when it entered.
 */
async function recallTheses(
  positions: StrategyPosition[],
  ticker: string
): Promise<StrategyPosition[]> {
  const mem = await getMemClient();

  return Promise.all(
    positions.map(async (pos) => {
      const facts = await mem.recall(
        `current position thesis for ${ticker}`,
        { branch: `strategy/${pos.strategy}`, limit: 2 }
      );
      const thesis =
        facts.length > 0
          ? facts.map((f: { text: string }) => f.text).join(" | ")
          : "No thesis found in branch memory.";
      return { ...pos, thesis };
    })
  );
}

/**
 * Detects all current disagreements: symbols where at least two strategies
 * hold opposite sides (one long, one short) at the same time.
 *
 * This is the gate-satisfying moment: two branches, same ticker,
 * contradicting theses on the record simultaneously.
 */
export async function detectDisagreements(): Promise<Disagreement[]> {
  const positionMap = await buildPositionMap();
  const disagreements: Disagreement[] = [];

  for (const [ticker, positions] of positionMap.entries()) {
    const longs = positions.filter((p) => p.side === "long");
    const shorts = positions.filter((p) => p.side === "short");

    if (longs.length === 0 || shorts.length === 0) continue;

    // Recall theses for conflicting positions only (minimise API calls)
    const [enrichedLongs, enrichedShorts] = await Promise.all([
      recallTheses(longs, ticker),
      recallTheses(shorts, ticker),
    ]);

    // Pair each long with each short (usually just one of each, but handles multiples)
    for (const long of enrichedLongs) {
      for (const short of enrichedShorts) {
        disagreements.push({
          ticker,
          long,
          short,
          detectedAt: new Date().toISOString(),
        });
      }
    }
  }

  return disagreements;
}
