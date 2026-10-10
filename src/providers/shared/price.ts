import type { ListingPrice } from "../../types.ts";
import { cleanText } from "./text.ts";

/** `"1.200 €"` is 1200 and `"1,5"` is 1.5: Serbian sites group with `.` and decimalise with `,`. */
function parsePriceValue(raw: string | null | undefined): number | null {
  const digits = cleanText(raw)?.replace(/[^\d.,]/g, "");
  if (!digits) return null;

  const parsed = Number.parseFloat(digits.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function inferCurrency(raw: string | null | undefined): string | null {
  const text = cleanText(raw);
  if (!text) return null;
  if (text.includes("€") || /\bEUR\b/i.test(text)) return "EUR";
  if (/\bRSD\b|\bdin\b/i.test(text)) return "RSD";
  return null;
}

/** `raw` is kept verbatim: price history compares against it. */
export function parsePrice(
  raw: string | null | undefined,
  currency?: string | null,
): ListingPrice {
  const text = cleanText(raw);

  return {
    value: parsePriceValue(text),
    currency: cleanText(currency) ?? inferCurrency(text),
    raw: text,
  };
}
