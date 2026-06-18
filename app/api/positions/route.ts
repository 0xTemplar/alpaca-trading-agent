import { NextResponse } from "next/server";
import { getPositions, getAccount, getDayPnl } from "@/trading/broker/alpaca";

/**
 * GET /api/positions
 * Returns live positions + account summary.
 */
export async function GET() {
  try {
    const [positions, account, dayPnl] = await Promise.all([
      getPositions(),
      getAccount(),
      getDayPnl(),
    ]);
    return NextResponse.json({
      ok: true,
      account: {
        equity:        parseFloat(account.equity),
        cash:          parseFloat(account.cash),
        buying_power:  parseFloat(account.buying_power),
        day_pnl:       dayPnl,
        trading_blocked: account.trading_blocked,
      },
      positions: positions.map((p) => ({
        symbol:         p.symbol,
        qty:            parseInt(p.qty),
        side:           p.side,
        avg_entry:      parseFloat(p.avg_entry_price),
        current_price:  parseFloat(p.current_price),
        market_value:   parseFloat(p.market_value),
        unrealized_pl:  parseFloat(p.unrealized_pl),
        unrealized_plpc: parseFloat(p.unrealized_plpc),
      })),
    });
  } catch (err) {
    console.error("[positions] failed:", err);
    return NextResponse.json(
      { error: "Failed to fetch positions", detail: String(err) },
      { status: 500 }
    );
  }
}
