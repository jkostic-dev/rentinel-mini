import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseHalooglasi } from "../src/providers/halooglasi.ts";
import type { Listing } from "../src/types.ts";

/**
 * The fixtures are five-card excerpts of a real search page: enough markup to exercise
 * every selector, little enough third-party HTML for a public repo. Every word that could
 * name a listing is scrambled; prices, dates and sizes are not, since those are what the
 * parser is tested on.
 */
export function readFixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

/**
 * Invariants hold for every card, so a markup change is caught even after a fixture
 * refresh. Exact values are asserted on the first card only, to keep refreshes cheap,
 * and only where the fixture is readable: names, places and links are scrambled.
 */
export function assertListingInvariants(
  listings: Listing[],
  listingPathPattern: RegExp,
  expectedCount: number,
): void {
  assert.equal(
    listings.length,
    expectedCount,
    `expected ${expectedCount} listings, got ${listings.length}`,
  );

  for (const listing of listings) {
    assert.ok(listing.name.length > 0, "listing name must not be empty");

    const url = new URL(listing.url);
    assert.match(url.protocol, /^https?:$/);
    assert.match(url.pathname, listingPathPattern);
    assert.equal(url.search, "", `${listing.url} must not carry a query`);
    assert.equal(url.hash, "", `${listing.url} must not carry a hash`);
  }
}

test("halooglasi: every parsed card is a usable listing", () => {
  const listings = parseHalooglasi(readFixture("halooglasi.html"));
  assertListingInvariants(listings, /^\/nekretnine\/.+\/\d+$/, 5);
});

test("halooglasi: maps every field of the first card", () => {
  const [first] = parseHalooglasi(readFixture("halooglasi.html"));
  assert.ok(first);

  assert.equal(first.location?.split(", ").length, 4);
  assert.equal(first.price.raw, "400 €");
  assert.equal(first.price.value, 400);
  assert.equal(first.price.currency, "EUR");
  assert.equal(first.datePosted, "2026-08-21");
});
