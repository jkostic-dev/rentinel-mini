import assert from "node:assert/strict";
import test, { afterEach, mock } from "node:test";
import {
  MAX_CAPTION_LENGTH,
  MAX_MESSAGE_LENGTH,
  renderListing,
  sendListing,
} from "../src/telegram.ts";
import type { Listing } from "../src/types.ts";

const NOW = new Date("2026-08-22T10:00:00Z");

function listing(overrides: Partial<Listing> = {}): Listing {
  return {
    url: "https://fake.example/l/1",
    name: "Stan 1",
    location: "Voždovac, Beograd",
    features: ["35 m²", "Broj soba: 1.0"],
    tier: null,
    price: { value: 400, currency: "EUR", raw: "400 €" },
    datePosted: "2026-08-21",
    imageUrl: null,
    ...overrides,
  };
}

/** The rendered text, or a failed assertion if the listing did not fit. */
function render(item: Listing, maxLength?: number): string {
  const text = renderListing(item, "Voždovac", {
    now: NOW,
    ...(maxLength ? { maxLength } : {}),
  });

  assert.ok(text !== null, "listing did not fit");
  return text;
}

// The phone notification previews the start of the message, hence price and title first.
test("renders one listing as one message", () => {
  assert.equal(
    render(listing()),
    [
      "<b>400 €</b> • <b>Stan 1</b>",
      "",
      "• Voždovac, Beograd",
      "• 35 m²",
      "• Broj soba: 1.0",
      "",
      '<tg-time unix="1787310000" format="D">21.08.2026</tg-time> • <tg-time unix="1787310000" format="r">yesterday</tg-time>',
      "",
      "https://fake.example/l/1",
      "",
      "<i>Voždovac</i>",
    ].join("\n"),
  );
});

// Provider text is untrusted, and an unescaped `<` makes Telegram reject the whole message.
test("escapes every piece of provider text, and the query name", () => {
  const text = renderListing(
    listing({
      name: "<b>Lux</b> & <i>stan</i>",
      location: "Novi <Beograd>",
      features: ["<a href='x'>1</a>"],
      tier: "<Top>",
      price: { value: null, currency: null, raw: "<script>" },
      url: "https://fake.example/l/1?a=1&b=<2>",
      datePosted: null,
    }),
    "Label <&>",
  );
  assert.ok(text);

  assert.ok(text.includes("<i>Label &lt;&amp;&gt;</i>"));
  assert.ok(text.includes("Novi &lt;Beograd&gt;"));
  assert.ok(text.includes("https://fake.example/l/1?a=1&amp;b=&lt;2&gt;"));
  // The only tags left are the renderer's own.
  assert.deepEqual(text.match(/<\/?[a-z]+>/g), [
    "<b>",
    "</b>",
    "<b>",
    "</b>",
    "<i>",
    "</i>",
  ]);
});

test("drops features from the end until the listing fits a caption, keeping the link", () => {
  const features = Array.from(
    { length: 12 },
    (_, i) => `feature ${i + 1} ${"x".repeat(100)}`,
  );
  const text = render(listing({ features }), MAX_CAPTION_LENGTH);

  assert.ok(text.length <= MAX_CAPTION_LENGTH);
  assert.ok(text.includes("• feature 1 "));
  assert.ok(!text.includes("• feature 12 "));
  assert.ok(text.includes("• …"));
  assert.ok(text.includes("https://fake.example/l/1"));
  // Greedy: the same listing with a full message's room keeps every feature.
  assert.ok(render(listing({ features })).includes("• feature 12 "));
});

// Failing instead would fail on every retry and every later scrape.
test("sends a listing whose URL cannot fit without the link", () => {
  const text = render(
    listing({ url: `https://fake.example/${"x".repeat(5000)}` }),
  );

  assert.ok(text.length <= MAX_MESSAGE_LENGTH);
  assert.ok(text.includes("Stan 1"));
  assert.ok(text.includes("link too long"));
  assert.ok(!text.includes("xxxx"));
});

