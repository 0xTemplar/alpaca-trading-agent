import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { withMemForks } from "@memfork/vercel-ai";
import { commitThesis, commitPostmortem } from "@/memory/rules";
import { computeSize } from "@/trading/sizing";
import { enterPosition, executeScale, executeClose } from "@/trading/lifecycle";
import {
  getEquity, getDayPnl, getPosition, getSnapshots,
} from "@/trading/broker/alpaca";
import { checkEntry } from "@/scanner/orb-watcher";
import { env } from "@/shared/env";
import { isPastEOD, isNoTradeWindow, minutesFromOpen } from "@/shared/time";
import type { AgentState } from "./state";
import type { ClosedTrade, WatchlistEntry } from "@/shared/types";

// Shared MemForks connection options — re-used in withMemForks calls
function memConfig(branch: string) {
  return {
    treeId:  env.MEMFORK_TREE_ID(),
    signer:  env.MEMFORK_PRIVATE_KEY(),
    memwal: {
      accountId:   env.MEMFORK_MEMWAL_ACCOUNT(),
      delegateKey: env.MEMFORK_MEMWAL_KEY(),
    },
    branch,
  };
}

// ── observe ───────────────────────────────────────────────────────────────────

export async function observeNode(state: AgentState): Promise<Partial<AgentState>> {
  if (isNoTradeWindow()) {
    return { skipReason: "no-trade window (< 6 min from open)" };
  }
  const signals = await Promise.all(
    state.watchlist.map((entry: WatchlistEntry) => checkEntry(entry, state.variant))
  );
  const signal = signals.find(Boolean) ?? null;
  return { signal };
}

// ── risk-gate ─────────────────────────────────────────────────────────────────

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

/**
 * Uses @memfork/vercel-ai middleware:
 *   - recallLimit:5  → injects top-5 facts from the variant branch as system context
 *   - autoCommit:false → we control what gets committed (structured thesis below)
 */
export async function decideNode(state: AgentState): Promise<Partial<AgentState>> {
  if (!state.signal) return {};

  const { signal } = state;
  const variantBranch = `strategy/${state.variant}`;

  const model = withMemForks(openai("gpt-4o-mini"), {
    ...memConfig(variantBranch),
    recallLimit: 5,
    autoCommit:  false,
  });

  const { text: thesis } = await generateText({
    model,
    system: [
      `You are the ${state.variant} ORB trading agent.`,
      `Respond in 2–3 sentences: why do we enter here, what is the main risk?`,
    ].join("\n"),
    messages: [{
      role: "user",
      content: [
        `Ticker: ${signal.ticker}`,
        `Entry ask: ${signal.entry_price}`,
        `OR high: ${signal.or_high} | OR low: ${signal.or_low}`,
        `Conviction score: ${signal.conviction_score}/12`,
        `Minutes from open: ${minutesFromOpen().toFixed(1)}`,
      ].join("\n"),
    }],
  });

  return { thesis };
}

// ── trade ─────────────────────────────────────────────────────────────────────

export async function tradeNode(state: AgentState): Promise<Partial<AgentState>> {
  if (!state.signal || !state.thesis) return { skipReason: "no signal or thesis" };

  const { signal } = state;
  const equity  = await getEquity();
  const sizing  = computeSize(signal.entry_price, signal.or_low, signal.conviction_score, equity);
  const tradeId = `${state.variant}_${signal.ticker}_${Date.now()}`;
  const result  = await enterPosition(signal.ticker, state.variant, sizing, tradeId);

  if (result.kind === "failed")  return { skipReason: `entry failed: ${result.reason}` };
  if (result.kind === "pending") return { skipReason: `pending fill: ${result.pending.order_id}` };

  // Recall prior thesis to classify conviction direction
  const variantBranch = `strategy/${state.variant}`;
  const mem = (await import("@memfork/core").then((m) => m.MemForksClient.connect({
    treeId: env.MEMFORK_TREE_ID(),
    signer: env.MEMFORK_PRIVATE_KEY(),
    memwal: { accountId: env.MEMFORK_MEMWAL_ACCOUNT(), delegateKey: env.MEMFORK_MEMWAL_KEY() },
  })));
  const prior = await mem.recall(`entry thesis for ${signal.ticker}`, {
    branch: variantBranch,
    limit: 1,
  });
  const convictionChange =
    prior.length === 0 ? "new" :
    (prior[0].text as string).includes("do not") ? "reverses" : "confirms";

  await commitThesis(state.variant, state.thesis, {
    ticker: signal.ticker,
    entry:  result.position.entry_price,
    stop:   result.position.hard_stop,
    tradeId,
  }, convictionChange);

  return { position: result.position };
}

