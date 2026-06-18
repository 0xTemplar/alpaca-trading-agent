export type StrategyName =
  | "momentum"
  | "mean-reversion"
  | "news-aware"
  | "risk-parity"
  | "sector-rotation";

export type BranchName = `strategy/${string}`;

export interface StrategyConfig {
  name: StrategyName;
  branch: BranchName;
  description: string;
  universe: string[];
  params: Record<string, number | boolean>;
}

export interface HouseRule {
  fact: string;
}

export interface TradeSignal {
  action: "buy" | "sell" | "hold" | "close";
  ticker: string;
  sizePct: number;
  thesis: string;
  convictionVsPrior: "new" | "confirms" | "reverses";
}

export interface RiskMetrics {
  sharpe: number;
  sortino: number;
  maxDrawdown: number;
  hitRate: number;
  profitFactor: number;
  totalTrades: number;
}

export interface StrategyResult {
  strategy: StrategyName;
  metrics: RiskMetrics;
  rank?: number;
}

export interface TopologyStatus {
  branch: string;
  existed: boolean;
  seeded: boolean;
}
