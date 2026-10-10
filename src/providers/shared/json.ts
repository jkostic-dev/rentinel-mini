import { cleanText } from "./text.ts";

export type JsonObject = Record<string, unknown>;

export function asObject(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

/** JSON-LD types numbers and strings interchangeably; a price of `350` and `"350"` both occur. */
export function asText(value: unknown): string | null {
  return typeof value === "string" || typeof value === "number"
    ? cleanText(String(value))
    : null;
}

/** Every `application/ld+json` block that parses; malformed ones are skipped. */
export function extractJsonLd(html: string): unknown[] {
  const pattern =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const blocks: unknown[] = [];

  for (const [, body] of html.matchAll(pattern)) {
    try {
      blocks.push(JSON.parse(body ?? ""));
    } catch {
      // skip
    }
  }

  return blocks;
}

/** Every node of `schemaType`, at any depth. `@type` is a string or an array of them. */
export function collectByType(node: unknown, schemaType: string): JsonObject[] {
  const found: JsonObject[] = [];

  const walk = (current: unknown): void => {
    if (Array.isArray(current)) {
      for (const child of current) walk(child);
      return;
    }

    const object = asObject(current);
    if (!object) return;

    const type = object["@type"];

    if (
      type === schemaType ||
      (Array.isArray(type) && type.includes(schemaType))
    ) {
      found.push(object);
    }

    for (const value of Object.values(object)) walk(value);
  };

  walk(node);
  return found;
}
