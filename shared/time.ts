import { ZoneInfo } from "node:v8"; // placeholder — we use Intl directly

export const ET_ZONE = "America/New_York";

/** Current time as a Date in ET. */
export function nowET(): Date {
  return new Date(
    new Date().toLocaleString("en-US", { timeZone: ET_ZONE })
  );
}

/** Returns ET HH:MM as a string, e.g. "09:31". */
export function etHHMM(): string {
  return nowET().toTimeString().slice(0, 5);
}

/**
 * Returns the minutes elapsed since market open (09:30 ET) today.
 * Negative before open, 0 at open.
 */
export function minutesFromOpen(): number {
  const now = nowET();
  const open = new Date(now);
  open.setHours(9, 30, 0, 0);
  return (now.getTime() - open.getTime()) / 60_000;
}

/** True on a weekday between 09:30 and 16:00 ET. */
export function isMarketHours(): boolean {
  const now = nowET();
  if (now.getDay() === 0 || now.getDay() === 6) return false;
  const m = minutesFromOpen();
  return m >= 0 && m < 390; // 390 min = 6.5 hours
}

/** True during the no-entry window: first 15 min after open. */
export function isNoTradeWindow(): boolean {
  const m = minutesFromOpen();
  return m >= 0 && m < 15;
}

/** True at or past the EOD flat time (15:55 ET by default). */
export function isPastEOD(eodHHMM = "15:55"): boolean {
  const now = nowET();
  if (now.getDay() === 0 || now.getDay() === 6) return false;
  const [h, m] = eodHHMM.split(":").map(Number);
  return now.getHours() > h || (now.getHours() === h && now.getMinutes() >= m);
}
