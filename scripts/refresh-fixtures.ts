import { load } from "cheerio";
import { writeFile } from "node:fs/promises";
import { providers } from "../src/providers/index.ts";
import type { ProviderId } from "../src/types.ts";
import { redactFixture } from "./redactFixture.ts";
import { trimHtml } from "./trimHtml.ts";

/**
 * Re-captures the committed test fixtures. Run by hand (`npm run fixtures`) when a site's markup moves.
 * URLs are hardcoded so every clone regenerates the same fixtures.
 */
type FixtureSpec = {
  url: string;
  /** The same card selector the provider parses with. */
  card: string;
  /** The site's own words the parser or its tests read; every other word is scrambled. */
  keepWords: string[];
};

/** Enough to exercise every selector, small enough to commit. */
const CARD_LIMIT = 5;

const FIXTURES: Record<ProviderId, FixtureSpec> = {
  "4zida": {
    url: "https://www.4zida.rs/izdavanje-stanova/vozdovac-opstina-beograd/do-400-evra?sortiranje=najnoviji",
    card: "[test-data='ad-search-card']",
    keepWords: [
      "izdavanje",
      "prodaja",
      "stanova",
      "Ažurirano",
      "soba",
      "Beograd",
    ],
  },
  halooglasi: {
    url: "https://www.halooglasi.com/nekretnine/izdavanje-stanova/beograd-vozdovac?cena_d_to=400&cena_d_unit=4",
    card: "#ad-list-2 .product-item.product-list-item[data-id]",
    keepWords: [
      "nekretnine",
      "Kvadratura",
      "Broj",
      "soba",
      "Spratnost",
      "Beograd",
    ],
  },
};

/** Cuts a page down to a few cards and their ancestors; the rest is not parsed, and not ours to republish. */
function keepCards(html: string, spec: FixtureSpec): string {
  const $ = load(html);

  const cards = $(spec.card);
  if (cards.length === 0) {
    throw new Error(`No card matched "${spec.card}"; the markup moved again.`);
  }
  cards.slice(CARD_LIMIT).remove();

  const KEEP = "data-fixture-keep";
  $(spec.card).parents().addBack().attr(KEEP, "");
  $("body *").each((_, element) => {
    const node = $(element);
    if (node.is(`[${KEEP}]`) || node.closest(spec.card).length > 0) {
      return;
    }
    node.remove();
  });
  $(`[${KEEP}]`).removeAttr(KEEP);

  return $.html();
}

for (const provider of providers) {
  const spec = FIXTURES[provider.id];
  console.log(`[fixtures] Fetching ${provider.id}: ${spec.url}`);

  // Redacted so that no real listing is committed.
  const html = redactFixture(
    trimHtml(keepCards(await provider.fetchPage(spec.url), spec)),
    spec.keepWords,
  );
  const listings = provider.parse(html);

  // A bot challenge must never overwrite a good fixture.
  if (listings.length === 0) {
    throw new Error(
      `[fixtures] ${provider.id} yielded 0 listings; refusing to write the fixture.`,
    );
  }

  const path = new URL(`../test/fixtures/${provider.id}.html`, import.meta.url);
  await writeFile(path, html);
  console.log(
    `[fixtures] Wrote ${provider.id}.html: ${listings.length} listings, ${Math.round(html.length / 1024)} KB`,
  );
}
