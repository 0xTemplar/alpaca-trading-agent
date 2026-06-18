import { ChatOpenAI } from "@langchain/openai";
import { recallContext, commitThesis, commitPostmortem } from "@/memory/rules";
import { computeSize } from "@/trading/sizing";
import { enterPosition, executeScale, executeClose } from "@/trading/lifecycle";
import { getEquity, getDayPnl, getPosition, getSnapshots } from "@/trading/broker/alpaca";
import { checkEntry, processTick } from "@/scanner/orb-watcher";
import { env } from "@/shared/env";
import { isPastEOD, isNoTradeWindow, minutesFromOpen } from "@/shared/time";
import type { AgentState } from "./state";
import type { ClosedTrade } from "@/shared/types";

const llm = new ChatOpenAI({
  model: "gpt-4o-mini",
  temperature: 0.2,
  apiKey: env.OPENAI_API_KEY(),
});

// ── observe ───────────────────────────────────────────────────────────────────

/** Snapshot the watchlist and check if any signal fires for this variant. */
export async function observeNode(state: AgentState): Promise<Partial<AgentState>> {
  if (isNoTradeWindow()) {
    return { skipReason: "no-trade window (< 6 min from open)" };
  }

  const signals = await Promise.all(
    state.watchlist.map((entry) => checkEntry(entry, state.variant))
  );
  const signal = signals.find(Boolean) ?? null;
  return { signal };
}

// ── risk-gate ─────────────────────────────────────────────────────────────────

/** Hard gates: position already open, max concurrent, daily loss, past EOD. */
export async function riskGateNode(state: AgentState): Promise<Partial<AgentState>> {
  if (!state.signal) return { skipReason: "no signal" };

  if (isPastEOD(env.EOD_FLAT_TIME())) {
    return { skipReason: "past EOD flat time" };
  }

  const dayPnl = await getDayPnl();
  if (dayPnl <= -Math.abs(env.DAILY_LOSS_LIMIT())) {
    return { skipReason: `daily loss limit hit ($${dayPnl.toFixed(0)})` };
  }

  const existing = await getPosition(state.signal.ticker);
  if (existing && parseInt(existing.qty) !== 0) {
    return { skipReason: `already in ${state.signal.ticker}` };
  }

  return {};
}

// ── decide ────────────────────────────────────────────────────────────────────

/** Recall memory + generate thesis via LLM. */
export async function decideNode(state: AgentState): Promise<Partial<AgentState>> {
  if (!state.signal) return {};

  const { signal } = state;
  const ctx = await recallContext(
    state.variant,
    `should we enter ${signal.ticker} at ${signal.entry_price} — OR high ${signal.or_high} OR low ${signal.or_low}`
  );

  const systemPrompt = [
    `You are the ${state.variant} ORB trading agent.`,
    `House rules:\n${ctx.house.join("\n")}`,
    `Prior lessons for this variant:\n${ctx.variant.join("\n")}`,
    `Respond in 2–3 sentences: why do we enter here, what is the main risk?`,
  ].join("\n\n");

  const userPrompt = [
    `Ticker: ${signal.ticker}`,
    `Entry ask: ${signal.entry_price}`,
    `OR high: ${signal.or_high} | OR low: ${signal.or_low}`,
    `Conviction score: ${signal.conviction_score}/12`,
    `Minutes from open: ${minutesFromOpen().toFixed(1)}`,
  ].join("\n");

  const response = await llm.invoke([
    { role: "system", content: systemPrompt },
    { role: "user",   content: userPrompt },
  ]);

  const thesis = String(response.content);
  return { thesis };
}

// ── trade ─────────────────────────────────────────────────────────────────────

/** Size position, enter bracket, commit thesis. */
export async function tradeNode(state: AgentState): Promise<Partial<AgentState>> {
  if (!state.signal || !state.thesis) return { skipReason: "no signal or thesis" };

  const { signal } = state;
  const equity = await getEquity();
  const sizing = computeSize(
    signal.entry_price,
    signal.or_low,
    signal.conviction_score,
    equity
  );

  const tradeId = `${state.variant}_${signal.ticker}_${Date.now()}`;
  const result = await enterPosition(signal.ticker, state.variant, sizing, tradeId);

  if (result.kind === "failed") {
    return { skipReason: `entry failed: ${result.reason}` };
  }

  if (result.kind === "pending") {
    // Pending fill — agent will be resumed by fill-watcher; return partial state
    return { skipReason: `pending fill: ${result.pending.order_id}` };
  }

  const priorThesis = await recallContext(state.variant, `entry thesis for ${signal.ticker}`, 1);
  const convictionChange =
    priorThesis.variant.length === 0 ? "new" :
    priorThesis.variant[0].includes("do not") ? "reverses" : "confirms";

  await commitThesis(state.variant, state.thesis, {
    ticker: signal.ticker,
    entry:  result.position.entry_price,
    stop:   result.position.hard_stop,
    tradeId,
  }, convictionChange);

  return { position: result.position };
}

