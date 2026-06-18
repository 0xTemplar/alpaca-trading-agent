import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { withMemForks } from "@memfork/vercel-ai";
import { z } from "zod";
import { getMemClient } from "@/lib/memory/client";
import { STRATEGIES } from "@/lib/strategies/config";
import { getPositions, getEquity } from "@/lib/broker/account";
import { getMultiSnapshots } from "@/lib/market-data/client";
import { checkRiskRules } from "@/lib/risk/rules";
import { submitMarketOrderByPct } from "@/lib/broker/orders";
import { makeOrderId } from "@/lib/risk/ledger";
import type { StrategyState } from "./state";

const TradeSignalSchema = z.object({
  action: z.enum(["buy", "sell", "hold", "close"]),
  ticker: z.string(),
  sizePct: z.number().min(0).max(5),
  thesis: z.string().describe("The reasoning for this action — committed to memory."),
  convictionVsPrior: z.enum(["new", "confirms", "reverses"]).describe(
    "'new' = no prior position. 'confirms' = same direction as prior thesis. 'reverses' = opposite direction — will fork conviction branch."
  ),
  surprises: z.string().optional().describe("What did the market do that was unexpected? Used in postmortem."),
});

// ── observe ────────────────────────────────────────────────────────────────

export async function observeNode(state: StrategyState): Promise<Partial<StrategyState>> {
  const config = STRATEGIES.find((s) => s.name === state.strategy)!;
  const [snapshots, positions] = await Promise.all([
    getMultiSnapshots(config.universe),
    getPositions(),
  ]);

  const openForStrategy = positions.filter((p) =>
    config.universe.includes(p.symbol)
  );

  const snapshotLines = Object.entries(snapshots)
    .map(([sym, snap]) => {
      const chg = (
        ((snap.dailyBar.c - snap.prevDailyBar.c) / snap.prevDailyBar.c) *
        100
      ).toFixed(2);
      return `${sym}: price=${snap.latestTrade.p}, day_change=${chg}%, vol=${snap.dailyBar.v}, vwap=${snap.minuteBar.vw}`;
    })
    .join("\n");

  const positionLines =
    openForStrategy.length > 0
      ? openForStrategy
          .map(
            (p) =>
              `  ${p.symbol} ${p.side} qty=${p.qty} entry=${p.avg_entry_price} unrealized_pnl=${p.unrealized_pl}`
          )
          .join("\n")
      : "  none";

  const observation = [
    `Strategy: ${state.strategy}`,
    `\nUniverse snapshots:\n${snapshotLines}`,
    `\nOpen positions:\n${positionLines}`,
  ].join("\n");

  return { observation };
}

// ── recall ─────────────────────────────────────────────────────────────────

export async function recallNode(state: StrategyState): Promise<Partial<StrategyState>> {
  const mem = await getMemClient();
  const branch = `strategy/${state.strategy}` as const;

  const [strategyFacts, mainFacts] = await Promise.all([
    mem.recall(state.observation, { branch, limit: 5 }),
    mem.recall("risk rules and position sizing", { branch: "strategy/main", limit: 4 }),
  ]);

  const recalledFacts = [
    ...mainFacts.map((f) => `[house rule] ${f.text}`),
    ...strategyFacts.map((f) => `[${state.strategy}] ${f.text}`),
  ];

  return { recalledFacts };
}

// ── decide ─────────────────────────────────────────────────────────────────

export async function decideNode(state: StrategyState): Promise<Partial<StrategyState>> {
  const model = withMemForks(openai("gpt-4o-mini"), {
    treeId: process.env.MEMFORK_TREE_ID!,
    signer: process.env.MEMFORK_PRIVATE_KEY!,
    memwal: {
      accountId: process.env.MEMFORK_MEMWAL_ACCOUNT!,
      delegateKey: process.env.MEMFORK_MEMWAL_KEY!,
    },
    branch: `strategy/${state.strategy}`,
    recallLimit: 0,   // we handled recall manually above
    autoCommit: false, // we fork-or-append explicitly in record/postmortem
  });

  const systemPrompt = [
    `You are the ${state.strategy} trading agent.`,
    `Your strategy: ${STRATEGIES.find((s) => s.name === state.strategy)!.description}`,
    `\nHouse rules and prior context:\n${state.recalledFacts.join("\n")}`,
    `\nYou MUST keep sizePct ≤ 5. Violations will be clamped or rejected.`,
    `\nIf action is 'hold' or no clear setup, set sizePct=0 and ticker to the most watched symbol.`,
  ].join("\n");

  const { object: signal } = await generateObject({
    model,
    schema: TradeSignalSchema,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: state.observation },
    ],
  });

  return { signal };
}

