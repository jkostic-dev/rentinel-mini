import type { Listing, Provider, RawPage } from "../types.ts";
import { asObject, asText, type JsonObject } from "./shared/json.ts";
import { mergeByUrl } from "./shared/merge.ts";
import { parsePrice } from "./shared/price.ts";
import { listingUrl, onHost, parseImageUrl } from "./shared/url.ts";

const HOST = "www.nekretnine.rs";
const ORIGIN = `https://${HOST}`;
const HOSTS = new Set(["nekretnine.rs", HOST]);
const API = `${ORIGIN}/api-next`;
const PAGE_PARAM = "pag";
const LISTING_PATH = /^\/oglasi\/\d+\/?$/;

/** The first path segment is `<contract>-<category>`, e.g. `izdavanje-stanova`. */
const CONTRACTS: Record<string, string> = { prodaja: "1", izdavanje: "2" };

const CATEGORIES: Record<string, Record<string, string>> = {
  "stambenih-nekretnina": { idCategoria: "1" },
  stanova: { idCategoria: "1", "idTipologia[]": "4" },
  "samostalnih-kuca": { idCategoria: "1", "idTipologia[]": "7" },
  "vikendica-brvnara": { idCategoria: "1", "idTipologia[]": "11" },
  soba: { idCategoria: "4" },
};

/** Autocomplete `type` (geography level) to the search parameter that level is sent as. */
const GEO_PARAMS: Record<number, string> = {
  [-1]: "idNazione",
  0: "fkRegione",
  1: "idProvincia",
  2: "idComune",
  3: "idMZona[]",
  6: "idQuartiere[]",
};

const COUNTRY = { slug: "srbija", id: "RS" } as const;

const HEADERS = {
  "user-agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  accept: "application/json",
};

function matches(url: URL): boolean {
  return HOSTS.has(url.hostname.toLowerCase());
}

function canonicalize(url: URL): URL {
  const canonical = onHost(url, HOST);
  if (!canonical.pathname.endsWith("/")) canonical.pathname += "/";
  return canonical;
}

const parseListingUrl = (href: string | null | undefined, base: URL) =>
  listingUrl(href, base, { matches, canonicalize, listingPath: LISTING_PATH });

async function getJson(url: string): Promise<RawPage> {
  const response = await fetch(url, { headers: HEADERS });

  if (!response.ok) {
    // The HTML pages are behind DataDome. If the API ever joins them, say so.
    const challenged = response.headers.has("x-datadome");

    throw new Error(
      `nekretnine returned ${response.status}${challenged ? " (DataDome challenge)" : ""} for ${url}`,
    );
  }

  return { url: response.url, body: await response.text() };
}

function toObjects(value: unknown): JsonObject[] {
  const object = asObject(value);
  return object ? [object] : [];
}

/** `izdavanje-stanova` is rent, residential, apartments. */
function categoryParams(segment: string): Record<string, string> | null {
  const dash = segment.indexOf("-");
  const idContratto = CONTRACTS[segment.slice(0, dash)];
  const ids = CATEGORIES[segment.slice(dash + 1)];
  return idContratto && ids ? { idContratto, ...ids } : null;
}

/** Looks the last path segment up in the site's autocomplete, which returns it and its parents. */
async function geoParams(
  segments: string[],
): Promise<Record<string, string> | null> {
  const slug = segments.at(-1);
  if (!slug) return null;
  if (slug === COUNTRY.slug) return { idNazione: COUNTRY.id };

  const query = new URLSearchParams({
    query: slug.replaceAll("-", " "),
    macrozones: "1",
    microzones: "1",
    // Without this the neighbourhood level is left out of the answer.
    min_level: "9",
    __lang: "sr",
  });

  const { body } = await getJson(`${API}/geography/autocomplete/?${query}`);
  const places: unknown = JSON.parse(body);
  if (!Array.isArray(places)) return null;

  const parent = segments.at(-2);

  const candidates = places
    .flatMap((place) => toObjects(place))
    .filter((place) => asText(place["keyurl"]) === slug);

  const parentsOf = (place: JsonObject): JsonObject[] => {
    const parents = place["parents"];
    return Array.isArray(parents)
      ? parents.flatMap((entry) => toObjects(entry))
      : [];
  };

  // Two places can share a slug across cities; the preceding segment disambiguates.
  const place =
    candidates.find((candidate) =>
      parentsOf(candidate).some((entry) => asText(entry["keyurl"]) === parent),
    ) ?? candidates[0];

  if (!place) return null;

  const ids: Record<string, string> = {};

  for (const level of [place, ...parentsOf(place)]) {
    const name =
      typeof level["type"] === "number" ? GEO_PARAMS[level["type"]] : undefined;
    const id = asText(level["id"]);
    if (name && id) ids[name] = id;
  }

  return ids;
}

