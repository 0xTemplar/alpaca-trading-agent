import {
  submitBracket,
  submitMarketSell,
  submitTrailingStop,
  getOrder,
  cancelOrder,
  waitForFill,
  getPosition,
} from "@/trading/broker/alpaca";
import { env } from "@/shared/env";
import type { Position, PendingFill, SizingResult, VariantName, ExitReason } from "@/shared/types";

/**
 * Port of order_flow.py.
 *
 * Enter → scale (half at 1R) → trailing_stop on remainder → close.
 * All exits are mechanical; the LLM only writes the thesis before entry
 * and the postmortem after close.
 */

const ALIVE_STATUSES = new Set([
  "new", "accepted", "pending_new", "held", "partially_filled",
]);

// ── Enter ──────────────────────────────────────────────────────────────────────

export type EnterResult =
  | { kind: "position"; position: Position }
  | { kind: "pending"; pending: PendingFill }
  | { kind: "failed"; reason: string };

export async function enterPosition(
  ticker: string,
  variant: VariantName,
  sizing: SizingResult,
  tradeId: string
): Promise<EnterResult> {
  const clientOrderId = `${tradeId}_entry`;
  let order = await submitBracket(
    ticker,
    sizing.shares,
    sizing.final_target,
    sizing.r_size,   // hard stop = entry - R (OR low)
    clientOrderId
  );

  if (!order) return { kind: "failed", reason: "bracket order rejected by Alpaca" };

  const orderId = order.id;
  let fillPrice = await waitForFill(orderId, 15_000);

  if (!fillPrice) {
    const refreshed = await getOrder(orderId);
    const status = refreshed?.status ?? "";

    if (!refreshed || ALIVE_STATUSES.has(status)) {
      // Likely a halt — don't cancel, defer to pending_fill_watcher
      return {
        kind: "pending",
        pending: {
          trade_id: tradeId,
          ticker,
          variant,
          order_id: orderId,
          shares: sizing.shares,
          initial_shares: sizing.shares,
          hard_stop: sizing.r_size,
          scale_target: sizing.scale_target,
          final_target: sizing.final_target,
          r_size: sizing.r_size,
          submitted_at: new Date().toISOString(),
          deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
        },
      };
    }

    if (status !== "filled") {
      await cancelOrder(orderId);
      return { kind: "failed", reason: `order ${status}` };
    }

    fillPrice = parseFloat(refreshed.filled_avg_price ?? "0") || null;

    if (!fillPrice) {
      const pos = await getPosition(ticker);
      fillPrice = pos ? parseFloat(pos.avg_entry_price) : null;
    }

    if (!fillPrice) {
      // Order filled but price unrecoverable — don't cancel
      return { kind: "failed", reason: "filled but fill price unavailable — check Alpaca" };
    }
  }

  const expectedEntry = sizing.r_size; // OR high = stop + R
  const deviationPct = expectedEntry > 0
    ? (fillPrice - expectedEntry) / expectedEntry
    : 0;
  const stale = Math.abs(deviationPct) > 0.05;

  return {
    kind: "position",
    position: {
      trade_id: tradeId,
      ticker,
      variant,
      shares: sizing.shares,
      initial_shares: sizing.shares,
      entry_price: fillPrice,
      hard_stop: sizing.r_size,   // re-derived from sizing; OR low
      scale_target: sizing.scale_target,
      final_target: sizing.final_target,
      r_size: sizing.r_size,
      state: "pre_scale",
      alpaca_entry_id: orderId,
      alpaca_oco_id: null,
      scaled_at: null,
      scaled_price: null,
      stale_bracket: stale,
    },
  };
}

// ── Scale ──────────────────────────────────────────────────────────────────────

export async function executeScale(position: Position): Promise<Position> {
  const scaleQty = Math.floor(position.shares / 2);
  const remainQty = position.shares - scaleQty;

  // Cancel bracket child legs first
  const bracket = await getOrder(position.alpaca_entry_id);
  if (bracket?.legs) {
    for (const leg of bracket.legs) {
      const ok = await cancelOrder(leg.id);
      if (!ok) {
        // Retry once after short pause
        await new Promise((r) => setTimeout(r, 1_000));
        await cancelOrder(leg.id);
      }
    }
    // Wait briefly for cancels to settle
    await new Promise((r) => setTimeout(r, 500));
  }

  const scaleOid = `${position.trade_id}_scale`;
  const scaleOrder = await submitMarketSell(position.ticker, scaleQty, scaleOid);
  if (!scaleOrder) {
    console.error(`[lifecycle] scale market sell failed for ${position.ticker}`);
    return position;
  }

  const scalePrice =
    (await waitForFill(scaleOrder.id, 10_000)) ?? position.scale_target;

  const trailOid = `${position.trade_id}_trail`;
  const trailOrder = await submitTrailingStop(
    position.ticker,
    remainQty,
    env.TRAIL_PERCENT(),
    trailOid
  );

  if (!trailOrder) {
    // One retry
    await new Promise((r) => setTimeout(r, 500));
    const retry = await submitTrailingStop(
      position.ticker,
      remainQty,
      env.TRAIL_PERCENT(),
      `${trailOid}2`
    );
    if (!retry) {
      console.error(`[lifecycle] trailing_stop failed for ${position.ticker} — position unprotected!`);
    }
  }

  return {
    ...position,
    shares: remainQty,
    state: "trailing",
    scaled_at: new Date().toISOString(),
    scaled_price: scalePrice,
    alpaca_oco_id: trailOrder?.id ?? null,
  };
}

// ── Close ──────────────────────────────────────────────────────────────────────

export interface CloseResult {
  fill_price: number;
  pnl: number;
  pnl_r: number;
  pnl_pct: number;
  exit_reason: ExitReason;
}

export async function executeClose(
  position: Position,
  reason: ExitReason,
  currentPrice: number
): Promise<CloseResult> {
  // Cancel any protective orders
  if (position.state === "pre_scale") {
    const bracket = await getOrder(position.alpaca_entry_id);
    if (bracket?.legs) {
      for (const leg of bracket.legs) {
        const ok = await cancelOrder(leg.id);
        if (!ok) {
          await new Promise((r) => setTimeout(r, 1_000));
          await cancelOrder(leg.id);
        }
      }
    }
  } else if (position.alpaca_oco_id) {
    const ok = await cancelOrder(position.alpaca_oco_id);
    if (!ok) {
      await new Promise((r) => setTimeout(r, 1_000));
      await cancelOrder(position.alpaca_oco_id);
    }
  }

  const closeOid = `${position.trade_id}_close`;
  const closeOrder = await submitMarketSell(position.ticker, position.shares, closeOid);

  let fillPrice = currentPrice;
  if (closeOrder) {
    const fill = await waitForFill(closeOrder.id, 10_000);
    if (fill) fillPrice = fill;
  }

  // R-multiple PnL accounting — handles scale-out correctly
  const entry = position.entry_price;
  const r = position.r_size;
  const initial = position.initial_shares;

  let pnl: number;
  if (
    position.state !== "pre_scale" &&
    position.scaled_price != null
  ) {
    const half = Math.floor(initial / 2);
    pnl = (position.scaled_price - entry) * half +
          (fillPrice - entry) * position.shares;
  } else {
    pnl = (fillPrice - entry) * position.shares;
  }

  const pnl_r   = r && initial ? round4(pnl / (r * initial)) : 0;
  const pnl_pct = entry ? round4((fillPrice - entry) / entry) : 0;

  return { fill_price: fillPrice, pnl: round4(pnl), pnl_r, pnl_pct, exit_reason: reason };
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