// ── risk-check ─────────────────────────────────────────────────────────────

export async function riskCheckNode(state: StrategyState): Promise<Partial<StrategyState>> {
  const signal = state.signal!;

  if (signal.action === "hold" || signal.sizePct === 0) {
    return {
      riskResult: { approved: true, rejections: [] },
      approvedNotional: 0,
    };
  }

  const equity = await getEquity();
  const proposedNotional = equity * (signal.sizePct / 100);

  const result = await checkRiskRules(
    {
      symbol: signal.ticker,
      notional: proposedNotional,
      side: signal.action === "buy" ? "buy" : "sell",
      type: "market",
      time_in_force: "day",
    },
    state.sessionOpenEquity
  );

  const approvedNotional = result.adjustedNotional ?? proposedNotional;

  return { riskResult: result, approvedNotional };
}

// ── trade ──────────────────────────────────────────────────────────────────

export async function tradeNode(state: StrategyState): Promise<Partial<StrategyState>> {
  const { signal, riskResult, approvedNotional } = state;
  if (!signal || !riskResult?.approved || !approvedNotional || signal.action === "hold") {
    return { orderId: null };
  }

  const clientOrderId = makeOrderId(state.strategy, signal.ticker, signal.action === "buy" ? "buy" : "sell");

  let closedSymbol: string | null = null;
  let closedPnl: number | null = null;

  if (signal.action === "close") {
    // Closing a position — check if it results in a realized PnL
    const positions = await getPositions();
    const pos = positions.find((p) => p.symbol === signal.ticker);
    if (pos) {
      closedSymbol = pos.symbol;
      closedPnl = parseFloat(pos.unrealized_pl);
    }
  }

  const order = await submitMarketOrderByPct(
    signal.ticker,
    signal.action === "close" ? "sell" : (signal.action as "buy" | "sell"),
    approvedNotional / (await getEquity()) * 100,
    clientOrderId
  );

  return {
    orderId: order.id,
    closedSymbol,
    closedPnl,
  };
}

// ── record ─────────────────────────────────────────────────────────────────
// Fork if conviction reverses; append if new or confirms.

export async function recordNode(state: StrategyState): Promise<Partial<StrategyState>> {
  const mem = await getMemClient();
  const { signal, riskResult, strategy } = state;
  const branch = `strategy/${strategy}` as const;

  if (!signal) return { committedBranch: null };

  const riskNote =
    riskResult && !riskResult.approved
      ? `Risk rejection: ${riskResult.rejections.join("; ")}`
      : riskResult?.adjustedNotional
      ? `Size clamped to $${riskResult.adjustedNotional.toFixed(2)}`
      : null;

  const facts = [
    `Action: ${signal.action} ${signal.ticker} ${signal.sizePct}%`,
    `Thesis: ${signal.thesis}`,
    ...(riskNote ? [`Risk: ${riskNote}`] : []),
    ...(state.orderId ? [`OrderId: ${state.orderId}`] : []),
  ];

  let committedBranch: string;

  if (signal.convictionVsPrior === "reverses") {
    // Fork — the prior thesis must survive in the original branch
    const convictionBranch = `strategy/${strategy}/conviction@${Date.now()}`;
    await mem.branch(convictionBranch, { from: branch });
    await mem.commit(convictionBranch, {
      facts: [`REVERSAL: ${signal.thesis}`, ...facts.slice(1)],
      message: `Conviction reversal — ${signal.ticker} ${signal.action}`,
    });
    committedBranch = convictionBranch;
  } else {
    // Append — confirms or new position
    await mem.commit(branch, {
      facts,
      message: `${signal.convictionVsPrior === "new" ? "New" : "Confirmed"} — ${signal.ticker} ${signal.action}`,
    });
    committedBranch = branch;
  }

  return { committedBranch };
}

// ── postmortem ─────────────────────────────────────────────────────────────
// Runs only when a position closed this tick.

export async function postmortemNode(state: StrategyState): Promise<Partial<StrategyState>> {
  if (!state.closedSymbol) return {};

  const mem = await getMemClient();
  const branch = `strategy/${state.strategy}` as const;
  const signal = state.signal;

  const facts = [
    `POSTMORTEM: ${state.closedSymbol} closed. Realized PnL: $${state.closedPnl?.toFixed(2) ?? "unknown"}`,
    `Exit thesis: ${signal?.thesis ?? "position closed by risk rule"}`,
    ...(signal?.surprises ? [`Surprises: ${signal.surprises}`] : []),
  ];

  await mem.commit(branch, {
    facts,
    message: `Postmortem — ${state.closedSymbol} closed`,
  });

  return { committedBranch: branch };
}
