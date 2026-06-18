import { StateGraph, END } from "@langchain/langgraph";
import { createMemForksCheckpointer } from "@memfork/langgraph";
import { StrategyStateAnnotation } from "./state";
import {
  observeNode,
  recallNode,
  decideNode,
  riskCheckNode,
  tradeNode,
  recordNode,
  postmortemNode,
} from "./nodes";
import type { StrategyName } from "@/types";
import type { StrategyState } from "./state";

/**
 * Routing: after risk-check, skip trade if signal is hold or risk rejected.
 * After trade, run postmortem only if a position closed this tick.
 */
function routeAfterRiskCheck(state: StrategyState): "trade" | "record" {
  const { signal, riskResult } = state;
  if (!signal || signal.action === "hold" || !riskResult?.approved) return "record";
  return "trade";
}

function routeAfterTrade(state: StrategyState): "postmortem" | "record" {
  return state.closedSymbol ? "postmortem" : "record";
}

let _checkpointer: Awaited<ReturnType<typeof createMemForksCheckpointer>> | null = null;

async function getCheckpointer() {
  if (_checkpointer) return _checkpointer;

  _checkpointer = await createMemForksCheckpointer({
    treeId: process.env.MEMFORK_TREE_ID!,
    signer: process.env.MEMFORK_PRIVATE_KEY!,
    memwal: {
      accountId: process.env.MEMFORK_MEMWAL_ACCOUNT!,
      delegateKey: process.env.MEMFORK_MEMWAL_KEY!,
    },
    // Maps each strategy thread_id → its MemForks branch
    // e.g. thread "momentum" → "strategy/momentum"
    threadToBranch: (threadId: string) => `strategy/${threadId}`,
  });

  return _checkpointer;
}

let _graph: ReturnType<typeof buildGraph> | null = null;

function buildGraph() {
  return new StateGraph(StrategyStateAnnotation)
    .addNode("observe", observeNode)
    .addNode("recall", recallNode)
    .addNode("decide", decideNode)
    .addNode("risk_check", riskCheckNode)
    .addNode("trade", tradeNode)
    .addNode("record", recordNode)
    .addNode("postmortem", postmortemNode)
    .addEdge("__start__", "observe")
    .addEdge("observe", "recall")
    .addEdge("recall", "decide")
    .addEdge("decide", "risk_check")
    .addConditionalEdges("risk_check", routeAfterRiskCheck, {
      trade: "trade",
      record: "record",
    })
    .addConditionalEdges("trade", routeAfterTrade, {
      postmortem: "postmortem",
      record: "record",
    })
    .addEdge("postmortem", "record")
    .addEdge("record", END);
}

/**
 * Runs one tick of the strategy loop for the given strategy.
 *
 * @param strategy  The strategy name (maps to thread_id and branch)
 * @param sessionOpenEquity  Equity at session open — used for daily loss check
 *
 * Each strategy gets its own thread_id so its graph state is checkpointed
 * independently in its MemForks branch via the MemForks checkpointer.
 */
export async function runStrategyTick(
  strategy: StrategyName,
  sessionOpenEquity: number
): Promise<StrategyState> {
  const checkpointer = await getCheckpointer();

  if (!_graph) {
    _graph = buildGraph().compile({ checkpointer });
  }

  const result = await _graph.invoke(
    { strategy, sessionOpenEquity },
    { configurable: { thread_id: strategy } }
  );

  return result as StrategyState;
}

/**
 * Runs one tick for all 5 strategies in parallel.
 * Each runs in its own thread — no shared state between strategies.
 */
export async function runAllStrategies(sessionOpenEquity: number) {
  const strategies: StrategyName[] = [
    "momentum",
    "mean-reversion",
    "news-aware",
    "risk-parity",
    "sector-rotation",
  ];

  const results = await Promise.allSettled(
    strategies.map((s) => runStrategyTick(s, sessionOpenEquity))
  );

  return results.map((r, i) => ({
    strategy: strategies[i],
    status: r.status,
    result: r.status === "fulfilled" ? r.value : null,
    error: r.status === "rejected" ? String(r.reason) : null,
  }));
}
