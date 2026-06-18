import { getMemClient } from "./client";
import { VARIANTS, HOUSE_RULES, MAIN_BRANCH } from "@/strategies/config";
import type { TopologyStatus } from "@/shared/types";

let _initialized = false;

/**
 * Idempotent: creates strategy/main + variant branches if they don't exist.
 * Safe to call on deploy; uses the in-process flag to skip on subsequent calls
 * within the same process lifetime.
 */
export async function ensureTopology(): Promise<TopologyStatus[]> {
  if (_initialized) return [];

  const mem = await getMemClient();
  const results: TopologyStatus[] = [];

  // strategy/main
  let mainExisted = true;
  try {
    await mem.branch(MAIN_BRANCH, { from: "main" });
    mainExisted = false;
  } catch { /* already exists */ }

  if (!mainExisted) {
    await mem.commit(MAIN_BRANCH, {
      facts: HOUSE_RULES,
      message: "Seed house trading rules",
    });
  }
  results.push({ branch: MAIN_BRANCH, existed: mainExisted, seeded: !mainExisted });

  // variant branches
  for (const variant of VARIANTS) {
    let existed = true;
    try {
      await mem.branch(variant.branch, { from: MAIN_BRANCH });
      existed = false;
    } catch { /* already exists */ }

    if (!existed) {
      await mem.commit(variant.branch, {
        facts: [
          `Variant: ${variant.name}`,
          `Entry rule: ${variant.entryRule}`,
          `Philosophy: ${variant.description}`,
        ],
        message: `Seed ${variant.name} variant`,
      });
    }
    results.push({ branch: variant.branch, existed, seeded: !existed });
  }

  _initialized = true;
  return results;
}
