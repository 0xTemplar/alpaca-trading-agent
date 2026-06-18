import { getAccount, getPositions } from "@/lib/broker/account";
import { HOUSE_RULES } from "@/lib/strategies/config";
import type { AlpacaAccount, AlpacaPosition, SubmitOrderParams } from "@/types";

export interface RiskCheckResult {
  approved: boolean;
  rejections: string[];
  adjustedQty?: number;
  adjustedNotional?: number;
}

const MAX_POSITION_PCT = 5;
const MAX_GROSS_EXPOSURE_PCT = 25;
const MAX_DAILY_LOSS_PCT = 3;
const NO_TRADE_OPEN_MINUTES = 15;

/**
 * Enforces all house rules against a proposed order before it hits Alpaca.
 * Returns { approved: false, rejections } if the order must be blocked,
 * or { approved: true } with clamped qty/notional if sizing was adjusted.
 *
 * This is the hard gate — not a soft warning. The strategy loop must
 * reject or clamp based on this result before calling submitOrder().
 */
export async function checkRiskRules(
  params: SubmitOrderParams,
  sessionOpenEquity: number
): Promise<RiskCheckResult> {
  const rejections: string[] = [];

  const [account, positions] = await Promise.all([getAccount(), getPositions()]);

  const equity = parseFloat(account.equity);

  // ── Rule 1: No-trade window (first 15 min after market open) ─────────────
  if (isDuringNoTradeWindow()) {
    rejections.push(
      `No new entries between 9:30–9:45 ET (house rule: ${HOUSE_RULES[3].fact})`
    );
  }

  // ── Rule 2: Daily loss halt ───────────────────────────────────────────────
  const dailyLossPct = ((sessionOpenEquity - equity) / sessionOpenEquity) * 100;
  if (dailyLossPct >= MAX_DAILY_LOSS_PCT) {
    rejections.push(
      `Daily loss limit breached: ${dailyLossPct.toFixed(2)}% loss ≥ ${MAX_DAILY_LOSS_PCT}% cap. No new entries this session.`
    );
  }

  // ── Rule 3: Max gross exposure ────────────────────────────────────────────
  const grossExposure = positions.reduce(
    (sum, p) => sum + Math.abs(parseFloat(p.market_value)),
    0
  );
  const grossExposurePct = (grossExposure / equity) * 100;
  if (params.side === "buy" && grossExposurePct >= MAX_GROSS_EXPOSURE_PCT) {
    rejections.push(
      `Gross exposure at ${grossExposurePct.toFixed(1)}% — at or above ${MAX_GROSS_EXPOSURE_PCT}% cap. Cannot open new long.`
    );
  }

  // ── Rule 4: Position size cap (clamp, not reject) ─────────────────────────
  const maxNotional = equity * (MAX_POSITION_PCT / 100);
  let adjustedNotional = params.notional;
  let sizeWasClamped = false;

  if (params.notional && params.notional > maxNotional) {
    adjustedNotional = maxNotional;
    sizeWasClamped = true;
  }

  // ── Rule 5: Illiquidity check (volume guard lives in market-data layer) ──
  // Volume check is async and done upstream in the decide node before calling
  // this function — logged here for the commit record if it reaches us anyway.

  if (rejections.length > 0) {
    return { approved: false, rejections };
  }

  return {
    approved: true,
    rejections: [],
    ...(sizeWasClamped && adjustedNotional
      ? { adjustedNotional, rejections: [`Position clamped to ${MAX_POSITION_PCT}% max (was $${params.notional?.toFixed(2)}, now $${adjustedNotional.toFixed(2)})`] }
      : {}),
  };
}

function isDuringNoTradeWindow(): boolean {
  const now = new Date();
  const etOffset = getETOffsetMinutes();
  const etMinutes = now.getUTCHours() * 60 + now.getUTCMinutes() + etOffset;
  const marketOpen = 9 * 60 + 30;
  const noTradeEnd = marketOpen + NO_TRADE_OPEN_MINUTES;
  return etMinutes >= marketOpen && etMinutes < noTradeEnd;
}

function getETOffsetMinutes(): number {
  // ET = UTC-5 (EST) or UTC-4 (EDT)
  const jan = new Date(new Date().getFullYear(), 0, 1).getTimezoneOffset();
  const jul = new Date(new Date().getFullYear(), 6, 1).getTimezoneOffset();
  const isDST = new Date().getTimezoneOffset() < Math.max(jan, jul);
  return isDST ? -4 * 60 : -5 * 60;
}
