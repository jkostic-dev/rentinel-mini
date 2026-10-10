import { writeFile } from "node:fs/promises";
import { parsePage, providers } from "../src/providers/index.ts";
import type { ProviderId } from "../src/types.ts";
import { redactFixture } from "./redactFixture.ts";
import { trimHtml } from "./trimHtml.ts";

/**
 * Re-captures the committed test fixtures. Run by hand (`npm run fixtures`) when a site's markup moves.
 * URLs are hardcoded so every clone regenerates the same fixtures.
 */
type FixtureSpec = {
  url: string;
  /** The site's own words the parser or its tests read; every other word is scrambled. */
  keepWords: string[];
};

const FIXTURES: Record<ProviderId, FixtureSpec> = {
  "4zida": {
    url: "https://www.4zida.rs/izdavanje-stanova/vozdovac-opstina-beograd/do-400-evra?sortiranje=najnoviji",
    keepWords: [
      "izdavanje",
      "prodaja",
      "stanova",
      "Ažurirano",
      "Objavljeno",
      "soba",
      "sobe",
      "Beograd",
      "webp",
    ],
  },
  halooglasi: {
    url: "https://www.halooglasi.com/nekretnine/izdavanje-stanova/beograd-vozdovac?cena_d_to=400&cena_d_unit=4",
    keepWords: [
      "nekretnine",
      "image",
      "Kvadratura",
      "Broj",
      "soba",
      "Spratnost",
      "Beograd",
    ],
  },
};

for (const provider of providers) {
  const spec = FIXTURES[provider.id];
  console.log(`[fixtures] Fetching ${provider.id}: ${spec.url}`);

  const page = await provider.fetchPage(spec.url);
  // Trimmed to what the parser reads, and redacted so that no real listing is committed.
  const body = redactFixture(trimHtml(page.body), spec.keepWords);

  // Counted from what is written, so trimming or redacting away something the parser needs,
  // or a bot challenge, fails here rather than overwriting a good fixture.
  const listings = parsePage(provider, { ...page, body });
  if (listings.length === 0) {
    throw new Error(
      `[fixtures] ${provider.id} yielded 0 listings; refusing to write the fixture.`,
    );
  }

  const path = new URL(`../test/fixtures/${provider.id}.html`, import.meta.url);
  await writeFile(path, body);
  console.log(
    `[fixtures] Wrote ${provider.id}.html: ${listings.length} listings, ${Math.round(body.length / 1024)} KB`,
  );
}
