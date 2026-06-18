import { NextResponse } from "next/server";
import { ensureTopology } from "@/lib/memory/init";

/**
 * POST /api/admin/init
 *
 * Idempotent endpoint that provisions the MemForks branch topology:
 *   - strategy/main (seeded with house risk rules)
 *   - strategy/<name> x5 (forked from strategy/main)
 *
 * Protected by ADMIN_SECRET header. Call this once after every deploy.
 * Safe to call repeatedly — branches that already exist are skipped.
 */
export async function POST(req: Request) {
  const secret = req.headers.get("x-admin-secret");

  if (!process.env.ADMIN_SECRET || secret !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const results = await ensureTopology();

    const created = results.filter((r) => !r.existed);
    const skipped = results.filter((r) => r.existed);

    return NextResponse.json({
      ok: true,
      summary: `${created.length} branch(es) created, ${skipped.length} already existed.`,
      created: created.map((r) => r.branch),
      skipped: skipped.map((r) => r.branch),
    });
  } catch (err) {
    console.error("[admin/init] topology setup failed:", err);
    return NextResponse.json(
      { error: "Topology initialization failed", detail: String(err) },
      { status: 500 }
    );
  }
}
