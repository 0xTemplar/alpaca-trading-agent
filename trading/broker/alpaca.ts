import { env } from "@/shared/env";
import type { AlpacaOrder, AlpacaPosition, AlpacaAccount } from "@/shared/types";

class AlpacaError extends Error {
  constructor(public status: number, path: string, body: string) {
    super(`Alpaca ${status} ${path}: ${body}`);
    this.name = "AlpacaError";
  }
}

async function request<T>(
  base: string,
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      "APCA-API-KEY-ID": env.ALPACA_KEY(),
      "APCA-API-SECRET-KEY": env.ALPACA_SECRET(),
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    const body = await res.text();
    throw new AlpacaError(res.status, path, body);
  }
  return res.json() as Promise<T>;
}

const trade = {
  get:    <T>(path: string)              => request<T>(env.ALPACA_TRADE_URL(), path),
  post:   <T>(path: string, body: unknown) =>
    request<T>(env.ALPACA_TRADE_URL(), path, { method: "POST", body: JSON.stringify(body) }),
  delete: <T>(path: string)              =>
    request<T>(env.ALPACA_TRADE_URL(), path, { method: "DELETE" }),
};

const data = {
  get: <T>(path: string) =>
    request<T>("https://data.alpaca.markets", path),
};

// ── Account ────────────────────────────────────────────────────────────────────

export async function getAccount(): Promise<AlpacaAccount> {
  return trade.get("/v2/account");
}

export async function getEquity(): Promise<number> {
  const acct = await getAccount();
  return parseFloat(acct.equity);
}

export async function getDayPnl(): Promise<number> {
  const acct = await getAccount();
  const equity = parseFloat(acct.equity);
  const lastEquity = parseFloat(acct.last_equity);
  return equity - lastEquity;
}

// ── Positions ──────────────────────────────────────────────────────────────────

export async function getPositions(): Promise<AlpacaPosition[]> {
  return trade.get("/v2/positions");
}

export async function getPosition(symbol: string): Promise<AlpacaPosition | null> {
  try {
    return await trade.get<AlpacaPosition>(`/v2/positions/${symbol.toUpperCase()}`);
  } catch (e) {
    if (e instanceof AlpacaError && e.status === 404) return null;
    throw e;
  }
}

// ── Orders ─────────────────────────────────────────────────────────────────────

/** Format price string — more decimal places on sub-$1 names. */
export function fmtPrice(p: number): string {
  return Math.abs(p) < 1 ? p.toFixed(4) : p.toFixed(2);
}

/** Bracket order: market entry + take_profit TP + stop_loss SL. */
export async function submitBracket(
  ticker: string,
  qty: number,
  finalTarget: number,
  hardStop: number,
  clientOrderId: string
): Promise<AlpacaOrder> {
  return trade.post("/v2/orders", {
    symbol: ticker,
    qty: String(qty),
    side: "buy",
    type: "market",
    time_in_force: "day",
    order_class: "bracket",
    take_profit: { limit_price: fmtPrice(finalTarget) },
    stop_loss:   { stop_price:  fmtPrice(hardStop) },
    client_order_id: clientOrderId,
  });
}

export async function submitMarketSell(
  ticker: string,
  qty: number,
  clientOrderId: string
): Promise<AlpacaOrder> {
  return trade.post("/v2/orders", {
    symbol: ticker,
    qty: String(qty),
    side: "sell",
    type: "market",
    time_in_force: "day",
    client_order_id: clientOrderId,
  });
}

export async function submitTrailingStop(
  ticker: string,
  qty: number,
  trailPercent: number,
  clientOrderId: string
): Promise<AlpacaOrder> {
  return trade.post("/v2/orders", {
    symbol: ticker,
    qty: String(qty),
    side: "sell",
    type: "trailing_stop",
    time_in_force: "day",
    trail_percent: String(trailPercent),
    client_order_id: clientOrderId,
  });
}

export async function getOrder(orderId: string): Promise<AlpacaOrder | null> {
  try {
    return await trade.get<AlpacaOrder>(`/v2/orders/${orderId}`);
  } catch (e) {
    if (e instanceof AlpacaError && e.status === 404) return null;
    throw e;
  }
}

export async function cancelOrder(orderId: string): Promise<boolean> {
  try {
    await trade.delete(`/v2/orders/${orderId}`);
    return true;
  } catch {
    return false;
  }
}

export async function isAssetTradable(symbol: string): Promise<boolean> {
  try {
    const asset = await trade.get<{ tradable: boolean }>(
      `/v2/assets/${symbol.toUpperCase()}`
    );
    return asset.tradable;
  } catch {
    return true; // assume tradable on API errors — don't block orders
  }
}

/**
 * Poll until order is filled or timeout elapses.
 * Returns fill price or null on timeout.
 */
export async function waitForFill(
  orderId: string,
  timeoutMs = 15_000
): Promise<number | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const order = await getOrder(orderId);
    if (order?.status === "filled" && order.filled_avg_price) {
      return parseFloat(order.filled_avg_price);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

// ── Market data ─────────────────────────────────────────────────────────────────

export async function getORBars(
  tickers: string[],
  tradeDate: string   // "YYYY-MM-DD" in ET
): Promise<Record<string, { or_high: number; or_low: number }>> {
  if (tickers.length === 0) return {};
  const feed = env.ALPACA_DATA_FEED();
  const params = new URLSearchParams({
    symbols:   tickers.join(","),
    timeframe: "1Min",
    start:     `${tradeDate}T09:30:00-04:00`,
    end:       `${tradeDate}T09:31:00-04:00`,
    feed,
    limit:     String(Math.max(tickers.length * 3, 50)),
  });
  const res = await data.get<{ bars: Record<string, { h: number; l: number }[]> }>(
    `/v2/stocks/bars?${params}`
  );
  const out: Record<string, { or_high: number; or_low: number }> = {};
  for (const [ticker, bars] of Object.entries(res.bars ?? {})) {
    if (bars.length > 0) {
      out[ticker] = { or_high: bars[0].h, or_low: bars[0].l };
    }
  }
  return out;
}

export async function getSnapshots(
  tickers: string[]
): Promise<Record<string, { latestTrade: { p: number }; dailyBar: { v: number; c: number }; prevDailyBar: { c: number }; latestQuote: { ap: number; bp: number } }>> {
  if (tickers.length === 0) return {};
  const feed = env.ALPACA_DATA_FEED();
  const params = new URLSearchParams({ symbols: tickers.join(","), feed });
  const res = await data.get<{ snapshots: Record<string, unknown> }>(
    `/v2/stocks/snapshots?${params}`
  );
  return (res.snapshots ?? {}) as ReturnType<typeof getSnapshots> extends Promise<infer R> ? R : never;
}
