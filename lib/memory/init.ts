import { getMemClient } from "./client";
import { HOUSE_RULES, MAIN_BRANCH, STRATEGIES } from "@/lib/strategies/config";
import type { TopologyStatus } from "@/types";

let _initialized = false;

/**
 * Ensures the MemForks branch topology exists:
 *   strategy/main  — seeded with house risk rules
 *   strategy/<name> — forked from strategy/main for each of the 5 strategies
 *
 * Idempotent: safe to call on every deploy or app boot.
 * Branches that already exist are skipped; only missing ones are created.
 * Uses an in-process flag to avoid redundant Sui reads within a single process lifetime.
 */
export async function ensureTopology(): Promise<TopologyStatus[]> {
  if (_initialized) return [];

  const mem = await getMemClient();
  const results: TopologyStatus[] = [];

  // 1. Ensure strategy/main exists and is seeded with house rules
  let mainExisted = true;
  try {
    await mem.branch(MAIN_BRANCH, { from: "main" });
    mainExisted = false;
  } catch {
    // branch already exists — expected on every call after first
  }

  let mainSeeded = false;
  if (!mainExisted) {
    await mem.commit(MAIN_BRANCH, {
      facts: HOUSE_RULES.map((r) => r.fact),
      message: "Seed house risk rules",
    });
    mainSeeded = true;
  }

  results.push({ branch: MAIN_BRANCH, existed: mainExisted, seeded: mainSeeded });

  // 2. Fork each strategy branch from strategy/main
  for (const strategy of STRATEGIES) {
    let existed = true;
    try {
      await mem.branch(strategy.branch, { from: MAIN_BRANCH });
      existed = false;
    } catch {
      // branch already exists — skip
    }

    let seeded = false;
    if (!existed) {
      // Commit the strategy's own parameters and description so agents
      // can recall "what are my rules and parameters?" from their own branch.
      await mem.commit(strategy.branch, {
        facts: [
          `Strategy: ${strategy.name}`,
          `Description: ${strategy.description}`,
          `Universe: ${strategy.universe.join(", ")}`,
          `Parameters: ${JSON.stringify(strategy.params)}`,
        ],
        message: `Seed ${strategy.name} strategy definition`,
      });
      seeded = true;
    }

    results.push({ branch: strategy.branch, existed, seeded });
  }

  _initialized = true;
  return results;
}
