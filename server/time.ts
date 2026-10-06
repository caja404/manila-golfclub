// The club runs on Manila time (UTC+8, no daylight saving), wherever the server is hosted.
const OFFSET_MS = 8 * 60 * 60 * 1000;

/** Club calendar date (YYYY-MM-DD) for a timestamp. */
export function clubDate(ts = Date.now()): string {
  return new Date(ts + OFFSET_MS).toISOString().slice(0, 10);
}

/** Timestamp for a club-local date and time. */
export function clubTime(date: string, hour: number, minute = 0): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d, hour, minute) - OFFSET_MS;
}

export function addDays(date: string, days: number): string {
  return clubDate(clubTime(date, 12) + days * 86_400_000);
}