test("bounds long provider text so an ordinary listing always fits", () => {
  const verbose = listing({
    name: "A".repeat(10_000),
    location: "B".repeat(10_000),
    features: Array.from({ length: 200 }, () => "C".repeat(500)),
    price: { value: null, currency: null, raw: "D".repeat(1000) },
  });

  for (const maxLength of [MAX_MESSAGE_LENGTH, MAX_CAPTION_LENGTH]) {
    assert.ok(render(verbose, maxLength).length <= maxLength);
  }
});

test("truncates by code point, never splitting an emoji into a lone surrogate", () => {
  assert.ok(render(listing({ name: "🏠".repeat(1000) })).isWellFormed());
});

test("shows the tier only when the provider has one", () => {
  assert.ok(render(listing({ tier: "premium" })).includes("• PREMIUM"));
  assert.ok(!render(listing()).includes("STANDARD"));
});

test("appends the parsed currency only when the raw price does not carry one", () => {
  const bare = listing({ price: { value: 400, currency: "EUR", raw: "400" } });
  assert.ok(render(bare).includes("<b>400 EUR</b> •"));

  const none = listing({ price: { value: null, currency: null, raw: null } });
  assert.ok(render(none).includes("<b>N/A</b> •"));
});

test("dates the listing relative to Belgrade's calendar day", () => {
  assert.ok(
    render(listing({ datePosted: "2026-08-12" })).includes(
      'format="r">10 days ago</tg-time>',
    ),
  );
  assert.ok(!render(listing({ datePosted: null })).includes("tg-time"));

  // 23:30 UTC on the 21st is already the 22nd in Belgrade.
  const lateNight = renderListing(
    listing({ datePosted: "2026-08-22" }),
    "Voždovac",
    { now: new Date("2026-08-21T23:30:00Z") },
  );
  assert.ok(lateNight?.includes(">today</tg-time>"));
});

test("never dates today's listing later than now", () => {
  // NOW is 10:00 UTC, an hour short of the midday a date is pinned to.
  assert.ok(
    render(listing({ datePosted: "2026-08-22" })).includes(
      `unix="${NOW.getTime() / 1000}" format="r">today<`,
    ),
  );
});

/** Stubs `fetch` with one HTTP status per call, and records what was called. */
function stubTelegram(...statuses: number[]) {
  const calls: { method: string; payload: Record<string, unknown> }[] = [];

  mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    calls.push({
      method: url.split("/").at(-1) ?? "",
      payload: JSON.parse(String(init.body)),
    });
    return Response.json({}, { status: statuses[calls.length - 1] ?? 200 });
  });

  return calls;
}

const send = (item: Listing, telegramChatIds = ["1"]) =>
  sendListing({
    telegramToken: "token",
    telegramChatIds,
    queryName: "Voždovac",
    listing: item,
  });

afterEach(() => mock.restoreAll());

test("sends a listing with an image as a captioned photo, to every chat", async () => {
  const calls = stubTelegram();
  await send(listing({ imageUrl: "https://cdn.example/a.jpg" }), ["1", "2"]);

  assert.deepEqual(
    calls.map((call) => [call.method, call.payload.chat_id]),
    [
      ["sendPhoto", "1"],
      ["sendPhoto", "2"],
    ],
  );
  assert.equal(calls[0]?.payload.photo, "https://cdn.example/a.jpg");
  assert.match(String(calls[0]?.payload.caption), /^<b>400 €<\/b>/);
});

test("sends a listing without an image as text", async () => {
  const calls = stubTelegram();
  await send(listing());

  assert.deepEqual(
    calls.map((call) => call.method),
    ["sendMessage"],
  );
  assert.match(String(calls[0]?.payload.text), /^<b>400 €<\/b>/);
});

test("falls back to text when Telegram cannot fetch the image", async () => {
  const calls = stubTelegram(400, 200);
  await send(listing({ imageUrl: "https://cdn.example/gone.jpg" }));

  assert.deepEqual(
    calls.map((call) => call.method),
    ["sendPhoto", "sendMessage"],
  );
});

test("a failed send throws, so the listing is retried next cycle", async () => {
  stubTelegram(403);
  await assert.rejects(send(listing()), /sendMessage failed \(403\)/);
});
