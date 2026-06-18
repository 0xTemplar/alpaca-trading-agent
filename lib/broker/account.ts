import { trading } from "./client";
import type { AlpacaAccount, AlpacaPosition } from "@/types";

export async function getAccount(): Promise<AlpacaAccount> {
  return trading.get<AlpacaAccount>("/v2/account");
}

export async function getPositions(): Promise<AlpacaPosition[]> {
  return trading.get<AlpacaPosition[]>("/v2/positions");
}

export async function getPosition(symbol: string): Promise<AlpacaPosition | null> {
  try {
    return await trading.get<AlpacaPosition>(`/v2/positions/${symbol}`);
  } catch (err: unknown) {
    // 404 means no open position for this symbol — not an error
    if (err instanceof Error && err.message.includes("404")) return null;
    throw err;
  }
}

/**
 * Returns portfolio equity as a number.
 * Use this for position sizing calculations (e.g. 5% of equity).
 */
export async function getEquity(): Promise<number> {
  const account = await getAccount();
  return parseFloat(account.equity);
}
