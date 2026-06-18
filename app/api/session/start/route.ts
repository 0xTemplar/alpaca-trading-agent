import { NextResponse } from "next/server";
import { runSession } from "@/agents/session";
import { env } from "@/shared/env";

/**
 * POST /api/session/start
 *
 * Starts the live trading session for all three ORB variants.
 * Protected by ADMIN_SECRET. Runs in the background — returns immediately.
 *
 * Body: { tickers: string[], pollIntervalMs?: number }
 */
export async function POST(req: Request) {
  const secret = req.headers.get("x-admin-secret");
  if (!env.ADMIN_SECRET() || secret !== env.ADMIN_SECRET()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { tickers, pollIntervalMs } = await req.json() as {
    tickers: string[];
    pollIntervalMs?: number;
  };

  if (!Array.isArray(tickers) || tickers.length === 0) {
    return NextResponse.json({ error: "tickers[] required" }, { status: 400 });
  }

  // Fire-and-forget — the session runs its full loop; don't await here
  runSession(tickers, pollIntervalMs ?? 15_000).catch((err) =>
    console.error("[session/start] session crashed:", err)
  );

  return NextResponse.json({
    ok: true,
    message: `Session started for ${tickers.length} ticker(s) across 3 variants.`,
    tickers,
  });
}
