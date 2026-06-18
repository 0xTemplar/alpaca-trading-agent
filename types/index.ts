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

// ── Alpaca Trading API ────────────────────────────────────────────────────────

export interface AlpacaAccount {
  id: string;
  equity: string;
  cash: string;
  buying_power: string;
  portfolio_value: string;
  daytrade_count: number;
  pattern_day_trader: boolean;
  trading_blocked: boolean;
  status: string;
}

export interface AlpacaPosition {
  asset_id: string;
  symbol: string;
  qty: string;
  side: "long" | "short";
  market_value: string;
  avg_entry_price: string;
  unrealized_pl: string;
  unrealized_plpc: string;
  current_price: string;
  lastday_price: string;
  change_today: string;
}

export type OrderSide = "buy" | "sell";
export type OrderType = "market" | "limit" | "stop" | "stop_limit";
export type TimeInForce = "day" | "gtc" | "ioc" | "fok";
export type OrderStatus =
  | "new"
  | "partially_filled"
  | "filled"
  | "done_for_day"
  | "canceled"
  | "expired"
  | "replaced"
  | "pending_cancel"
  | "pending_replace"
  | "accepted"
  | "pending_new"
  | "accepted_for_bidding"
  | "stopped"
  | "rejected"
  | "suspended"
  | "calculated";

export interface AlpacaOrder {
  id: string;
  client_order_id: string;
  created_at: string;
  updated_at: string;
  submitted_at: string;
  filled_at: string | null;
  symbol: string;
  qty: string;
  filled_qty: string;
  filled_avg_price: string | null;
  side: OrderSide;
  type: OrderType;
  time_in_force: TimeInForce;
  status: OrderStatus;
  limit_price: string | null;
  stop_price: string | null;
  extended_hours: boolean;
}

export interface SubmitOrderParams {
  symbol: string;
  qty?: number;
  notional?: number;
  side: OrderSide;
  type: OrderType;
  time_in_force: TimeInForce;
  limit_price?: number;
  stop_price?: number;
  client_order_id?: string;
}

export interface AlpacaActivity {
  id: string;
  activity_type: string;
  transaction_time: string;
  type: string;
  price: string;
  qty: string;
  side: string;
  symbol: string;
  leaves_qty: string;
  order_id: string;
  cum_qty: string;
}

// ── Market Data ───────────────────────────────────────────────────────────────

export interface Bar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  vw: number;
}

export interface Quote {
  t: string;
  ax: string;
  ap: number;
  as: number;
  bx: string;
  bp: number;
  bs: number;
}

export interface Snapshot {
  latestTrade: { t: string; p: number; s: number };
  latestQuote: Quote;
  minuteBar: Bar;
  dailyBar: Bar;
  prevDailyBar: Bar;
}
