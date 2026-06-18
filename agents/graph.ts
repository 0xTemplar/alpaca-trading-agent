import { StateGraph, END } from "@langchain/langgraph";
import { createMemForksCheckpointer } from "@memfork/langgraph";
import {
  observeNode, riskGateNode, decideNode,
  tradeNode, manageNode, exitNode, postmortemNode,
} from "./nodes";
import { AgentStateAnnotation } from "./state";
import { env } from "@/shared/env";
import type { AgentState } from "./state";

function shouldEnter(state: AgentState): "risk_gate" | typeof END {
  if (state.skipReason || !state.signal) return END;
  return "risk_gate";
}

function shouldDecide(state: AgentState): "decide" | typeof END {
  if (state.skipReason) return END;
  return "decide";
}

function shouldTrade(state: AgentState): "trade" | typeof END {
  if (!state.thesis) return END;
  return "trade";
}

function afterTrade(state: AgentState): "manage" | "postmortem" | typeof END {
  if (!state.position) return state.closedTrade ? "postmortem" : END;
  return "manage";
}

function afterManage(state: AgentState): "exit" | typeof END {
  return state.position ? "exit" : END;
}

function afterExit(state: AgentState): "postmortem" | typeof END {
  return state.closedTrade ? "postmortem" : END;
}

/**
 * Build a compiled LangGraph for a single ORB variant.
 *
 * The MemForks checkpointer maps each LangGraph thread_id to a branch:
 *   "orb-immediate/AAPL_1750000000000"  →  strategy/orb-immediate/AAPL_1750000000000
 *
 * Every state snapshot (entry, scale, close) is committed on-chain to that branch,
 * giving each trade a full versioned lineage inside MemForks.
 */
export async function buildAgentGraph() {
  const checkpointer = await createMemForksCheckpointer({
    treeId: env.MEMFORK_TREE_ID(),
    signer: env.MEMFORK_PRIVATE_KEY(),
    memwal: {
      accountId:   env.MEMFORK_MEMWAL_ACCOUNT(),
      delegateKey: env.MEMFORK_MEMWAL_KEY(),
    },
    threadToBranch: (threadId) => `strategy/${threadId}`,
  });

  const graph = new StateGraph(AgentStateAnnotation)
    .addNode("observe",    observeNode)
    .addNode("risk_gate",  riskGateNode)
    .addNode("decide",     decideNode)
    .addNode("trade",      tradeNode)
    .addNode("manage",     manageNode)
    .addNode("exit",       exitNode)
    .addNode("postmortem", postmortemNode)

    .addEdge("__start__",  "observe")
    .addConditionalEdges("observe",   shouldEnter)
    .addConditionalEdges("risk_gate", shouldDecide)
    .addConditionalEdges("decide",    shouldTrade)
    .addConditionalEdges("trade",     afterTrade)
    .addConditionalEdges("manage",    afterManage)
    .addConditionalEdges("exit",      afterExit)
    .addEdge("postmortem", END);

  return graph.compile({ checkpointer });
}
