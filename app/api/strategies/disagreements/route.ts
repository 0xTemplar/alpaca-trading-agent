import { NextResponse } from "next/server";
import { detectDisagreements } from "@/agents/disagreements";

export async function GET() {
  try {
    const items = await detectDisagreements();
    return NextResponse.json({ ok: true, disagreements: items });
  } catch (err) {
    console.error("[disagreements] failed:", err);
    return NextResponse.json(
      { error: "Failed to detect disagreements", detail: String(err) },
      { status: 500 }
    );
  }
}
