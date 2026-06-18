function required(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
}

function optional(key: string, fallback = ""): string {
  return process.env[key] ?? fallback;
}

function float(key: string, fallback: number): number {
  const v = process.env[key];
  return v ? parseFloat(v) : fallback;
}

function int(key: string, fallback: number): number {
  const v = process.env[key];
  return v ? parseInt(v, 10) : fallback;
}

function bool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (!v) return fallback;
  return v.toLowerCase() === "true";
}

export const env = {
  // MemForks
  MEMFORK_TREE_ID:       () => required("MEMFORK_TREE_ID"),
  MEMFORK_PRIVATE_KEY:   () => required("MEMFORK_PRIVATE_KEY"),
  MEMFORK_MEMWAL_ACCOUNT:() => required("MEMFORK_MEMWAL_ACCOUNT"),
  MEMFORK_MEMWAL_KEY:    () => required("MEMFORK_MEMWAL_KEY"),

  // OpenAI
  OPENAI_API_KEY:        () => required("OPENAI_API_KEY"),

  // Alpaca
  ALPACA_KEY:            () => required("ALPACA_API_KEY_ID"),
  ALPACA_SECRET:         () => required("ALPACA_API_SECRET_KEY"),
  ALPACA_TRADE_URL:      () => optional("ALPACA_BASE_URL", "https://paper-api.alpaca.markets"),
  ALPACA_DATA_FEED:      () => optional("ALPACA_DATA_FEED", "iex"),

  // Admin
  ADMIN_SECRET:          () => optional("ADMIN_SECRET"),

  // Risk config — mirrors config.py defaults
  MAX_RISK_PER_TRADE:    () => float("MAX_RISK_PER_TRADE", 50),
  MAX_RISK_PCT:          () => float("MAX_RISK_PCT", 0.005),
  MAX_POSITION_USD:      () => float("MAX_POSITION_USD", 3000),
  MAX_CONCURRENT:        () => int("MAX_CONCURRENT_POSITIONS", 3),
  DAILY_LOSS_LIMIT:      () => float("DAILY_LOSS_LIMIT", 300),
  EOD_FLAT_TIME:         () => optional("EOD_FLAT_TIME", "15:55"),
  TRAIL_PERCENT:         () => float("TRAIL_PERCENT", 2.0),
  SCALE_MIN_PCT:         () => float("SCALE_MIN_PCT", 0.03),
  FINAL_MIN_PCT:         () => float("FINAL_MIN_PCT", 0.06),
  CONV_MULT_9:           () => float("CONV_MULT_9", 1.0),
  CONV_MULT_8:           () => float("CONV_MULT_8", 0.75),
  CONV_MULT_7:           () => float("CONV_MULT_7", 0.5),

  // Scanner gates
  MIN_GAP_PCT:           () => float("MIN_GAP_PCT", 0.04),
  MIN_PRICE:             () => float("MIN_PRICE", 1.0),
  MAX_PRICE:             () => float("MAX_PRICE", 30.0),
  MAX_FLOAT_M:           () => float("MAX_FLOAT_M", 100.0),
  MIN_VOLUME:            () => int("MIN_VOLUME", 200_000),
  MIN_RVOL:              () => float("MIN_RVOL", 1.5),
  MAX_SPREAD_PCT:        () => float("MAX_SPREAD_PCT", 2.0),
  MIN_ORB_SCORE:         () => int("MIN_ORB_SCORE", 7),
  ORB_MIN_MINS:          () => int("ORB_MIN_MINS_FROM_OPEN", 6),
  ORB_HC_BREAKOUT_MINS:  () => int("ORB_HC_BREAKOUT_MINS", 65),
};
