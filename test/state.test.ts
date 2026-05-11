import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadState, saveState, selectNewListings } from "../src/state.ts";
import type { Listing, State, Target } from "../src/types.ts";

const page1: Target = { queryName: "Voždovac p1", url: "https://site/p1" };
const page2: Target = { queryName: "Voždovac p2", url: "https://site/p2" };

function listing(url: string): Listing {
  return {
    name: `Stan ${url}`,
    location: null,
    features: [],
    price: { value: null, currency: null, raw: null },
    datePosted: null,
    url,
  };
}

function emptyState(): State {
  return { seenUrls: [], seededTargets: [] };
}

async function tempStatePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "rentinel-state-"));
  return join(directory, "seen-listings.json");
}

test("a target's first run records its listings and notifies about none", () => {
  const { newListings, nextState } = selectNewListings(emptyState(), page1, [
    listing("https://site/a"),
    listing("https://site/b"),
  ]);

  assert.deepEqual(newListings, []);
  assert.deepEqual(nextState.seenUrls.sort(), [
    "https://site/a",
    "https://site/b",
  ]);
  assert.deepEqual(nextState.seededTargets, [page1.url]);
});

test("a seeded target notifies only about listings it has not seen", () => {
  const seeded = selectNewListings(emptyState(), page1, [
    listing("https://site/a"),
  ]).nextState;

  const { newListings, nextState } = selectNewListings(seeded, page1, [
    listing("https://site/a"),
    listing("https://site/b"),
  ]);

  assert.deepEqual(
    newListings.map((item) => item.url),
    ["https://site/b"],
  );
  assert.equal(nextState.seenUrls.length, 2);
});

test("a listing on two targets notifies once", () => {
  let state = selectNewListings(emptyState(), page1, []).nextState;
  state = selectNewListings(state, page2, []).nextState;

  // The same listing slides from page 1 to page 2 between cycles.
  const onPage1 = selectNewListings(state, page1, [listing("https://site/x")]);
  assert.equal(onPage1.newListings.length, 1);

  const onPage2 = selectNewListings(onPage1.nextState, page2, [
    listing("https://site/x"),
  ]);
  assert.deepEqual(onPage2.newListings, []);
});

test("adding a target later stays quiet without re-seeding the existing one", () => {
  const afterPage1 = selectNewListings(emptyState(), page1, [
    listing("https://site/a"),
  ]).nextState;

  const afterPage2 = selectNewListings(afterPage1, page2, [
    listing("https://site/c"),
  ]);

  assert.deepEqual(afterPage2.newListings, []);
  assert.deepEqual(afterPage2.nextState.seededTargets, [page1.url, page2.url]);
});

test("state survives a save/load round trip", async () => {
  const path = await tempStatePath();
  await saveState(path, {
    seenUrls: ["https://site/b", "https://site/a"],
    seededTargets: [page1.url],
  });

  const loaded = await loadState(path);
  assert.deepEqual(loaded, {
    seenUrls: ["https://site/a", "https://site/b"],
    seededTargets: [page1.url],
  });
});

test("a missing state file loads as empty state", async () => {
  const path = await tempStatePath();
  assert.deepEqual(await loadState(path), emptyState());
});
