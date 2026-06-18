import { NextResponse } from "next/server";
import { detectDisagreements } from "@/lib/loop/disagreements";

/**
 * GET /api/strategies/disagreements
 *
 * Returns all active disagreements: symbols where at least two strategies
 * hold opposite sides with their recalled theses from each branch.
 *
 * This is the live feed for the Disagreement View — the gate-satisfying
 * moment where two branches hold contradicting theses on the same ticker.
 */
export async function GET() {
  try {
    const disagreements = await detectDisagreements();

    return NextResponse.json({
      count: disagreements.length,
      disagreements,
      asOf: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[disagreements] detection failed:", err);
    return NextResponse.json(
      { error: "Failed to detect disagreements", detail: String(err) },
      { status: 500 }
    );
  }
}