// ── manage ────────────────────────────────────────────────────────────────────

export async function manageNode(state: AgentState): Promise<Partial<AgentState>> {
  if (!state.position || state.position.state !== "pre_scale") return {};

  const snaps = await getSnapshots([state.position.ticker]);
  const bid   = snaps[state.position.ticker]?.latestQuote.bp ?? state.position.entry_price;

  if (bid >= state.position.scale_target) {
    const scaled = await executeScale(state.position);
    return { position: scaled };
  }
  return {};
}

// ── exit ──────────────────────────────────────────────────────────────────────

export async function exitNode(state: AgentState): Promise<Partial<AgentState>> {
  if (!state.position) return {};

  const pos = state.position;

  if (isPastEOD(env.EOD_FLAT_TIME())) {
    const snaps = await getSnapshots([pos.ticker]);
    const bid   = snaps[pos.ticker]?.latestQuote.bp ?? pos.entry_price;
    const result = await executeClose(pos, "EOD", bid);
    return buildClosed(state, result.fill_price, result.pnl, result.pnl_r, result.pnl_pct, "EOD");
  }

  // If Alpaca auto-closed the bracket (stop hit), pick up the fill
  const alpacaPos = await getPosition(pos.ticker);
  if (!alpacaPos || parseInt(alpacaPos.qty) === 0) {
    const snaps      = await getSnapshots([pos.ticker]);
    const closePrice = snaps[pos.ticker]?.latestTrade.p ?? pos.hard_stop;
    const pnl        = (closePrice - pos.entry_price) * pos.shares;
    const pnl_r      = pos.r_size ? pnl / (pos.r_size * pos.initial_shares) : 0;
    const pnl_pct    = (closePrice - pos.entry_price) / pos.entry_price;
    return buildClosed(state, closePrice, pnl, pnl_r, pnl_pct, "STOP_MISSED");
  }

  return {};
}

// ── postmortem ────────────────────────────────────────────────────────────────

/**
 * Uses @memfork/vercel-ai with autoCommit:true so the postmortem narrative
 * is anchored on-chain automatically after generation.
 */
export async function postmortemNode(state: AgentState): Promise<Partial<AgentState>> {
  if (!state.closedTrade) return {};

  const trade       = state.closedTrade;
  const variantBranch = `strategy/${state.variant}`;

  const model = withMemForks(openai("gpt-4o-mini"), {
    ...memConfig(variantBranch),
    recallLimit: 0,     // postmortem is about what happened, not past recall
    autoCommit:  true,  // fire-and-forget commit — anchors the narrative on-chain
  });

  const { text: surprises } = await generateText({
    model,
    messages: [{
      role: "user",
      content: [
        `Trade closed. What was surprising and what rule do we take away?`,
        `Ticker: ${trade.ticker} | P&L: $${trade.pnl.toFixed(2)} (${trade.pnl_r.toFixed(2)}R)`,
        `Entry thesis: ${trade.thesis}`,
        `Exit: ${trade.exit_reason}`,
        `Respond in 2 sentences max. Start with the concrete rule.`,
      ].join("\n"),
    }],
  });

  // Also commit a structured postmortem record (separate from the LLM narrative)
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

// ── helper ────────────────────────────────────────────────────────────────────

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
    trade_id:       pos.trade_id,
    ticker:         pos.ticker,
    variant:        pos.variant,
    entry_price:    pos.entry_price,
    exit_price:     fillPrice,
    shares:         pos.shares,
    initial_shares: pos.initial_shares,
    r_size:         pos.r_size,
    scaled_price:   pos.scaled_price,
    pnl,
    pnl_r,
    pnl_pct,
    exit_reason:    reason,
    entry_time:     pos.alpaca_entry_id,
    exit_time:      new Date().toISOString(),
    thesis:         state.thesis,
  };
  return { position: null, closedTrade: closed, exitReason: reason };
}
