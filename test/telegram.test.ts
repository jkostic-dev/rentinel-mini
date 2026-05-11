import assert from "node:assert/strict";
import test from "node:test";
import { buildMessages } from "../src/telegram.ts";
import type { Listing } from "../src/types.ts";

function listing(overrides: Partial<Listing> = {}): Listing {
  return {
    name: "Dvosoban stan",
    queryName: "Voždovac 4zida p1",
    location: "Beograd, Voždovac",
    features: ["55 m²", "Broj soba: 2"],
    price: { value: 400, currency: "EUR", raw: "400 €" },
    datePosted: "2026-05-11",
    url: "https://www.4zida.rs/izdavanje-stanova/vozdovac/dvosoban-stan/6a76f7f94b04f57bc30620ec",
    ...overrides,
  };
}

test("renders name, price, location and url", () => {
  const [message] = buildMessages([listing()]);
  assert.ok(message);

  assert.match(message, /<b>Dvosoban stan<\/b>/);
  assert.ok(message.includes("400 €"));
  assert.ok(message.includes("Beograd, Voždovac"));
  assert.ok(message.includes("Voždovac 4zida p1"));
  assert.ok(
    message.includes(
      "https://www.4zida.rs/izdavanje-stanova/vozdovac/dvosoban-stan/6a76f7f94b04f57bc30620ec",
    ),
  );
});

test("escapes html so listing text cannot break the markup", () => {
  const [message] = buildMessages([
    listing({ name: "Stan <b>lux</b> & garaža", location: "A > B" }),
  ]);
  assert.ok(message);

  assert.ok(message.includes("Stan &lt;b&gt;lux&lt;/b&gt; &amp; garaža"));
  assert.ok(message.includes("A &gt; B"));
  // Only the formatter's own bold tags survive.
  assert.equal(message.match(/<b>/g)?.length, 1);
});

test("splits at the 4096 character limit without cutting a listing block", () => {
  const listings = Array.from({ length: 40 }, (_, index) =>
    listing({ name: `Stan broj ${index}` }),
  );

  const messages = buildMessages(listings);

  assert.ok(messages.length > 1, "expected the payload to split");
  for (const message of messages) {
    assert.ok(message.length <= 4096);
  }

  const joined = messages.join("\n");
  for (const item of listings) {
    assert.ok(joined.includes(item.name), `${item.name} went missing`);
    assert.ok(
      messages.some((message) => message.includes(`<b>${item.name}</b>`)),
      `${item.name} was split across two messages`,
    );
  }
});

test("a single listing that cannot fit is an error, not a truncated message", () => {
  assert.throws(
    () => buildMessages([listing({ name: "x".repeat(5000) })]),
    /exceeds Telegram message limit/,
  );
});

test('renders a date posted today as "today", in any timezone', () => {
  const now = new Date();
  const today = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");

  const [message] = buildMessages([listing({ datePosted: today })]);
  assert.ok(message?.includes("(today)"));
  assert.ok(message?.includes(today.split("-").reverse().join(".")));
});

test("an unparseable date renders as N/A rather than a bad date", () => {
  const [message] = buildMessages([listing({ datePosted: null })]);
  assert.ok(message?.includes("🗓️ N/A"));
});