/**
 * The ids the search API wants in place of a path. The mapping is ours and could be wrong, so the
 * ids go back through the site's resolver, and anything but the original path fails the fetch
 * instead of silently watching a broader search.
 */
async function resolveSearch(
  pathname: string,
): Promise<Record<string, string>> {
  const [category, ...geography] = pathname.split("/").filter(Boolean);

  const ids = {
    ...categoryParams(category ?? ""),
    ...(await geoParams(geography)),
  };

  const query = new URLSearchParams({ ...ids, __lang: "sr" });

  const { body } = await getJson(
    `${API}/search-list/url-resolver/?${query}`,
  ).catch(() => ({
    body: "null",
  }));

  const resolved = asText(asObject(JSON.parse(body))?.["url"]);

  if (resolved !== pathname) {
    throw new Error(
      `nekretnine cannot watch ${pathname}: it resolves to ${resolved ?? "nothing"}`,
    );
  }

  return ids;
}

/** Resolved once per process, not once per scrape. */
const resolvedSearches = new Map<string, Promise<Record<string, string>>>();

function resolveSearchOnce(pathname: string): Promise<Record<string, string>> {
  let resolving = resolvedSearches.get(pathname);

  if (!resolving) {
    resolving = resolveSearch(pathname);
    resolvedSearches.set(pathname, resolving);
    // Failures are not cached.
    resolving.catch(() => resolvedSearches.delete(pathname));
  }

  return resolving;
}

/** Fetches the site's internal search API. Its HTML pages are behind a captcha; the API is not. */
async function fetchPage(url: string): Promise<RawPage> {
  const target = canonicalize(new URL(url));
  const ids = await resolveSearchOnce(target.pathname);

  const query = new URLSearchParams(target.searchParams);
  for (const [name, value] of Object.entries(ids)) query.set(name, value);
  if (!query.has(PAGE_PARAM)) query.set(PAGE_PARAM, "1");
  query.set("path", target.pathname);
  query.set("__lang", "sr");

  return getJson(`${API}/search-list/listings/?${query}`);
}

function searchResults(body: string): unknown[] {
  try {
    const results = asObject(JSON.parse(body))?.["results"];
    return Array.isArray(results) ? results : [];
  } catch {
    return [];
  }
}

/** "Street, neighbourhood, municipality, city", skipping whatever is empty or repeated. */
function parseLocation(location: JsonObject | null): string | null {
  const parts = ["address", "microzone", "macrozone", "city"].flatMap(
    (key) => asText(location?.[key]) ?? [],
  );

  return parts.length > 0 ? [...new Set(parts)].join(", ") : null;
}

function parseFeatures(property: JsonObject | null): string[] {
  const featureList = property?.["featureList"];
  if (!Array.isArray(featureList)) return [];

  return featureList.flatMap(
    (feature) => asText(asObject(feature)?.["label"]) ?? [],
  );
}

function parseNekretnine(body: string, base: URL): Listing[] {
  const listings = searchResults(body).flatMap((result): Listing[] => {
    const realEstate = asObject(asObject(result)?.["realEstate"]);
    const url = parseListingUrl(
      asText(asObject(asObject(result)?.["seo"])?.["url"]),
      base,
    );
    const name = asText(realEstate?.["title"]);
    if (!realEstate || !url || !name) return [];

    const properties = realEstate["properties"];
    const property = asObject(Array.isArray(properties) ? properties[0] : null);
    const price = asObject(realEstate["price"]);
    const parsedPrice = parsePrice(asText(price?.["formattedValue"]));
    const value = price?.["value"];
    const photoUrls = asObject(asObject(property?.["photo"])?.["urls"]);

    return [
      {
        url,
        name,
        location: parseLocation(asObject(property?.["location"])),
        features: parseFeatures(property),
        // Unpromoted ads carry no `visibility` at all.
        tier: asText(realEstate["visibility"]) ?? "standard",
        price: {
          ...parsedPrice,
          value:
            typeof value === "number" && Number.isFinite(value)
              ? value
              : parsedPrice.value,
        },
        // The API returns no date.
        datePosted: null,
        imageUrl: parseImageUrl(
          asText(photoUrls?.["medium"]) ?? asText(photoUrls?.["small"]),
          base,
        ),
      },
    ];
  });

  return mergeByUrl(listings);
}

export const nekretnine: Provider = {
  id: "nekretnine",
  matches,
  fetchPage,
  parse: parseNekretnine,
};
