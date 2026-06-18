import { marketData } from "@/lib/broker/client";
import type { Bar, Quote, Snapshot } from "@/types";

/**
 * Fetch historical minute or daily bars for a single symbol.
 * @param timeframe  "1Min" | "5Min" | "1Hour" | "1Day"
 * @param limit      number of bars to return (max 10000)
 */
export async function getBars(
  symbol: string,
  timeframe: "1Min" | "5Min" | "1Hour" | "1Day" = "1Day",
  limit = 30
): Promise<Bar[]> {
  const params = new URLSearchParams({
    timeframe,
    limit: String(limit),
    adjustment: "raw",
    feed: "iex",
  });
  const res = await marketData.get<{ bars: Bar[] }>(
    `/v2/stocks/${symbol}/bars?${params}`
  );
  return res.bars ?? [];
}

/**
 * Fetch bars for multiple symbols in one request.
 * Returns a map of symbol → Bar[].
 */
export async function getMultiBars(
  symbols: string[],
  timeframe: "1Min" | "5Min" | "1Hour" | "1Day" = "1Day",
  limit = 30
): Promise<Record<string, Bar[]>> {
  const params = new URLSearchParams({
    symbols: symbols.join(","),
    timeframe,
    limit: String(limit),
    adjustment: "raw",
    feed: "iex",
  });
  const res = await marketData.get<{ bars: Record<string, Bar[]> }>(
    `/v2/stocks/bars?${params}`
  );
  return res.bars ?? {};
}

/**
 * Latest NBBO quote for a symbol.
 */
export async function getLatestQuote(symbol: string): Promise<Quote> {
  const res = await marketData.get<{ quote: Quote }>(
    `/v2/stocks/${symbol}/quotes/latest?feed=iex`
  );
  return res.quote;
}

/**
 * Snapshot: latest trade, latest quote, minute bar, daily bar, prev daily bar.
 * The fastest single-call way to get current market context for a symbol.
 */
export async function getSnapshot(symbol: string): Promise<Snapshot> {
  const res = await marketData.get<{ snapshot: Snapshot }>(
    `/v2/stocks/${symbol}/snapshot?feed=iex`
  );
  return res.snapshot;
}

/**
 * Snapshots for multiple symbols in one request.
 */
export async function getMultiSnapshots(
  symbols: string[]
): Promise<Record<string, Snapshot>> {
  const params = new URLSearchParams({ symbols: symbols.join(","), feed: "iex" });
  const res = await marketData.get<{ snapshots: Record<string, Snapshot> }>(
    `/v2/stocks/snapshots?${params}`
  );
  return res.snapshots ?? {};
}
