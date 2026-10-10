export type ProviderId = "4zida" | "halooglasi" | "nekretnine";

export type ListingPrice = {
  value: number | null;
  currency: string | null;
  raw: string | null;
};

/**
 * `tier` is the provider's promotion label, null where it has none. `datePosted` is `YYYY-MM-DD`,
 * the most recent date the site shows, which on some providers is an updated date.
 */
export type Listing = {
  /** Canonical: https, the site's primary host, no query or hash. This is the dedupe key. */
  url: string;
  name: string;
  location: string | null;
  features: string[];
  tier: string | null;
  price: ListingPrice;
  datePosted: string | null;
  imageUrl: string | null;
};

export type RawPage = {
  /** Where the body was served from after redirects, not the URL requested. */
  url: string;
  /** HTML, or whatever else the provider fetches: nekretnine reads a JSON API. */
  body: string;
};

export type Provider = {
  id: ProviderId;
  matches(url: URL): boolean;
  fetchPage(url: string): Promise<RawPage>;
  /** `servedFrom` is on the provider's own domain; relative links resolve against it. */
  parse(body: string, servedFrom: URL): Listing[];
};

export type State = {
  seenUrls: string[];
  seededTargets: string[];
};

export type Target = {
  queryName: string;
  url: string;
};

export type Config = {
  targets: Target[];
  telegramToken: string;
  telegramChatIds: string[];
  scrapeIntervalMs: number;
  stateFilePath: string;
};
