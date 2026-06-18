import { Annotation } from "@langchain/langgraph";
import type { VariantName, WatchlistEntry, Position, ClosedTrade, ExitReason } from "@/shared/types";
import type { EntrySignal } from "@/scanner/orb-watcher";

export const AgentStateAnnotation = Annotation.Root({
  variant:    Annotation<VariantName>(),
  watchlist:  Annotation<WatchlistEntry[]>(),
  signal:     Annotation<EntrySignal | null>(),
  thesis:     Annotation<string>(),
  surprises:  Annotation<string>(),
  position:   Annotation<Position | null>(),
  closedTrade:Annotation<ClosedTrade | null>(),
  exitReason: Annotation<ExitReason | null>(),
  error:      Annotation<string | null>(),
  skipReason: Annotation<string | null>(),
});

export type AgentState = typeof AgentStateAnnotation.State;