// ── manage ────────────────────────────────────────────────────────────────────

/** Check if position hit scale target and execute scale-out. */
export async function manageNode(state: AgentState): Promise<Partial<AgentState>> {
  if (!state.position) return {};

  const pos = state.position;
  if (pos.state !== "pre_scale") return {};

  const snaps = await getSnapshots([pos.ticker]);
  const bid = snaps[pos.ticker]?.latestQuote.bp ?? pos.entry_price;

  if (bid >= pos.scale_target) {
    const scaled = await executeScale(pos);
    return { position: scaled };
  }

  return {};
}

// ── exit ──────────────────────────────────────────────────────────────────────

/**
 * Mechanical exits: EOD flat, stop-price check (bracket handles live stops).
 * LangGraph calls this node at the end of each iteration.
 */
export async function exitNode(state: AgentState): Promise<Partial<AgentState>> {
  if (!state.position) return {};

  const pos = state.position;

  // EOD flat
  if (isPastEOD(env.EOD_FLAT_TIME())) {
    const snaps = await getSnapshots([pos.ticker]);
    const bid = snaps[pos.ticker]?.latestQuote.bp ?? pos.entry_price;
    const result = await executeClose(pos, "EOD", bid);
    return buildClosed(state, result.fill_price, result.pnl, result.pnl_r, result.pnl_pct, "EOD");
  }

  // Check if bracket stop was hit (Alpaca will have auto-closed)
  const alpacaPos = await getPosition(pos.ticker);
  if (!alpacaPos || parseInt(alpacaPos.qty) === 0) {
    // Position is gone — infer fill price from last trade
    const snaps = await getSnapshots([pos.ticker]);
    const closePrice = snaps[pos.ticker]?.latestTrade.p ?? pos.hard_stop;
    const pnl       = (closePrice - pos.entry_price) * pos.shares;
    const pnl_r     = pos.r_size ? pnl / (pos.r_size * pos.initial_shares) : 0;
    const pnl_pct   = (closePrice - pos.entry_price) / pos.entry_price;
    return buildClosed(state, closePrice, pnl, pnl_r, pnl_pct, "STOP_MISSED");
  }

  return {};
}

// ── postmortem ────────────────────────────────────────────────────────────────

/** LLM writes a postmortem; committed to the variant branch in MemForks. */
export async function postmortemNode(state: AgentState): Promise<Partial<AgentState>> {
  if (!state.closedTrade) return {};

  const trade = state.closedTrade;
  const prompt = [
    `Trade closed. What was surprising and what rule do we take away?`,
    `Ticker: ${trade.ticker} | P&L: $${trade.pnl.toFixed(2)} (${trade.pnl_r.toFixed(2)}R)`,
    `Entry thesis: ${trade.thesis}`,
    `Exit: ${trade.exit_reason}`,
    `Respond in 2 sentences max. Focus on a concrete rule to remember.`,
  ].join("\n");

  const response = await llm.invoke([{ role: "user", content: prompt }]);
  const surprises = String(response.content);

  await commitPostmortem(state.variant, {
    ticker:      trade.ticker,
    pnl:         trade.pnl,
    pnl_r:       trade.pnl_r,
    exit_reason: trade.exit_reason,
    thesis:      trade.thesis,
    surprises,
  });

  return { surprises };
}

// ── helpers ───────────────────────────────────────────────────────────────────

function buildClosed(
  state: AgentState,
  fillPrice: number,
  pnl: number,
  pnl_r: number,
  pnl_pct: number,
  reason: ClosedTrade["exit_reason"]
): Partial<AgentState> {
  const pos = state.position!;
  const closed: ClosedTrade = {
    trade_id:      pos.trade_id,
    ticker:        pos.ticker,
    variant:       pos.variant,
    entry_price:   pos.entry_price,
    exit_price:    fillPrice,
    shares:        pos.shares,
    initial_shares:pos.initial_shares,
    r_size:        pos.r_size,
    scaled_price:  pos.scaled_price,
    pnl,
    pnl_r,
    pnl_pct,
    exit_reason:   reason,
    entry_time:    pos.alpaca_entry_id,   // set to order id; replace with actual fill time
    exit_time:     new Date().toISOString(),
    thesis:        state.thesis,
  };
  return { position: null, closedTrade: closed, exitReason: reason };
}
