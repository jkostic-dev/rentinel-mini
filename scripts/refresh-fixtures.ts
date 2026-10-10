import { writeFile } from "node:fs/promises";
import { parsePage, providers } from "../src/providers/index.ts";
import { asObject } from "../src/providers/shared/json.ts";
import type { ProviderId } from "../src/types.ts";
import { redactFixture } from "./redactFixture.ts";
import { trimHtml } from "./trimHtml.ts";

/**
 * Re-captures the committed test fixtures. Run by hand (`npm run fixtures`) when a site's markup moves.
 * URLs are hardcoded so every clone regenerates the same fixtures.
 */
type FixtureSpec = {
  file: string;
  url: string;
  /** Cuts the fetched body down to what the parser reads. */
  trim: (body: string) => string;
  /** The site's own words the parser or its tests read; every other word is scrambled. */
  keepWords: string[];
};

const FIXTURES: Record<ProviderId, FixtureSpec> = {
  "4zida": {
    file: "4zida.html",
    trim: trimHtml,
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
    file: "halooglasi.html",
    trim: trimHtml,
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
  nekretnine: {
    file: "nekretnine.json",
    trim: trimNekretnine,
    url: "https://www.nekretnine.rs/izdavanje-stambenih-nekretnina/beograd/vozdovac/?criterio=data&ordine=desc&prezzoMassimo=400",
    keepWords: [
      "oglasi",
      "image",
      "premium",
      "mesec",
      "soba",
      "sobe",
      "Beograd",
    ],
  },
};

/** The search API's answer with only the fields the parser reads, which leaves out advertisers' contacts. */
function trimNekretnine(body: string): string {
  const pick = (source: unknown, keys: string[]) =>
    Object.fromEntries(
      keys.flatMap((key) => {
        const value = asObject(source)?.[key];
        return value === undefined ? [] : [[key, value]];
      }),
    );

  const answer = asObject(JSON.parse(body))?.results;
  const results = (Array.isArray(answer) ? answer : []).map((result) => {
    const realEstate = asObject(asObject(result)?.realEstate);
    const properties = realEstate?.properties;
    const property = asObject(Array.isArray(properties) ? properties[0] : null);
    const features = property?.featureList;

    return {
      seo: pick(asObject(result)?.seo, ["url"]),
      realEstate: {
        ...pick(realEstate, ["title", "visibility"]),
        price: pick(realEstate?.price, ["value", "formattedValue"]),
        properties: [
          {
            location: pick(property?.location, [
              "address",
              "microzone",
              "macrozone",
              "city",
            ]),
            featureList: Array.isArray(features)
              ? features.map((feature) => pick(feature, ["label"]))
              : [],
            photo: {
              urls: pick(asObject(property?.photo)?.urls, ["medium", "small"]),
            },
          },
        ],
      },
    };
  });

  return JSON.stringify({ results });
}

// `npm run fixtures -- 4zida` refreshes one provider; without a name, all of them.
const [only] = process.argv.slice(2);

for (const provider of providers) {
  if (only && provider.id !== only) continue;

  const spec = FIXTURES[provider.id];
  console.log(`[fixtures] Fetching ${provider.id}: ${spec.url}`);

  const page = await provider.fetchPage(spec.url);
  // Trimmed to what the parser reads, and redacted so that no real listing is committed.
  const body = redactFixture(spec.trim(page.body), spec.keepWords);

  // Counted from what is written, so trimming or redacting away something the parser needs,
  // or a bot challenge, fails here rather than overwriting a good fixture.
  const listings = parsePage(provider, { ...page, body });
  if (listings.length === 0) {
    throw new Error(
      `[fixtures] ${provider.id} yielded 0 listings; refusing to write the fixture.`,
    );
  }

  const path = new URL(`../test/fixtures/${spec.file}`, import.meta.url);
  await writeFile(path, body);
  console.log(
    `[fixtures] Wrote ${spec.file}: ${listings.length} listings, ${Math.round(body.length / 1024)} KB`,
  );
}
