import { StateGraph, END } from "@langchain/langgraph";
import {
  observeNode, riskGateNode, decideNode,
  tradeNode, manageNode, exitNode, postmortemNode,
} from "./nodes";
import { AgentStateAnnotation } from "./state";
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

function shouldManage(state: AgentState): "manage" | "postmortem" | typeof END {
  if (!state.position) {
    return state.closedTrade ? "postmortem" : END;
  }
  return "manage";
}

function afterManage(state: AgentState): "exit" | typeof END {
  return state.position ? "exit" : END;
}

function afterExit(state: AgentState): "postmortem" | typeof END {
  return state.closedTrade ? "postmortem" : END;
}

export function buildAgentGraph() {
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
    .addEdge("trade",  "manage")
    .addConditionalEdges("manage", afterManage)
    .addConditionalEdges("exit",   afterExit)
    .addEdge("postmortem", END);

  return graph.compile();
}
