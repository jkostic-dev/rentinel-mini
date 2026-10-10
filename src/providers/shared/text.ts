/** Collapses whitespace; empty becomes null. */
export function cleanText(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized ? normalized : null;
}
