import { createHash, randomBytes } from "node:crypto";
import { load } from "cheerio";

const WORD = /[\p{L}\p{N}]+/gu;
/** Shorter words ("m2", "III", "EUR") name nothing. */
const MIN_LETTERS = 4;
/** A run of digits this long is a phone number or an id, never a price or a size. */
const MIN_ID_DIGITS = 7;
/** Free text this long is a description, where a phone number may be written in pieces. */
const PROSE_WORDS = 12;
/** JSON-LD vocabulary, which parsers match on. */
const UNREDACTED_KEYS = new Set(["@type", "@context"]);

/**
 * A captured page with everything that could point at a real listing scrambled: words, links,
 * ids, and long numbers. Only `keepWords` and what cannot identify anything (short words, prices,
 * dates, sizes) stay readable. The markup, and so what a parser sees, keeps its shape.
 *
 * A word always scrambles to the same thing within one call, so a listing's URL still matches
 * wherever the page repeats it. The salt is random, so the scrambling cannot be replayed.
 */
export function redactFixture(
  body: string,
  keepWords: readonly string[] = [],
  salt: string = randomBytes(16).toString("hex"),
): string {
  const kept = new Set(keepWords.map((word) => word.toLowerCase()));

  function scramble(word: string): string {
    const hash = createHash("sha256")
      .update(salt)
      .update(word.toLowerCase())
      .digest();

    return [...word]
      .map((char, index) => {
        const byte = hash[index % hash.length] ?? 0;
        if (/\p{N}/u.test(char)) return String(byte % 10);

        // Hex stays hex, so an id that must look like one still does.
        const lower = /[a-f]/i.test(char)
          ? String.fromCharCode(97 + (byte % 6))
          : String.fromCharCode(103 + (byte % 20));

        return char === char.toLowerCase() ? lower : lower.toUpperCase();
      })
      .join("");
  }

  const redactWords = (text: string, everyNumber: boolean) =>
    text.replace(WORD, (word) => {
      if (kept.has(word.toLowerCase())) return word;
      const letters = word.replace(/\p{N}/gu, "").length;
      const digits = word.length - letters;
      if (letters >= MIN_LETTERS || digits >= MIN_ID_DIGITS)
        return scramble(word);
      return everyNumber && digits > 0 ? scramble(word) : word;
    });

  const redactText = (text: string) =>
    redactWords(text, (text.match(WORD)?.length ?? 0) > PROSE_WORDS);

  /** The site's own origin stays; the path, where slugs and ids live, does not. */
  function redactUrl(raw: string): string {
    const origin = raw.match(/^(?:https?:)?\/\/[^/?#]*/i)?.[0] ?? "";
    return origin + redactWords(raw.slice(origin.length), true);
  }

  const isUrl = (text: string) => /^(?:https?:\/\/|\/)/i.test(text.trim());
  const redactString = (text: string) =>
    isUrl(text) ? redactUrl(text) : redactText(text);

  function redactJson(value: unknown, key?: string): unknown {
    if (key !== undefined && UNREDACTED_KEYS.has(key)) return value;
    if (typeof value === "string") return redactString(value);
    if (Array.isArray(value)) return value.map((entry) => redactJson(entry));
    if (value === null || typeof value !== "object") return value;

    return Object.fromEntries(
      Object.entries(value).map(([name, entry]) => [
        name,
        redactJson(entry, name),
      ]),
    );
  }

  const parseJson = (text: string): unknown => {
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  };

  const json = parseJson(body);
  if (json !== undefined) {
    return `${JSON.stringify(redactJson(json), null, 2)}\n`;
  }

  const $ = load(body);

  $("script").each((_, script) => {
    const data = parseJson($(script).text());
    $(script).text(data === undefined ? "" : JSON.stringify(redactJson(data)));
  });

  $("*")
    .contents()
    .each((_, node) => {
      const inScript =
        node.parent && "name" in node.parent && node.parent.name === "script";
      if (node.type === "text" && !inScript) node.data = redactText(node.data);
    });

  $("[href], [src], [alt], [id], [data-id]").each((_, element) => {
    const node = $(element);

    for (const name of ["href", "src"]) {
      const value = node.attr(name);
      if (value !== undefined) node.attr(name, redactUrl(value));
    }

    const alt = node.attr("alt");
    if (alt !== undefined) node.attr("alt", redactText(alt));

    // An id that is a number is the listing's; one with a name is the page's own.
    for (const name of ["id", "data-id"]) {
      const value = node.attr(name);
      if (value !== undefined && /^\d+$/.test(value))
        node.attr(name, scramble(value));
    }
  });

  return $.html();
}
