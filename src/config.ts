import { resolveProvider } from "./providers/index.ts";
import type { Config, Target } from "./types.ts";

const DEFAULT_INTERVAL_MS = 300_000;
const DEFAULT_STATE_FILE_PATH = "./data/seen-listings.json";

type Env = Record<string, string | undefined>;

function parseTargets(raw: string | undefined, warnings: string[]): Target[] {
  if (!raw?.trim()) {
    throw new Error("SCRAPE_URLS is required.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      'SCRAPE_URLS must be JSON of "name": "url" pairs, for example {"Voždovac p1":"https://www.4zida.rs/..."}.',
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      'SCRAPE_URLS must be a JSON object of "name": "url" pairs.',
    );
  }

  const targets: Target[] = [];
  for (const [queryName, value] of Object.entries(parsed)) {
    if (typeof value !== "string" || value.trim().length === 0) {
      warnings.push(`Skipping "${queryName}": URL must be a non-empty string.`);
      continue;
    }

    const url = value.trim();
    if (!resolveProvider(url)) {
      warnings.push(`Skipping "${queryName}": unsupported site (${url})`);
      continue;
    }

    targets.push({ queryName: queryName.trim(), url });
  }

  if (targets.length === 0) {
    throw new Error(
      "SCRAPE_URLS has no supported URLs. Add at least one 4zida.rs or halooglasi.com search URL.",
    );
  }

  return targets;
}

function parseChatIds(raw: string | undefined): string[] {
  if (!raw?.trim()) {
    throw new Error("TELEGRAM_CHAT_IDS is required.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      'TELEGRAM_CHAT_IDS must be a JSON array of strings, for example ["1234567890"].',
    );
  }

  const chatIds = Array.isArray(parsed)
    ? parsed
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter((value) => value.length > 0)
    : [];

  if (chatIds.length === 0) {
    throw new Error("TELEGRAM_CHAT_IDS must list at least one chat ID.");
  }

  return chatIds;
}

function parseInterval(raw: string | undefined): number {
  if (!raw?.trim()) {
    return DEFAULT_INTERVAL_MS;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("SCRAPE_INTERVAL_MS must be a positive integer.");
  }

  return parsed;
}

export function loadConfig(env: Env = process.env): {
  config: Config;
  warnings: string[];
} {
  const warnings: string[] = [];
  const targets = parseTargets(env.SCRAPE_URLS, warnings);

  const telegramToken = env.TELEGRAM_TOKEN?.trim();
  if (!telegramToken) {
    throw new Error("TELEGRAM_TOKEN is required.");
  }

  return {
    config: {
      targets,
      telegramToken,
      telegramChatIds: parseChatIds(env.TELEGRAM_CHAT_IDS),
      scrapeIntervalMs: parseInterval(env.SCRAPE_INTERVAL_MS),
      stateFilePath: env.STATE_FILE_PATH?.trim() || DEFAULT_STATE_FILE_PATH,
    },
    warnings,
  };
}
