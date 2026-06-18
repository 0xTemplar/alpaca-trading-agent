import { trading } from "./client";
import { getEquity } from "./account";
import type {
  AlpacaOrder,
  AlpacaActivity,
  SubmitOrderParams,
  OrderStatus,
} from "@/types";

export async function submitOrder(params: SubmitOrderParams): Promise<AlpacaOrder> {
  return trading.post<AlpacaOrder>("/v2/orders", params);
}

/**
 * Submits a market order sized as a percentage of current equity.
 * Enforces the 5% max position rule at the call site — callers should
 * also run checkRiskRules() before calling this.
 */
export async function submitMarketOrderByPct(
  symbol: string,
  side: "buy" | "sell",
  pct: number,
  clientOrderId?: string
): Promise<AlpacaOrder> {
  const equity = await getEquity();
  const notional = parseFloat((equity * (pct / 100)).toFixed(2));

  return submitOrder({
    symbol,
    notional,
    side,
    type: "market",
    time_in_force: "day",
    ...(clientOrderId ? { client_order_id: clientOrderId } : {}),
  });
}

export async function getOrders(
  status: OrderStatus | "open" | "closed" | "all" = "open"
): Promise<AlpacaOrder[]> {
  return trading.get<AlpacaOrder[]>(`/v2/orders?status=${status}&limit=100`);
}

export async function getOrder(orderId: string): Promise<AlpacaOrder> {
  return trading.get<AlpacaOrder>(`/v2/orders/${orderId}`);
}

export async function cancelOrder(orderId: string): Promise<void> {
  return trading.delete(`/v2/orders/${orderId}`);
}

export async function cancelAllOrders(): Promise<void> {
  return trading.delete("/v2/orders");
}

/**
 * Returns fill activities — the real trade history used by the risk engine
 * to compute Sharpe, Sortino, max drawdown, and hit rate.
 */
export async function getFills(after?: string): Promise<AlpacaActivity[]> {
  const params = new URLSearchParams({ activity_type: "FILL" });
  if (after) params.set("after", after);
  return trading.get<AlpacaActivity[]>(`/v2/account/activities?${params}`);
}
