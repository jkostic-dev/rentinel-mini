import { cleanText } from "./text.ts";

const SERBIAN_DATE = /(\d{1,2})\.(\d{1,2})\.(\d{4})/;

/** ISO `YYYY-MM-DD`, from either an ISO timestamp or the `21.08.2026.` cards are written in. */
export function toIsoDate(raw: string | null | undefined): string | null {
  const text = cleanText(raw);
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);

  const match = text.match(SERBIAN_DATE);
  if (!match) return null;

  const [, dayText, monthText, yearText] = match;
  const [day, month, year] = [
    Number(dayText),
    Number(monthText),
    Number(yearText),
  ];
  const date = new Date(Date.UTC(year, month - 1, day));

  // Round-trip catches `31.02.2026.`, which Date silently rolls into March.
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date.toISOString().slice(0, 10)
    : null;
}
