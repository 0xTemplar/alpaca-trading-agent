// ── ORB variant identifiers ───────────────────────────────────────────────────

export type VariantName = "orb-immediate" | "orb-retest" | "orb-shakeout";
export type BranchName = `strategy/${string}`;

// ── Scanner / watchlist ───────────────────────────────────────────────────────

export type EntryType = "PRE-MKT" | "ORB" | "CONTINUATION" | "FADE-WATCH";

export interface Candidate {
  ticker: string;
  price: number;
  prev_close: number;
  gap_pct: number;
  day_volume: number;
  pm_volume: number;
  pm_volume_pct_float: number | null;
  float_shares: number | null;
  rvol: number | null;
  has_catalyst: boolean;
  pm_high_time: string | null;    // "08:14" ET
  pm_high_price: number | null;
  ask: number | null;
  bid: number | null;
  conviction_score: number;       // 0–12
  entry_type: EntryType;
}

export interface ORLevels {
  or_high: number;
  or_low: number;
  or_range_pct: number;
}

export interface WatchlistEntry extends Candidate {
  or_high: number | null;
  or_low: number | null;
  or_range_pct: number | null;
  pm_fade_pct: number | null;
  orb_triggered: boolean;
  orb_high_conviction: boolean;
  breakout_mins_from_open: number | null;
  shakeout_active: boolean;
  shakeout_lod: number | null;
  shakeout_reclaim_fired: boolean;
  added_at: string;               // ISO
}

// ── Sizing ────────────────────────────────────────────────────────────────────

export interface SizingResult {
  shares: number;
  r_size: number;
  risk_dollars: number;
  scale_target: number;
  final_target: number;
  conviction_norm: number;        // 0–10
  position_dollars: number;
}

// ── Position lifecycle ────────────────────────────────────────────────────────

export type PositionState = "pre_scale" | "trailing" | "post_scale";

export interface Position {
  trade_id: string;               // client_order_id base
  ticker: string;
  variant: VariantName;
  shares: number;
  initial_shares: number;
  entry_price: number;
  hard_stop: number;
  scale_target: number;
  final_target: number;
  r_size: number;
  state: PositionState;
  alpaca_entry_id: string;
  alpaca_oco_id: string | null;
  scaled_at: string | null;
  scaled_price: number | null;
  stale_bracket: boolean;
}

export interface PendingFill {
  trade_id: string;
  ticker: string;
  variant: VariantName;
  order_id: string;
  shares: number;
  initial_shares: number;
  hard_stop: number;
  scale_target: number;
  final_target: number;
  r_size: number;
  submitted_at: string;
  deadline: string;
}

// ── Trade record (for metrics / postmortem) ───────────────────────────────────

export type ExitReason = "STOP" | "TARGET" | "TRAIL" | "EOD" | "MANUAL" | "STOP_MISSED";

export interface ClosedTrade {
  trade_id: string;
  ticker: string;
  variant: VariantName;
  entry_price: number;
  exit_price: number;
  shares: number;
  initial_shares: number;
  r_size: number;
  scaled_price: number | null;
  pnl: number;
  pnl_r: number;
  pnl_pct: number;
  exit_reason: ExitReason;
  entry_time: string;
  exit_time: string;
  thesis: string;                 // committed to MemForks branch
}

// ── R-based performance metrics ───────────────────────────────────────────────

export interface RMetrics {
  avg_r: number;
  win_rate: number;
  profit_factor: number;
  expectancy_r: number;           // avg_r × win_rate − avg_loss_r × loss_rate
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  total_r: number;
}

// ── Alpaca REST types ─────────────────────────────────────────────────────────

export interface AlpacaAccount {
  id: string;
  equity: string;
  cash: string;
  buying_power: string;
  last_equity: string;
  daytrade_count: number | null;
  trading_blocked: boolean;
  status: string;
}

export type OrderSide = "buy" | "sell";
export type OrderType = "market" | "limit" | "stop" | "stop_limit" | "trailing_stop";
export type TimeInForce = "day" | "gtc" | "ioc" | "fok";
export type OrderStatus =
  | "new" | "accepted" | "pending_new" | "held"
  | "partially_filled" | "filled"
  | "done_for_day" | "canceled" | "expired" | "replaced"
  | "pending_cancel" | "pending_replace" | "rejected" | "suspended";

export interface AlpacaOrder {
  id: string;
  client_order_id: string;
  created_at: string;
  updated_at: string;
  submitted_at: string;
  filled_at: string | null;
  symbol: string;
  qty: string | null;
  notional: string | null;
  filled_qty: string;
  filled_avg_price: string | null;
  side: OrderSide;
  type: OrderType;
  time_in_force: TimeInForce;
  status: OrderStatus;
  order_class: string;
  legs: AlpacaOrder[] | null;
  limit_price: string | null;
  stop_price: string | null;
  trail_percent: string | null;
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
}

// ── Memory ────────────────────────────────────────────────────────────────────

export interface TopologyStatus {
  branch: string;
  existed: boolean;
  seeded: boolean;
}

// ── Market data ───────────────────────────────────────────────────────────────

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
  ap: number;   // ask price
  as: number;   // ask size
  bp: number;   // bid price
  bs: number;   // bid size
}

export interface Snapshot {
  latestTrade: { t: string; p: number; s: number };
  latestQuote: Quote;
  minuteBar: Bar;
  dailyBar: Bar;
  prevDailyBar: Bar;
}
