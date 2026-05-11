import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.ts";

const validEnv = {
  SCRAPE_URLS: JSON.stringify({
    "Voždovac 4zida p1": "https://www.4zida.rs/izdavanje-stanova/vozdovac",
    "Voždovac halo p1":
      "https://www.halooglasi.com/nekretnine/izdavanje-stanova/beograd",
  }),
  TELEGRAM_TOKEN: "123456:ABCDEF",
  TELEGRAM_CHAT_IDS: JSON.stringify(["1234567890"]),
};

test("reads targets, credentials and defaults", () => {
  const { config, warnings } = loadConfig(validEnv);

  assert.deepEqual(warnings, []);
  assert.deepEqual(
    config.targets.map((target) => target.queryName),
    ["Voždovac 4zida p1", "Voždovac halo p1"],
  );
  assert.equal(config.telegramToken, "123456:ABCDEF");
  assert.deepEqual(config.telegramChatIds, ["1234567890"]);
  assert.equal(config.scrapeIntervalMs, 300_000);
  assert.equal(config.stateFilePath, "./data/seen-listings.json");
});

test("overrides interval and state path when provided", () => {
  const { config } = loadConfig({
    ...validEnv,
    SCRAPE_INTERVAL_MS: "60000",
    STATE_FILE_PATH: "/tmp/seen.json",
  });

  assert.equal(config.scrapeIntervalMs, 60_000);
  assert.equal(config.stateFilePath, "/tmp/seen.json");
});

test("a missing telegram token is a startup error", () => {
  assert.throws(
    () => loadConfig({ ...validEnv, TELEGRAM_TOKEN: undefined }),
    /TELEGRAM_TOKEN is required/,
  );
});

test("an unsupported site is skipped with a warning, not a crash", () => {
  const { config, warnings } = loadConfig({
    ...validEnv,
    SCRAPE_URLS: JSON.stringify({
      Supported: "https://www.4zida.rs/izdavanje-stanova/vozdovac",
      Unsupported: "https://www.nekretnine.rs/stambeni-objekti",
    }),
  });

  assert.deepEqual(
    config.targets.map((target) => target.queryName),
    ["Supported"],
  );
  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? "", /Unsupported.*unsupported site/);
});

test("no supported url at all is a startup error", () => {
  assert.throws(
    () =>
      loadConfig({
        ...validEnv,
        SCRAPE_URLS: JSON.stringify({ Only: "https://www.nekretnine.rs/" }),
      }),
    /no supported URLs/,
  );
});

test("malformed SCRAPE_URLS json is a startup error", () => {
  assert.throws(
    () => loadConfig({ ...validEnv, SCRAPE_URLS: "{not json" }),
    /SCRAPE_URLS must be JSON/,
  );
});

test("malformed TELEGRAM_CHAT_IDS json is a startup error", () => {
  assert.throws(
    () => loadConfig({ ...validEnv, TELEGRAM_CHAT_IDS: "1234567890" }),
    /TELEGRAM_CHAT_IDS must list at least one chat ID/,
  );
});
