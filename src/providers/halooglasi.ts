import { load } from "cheerio";
import { fetchHtmlWithBrowser } from "../fetch.ts";
import type { Listing, Provider } from "../types.ts";
import { toIsoDate } from "./shared/date.ts";
import { mergeByUrl } from "./shared/merge.ts";
import { parsePrice } from "./shared/price.ts";
import { cleanText } from "./shared/text.ts";
import { listingUrl, onHost, parseImageUrl } from "./shared/url.ts";

const HOST = "www.halooglasi.com";
const HOSTS = new Set(["halooglasi.com", HOST]);
const LISTING_PATH = /\/nekretnine\/.+\/\d+$/i;
const RESULTS_SELECTOR = "#ad-list-2 .product-item.product-list-item";

function matches(url: URL): boolean {
  return (
    HOSTS.has(url.hostname.toLowerCase()) &&
    url.pathname.startsWith("/nekretnine")
  );
}

const parseListingUrl = (href: string | null | undefined, base: URL) =>
  listingUrl(href, base, {
    matches,
    canonicalize: (url) => onHost(url, HOST),
    listingPath: LISTING_PATH,
  });

function tierFromClass(cardClass: string): string {
  if (/\bPremium\b/.test(cardClass)) return "premium";
  if (/\bTop\b/.test(cardClass)) return "top";
  return "standard";
}

/** The area is labelled "m2 Kvadratura", so it reads as `40 m²` rather than `m2 Kvadratura: 40`. */
function normalizeUnits(feature: string): string {
  const normalized = feature
    .replace(/\bm2\s*kvadratura\b\s*:?\s*([0-9]+(?:[.,][0-9]+)?)/gi, "$1 m²")
    .replace(/\bmtk\b/gi, "m²")
    .replace(/\bm2\b/gi, "m²")
    .replace(/(\d)\s*m²\b/g, "$1 m²");

  return cleanText(normalized) ?? feature;
}

/** A feature is written value first, then its legend: "1.5 Broj soba" reads as "Broj soba: 1.5". */
function parseFeature(valueWrapperText: string): string | null {
  const text = cleanText(valueWrapperText);
  if (!text) return null;

  const [, value, legend] = text.match(/(.+?)\s+([A-ZČĆŠĐŽa-zčćšđž].*)$/) ?? [];
  return normalizeUnits(value && legend ? `${legend}: ${value}` : text);
}

/** A card without a photo shows a stock `no-image.jpg`. */
function parseCardImage(src: string | undefined, base: URL): string | null {
  return src && !/\/no-image\./i.test(src) ? parseImageUrl(src, base) : null;
}

function parseHalooglasi(html: string, base: URL): Listing[] {
  const $ = load(html);

  const listings = $(`${RESULTS_SELECTOR}[data-id]`)
    .not(".banner-list")
    .toArray()
    .flatMap((element): Listing[] => {
      const card = $(element);
      const title = card.find("h3.product-title a").first();
      const url = parseListingUrl(
        title.attr("href") ??
          card.find("a.a-images[href]").first().attr("href"),
        base,
      );
      const name = cleanText(title.text());
      if (!url || !name) return [];

      const places = card
        .find("ul.subtitle-places li")
        .toArray()
        .flatMap((place) => cleanText($(place).text()) ?? []);

      const priceBox = card.find(".central-feature").first();
      const rawPrice =
        cleanText(priceBox.find("i").first().text()) ??
        cleanText(priceBox.text());
      // `data-value` is the exact number behind the formatted price.
      const exactPrice = cleanText(
        priceBox.find("span[data-value]").first().attr("data-value"),
      );

      return [
        {
          url,
          name,
          location: places.length > 0 ? places.join(", ") : null,
          features: card
            .find("ul.product-features li .value-wrapper")
            .toArray()
            .flatMap((feature) => parseFeature($(feature).text()) ?? []),
          tier: tierFromClass(card.attr("class") ?? ""),
          price: {
            ...parsePrice(rawPrice),
            value: parsePrice(exactPrice ?? rawPrice).value,
          },
          datePosted:
            toIsoDate(card.find("span.publish-date").first().text()) ??
            toIsoDate(card.text()),
          imageUrl: parseCardImage(
            card.find("a.a-images img[src]").first().attr("src"),
            base,
          ),
        },
      ];
    });

  return mergeByUrl(listings);
}

export const halooglasi: Provider = {
  id: "halooglasi",
  matches,
  fetchPage: (url) => fetchHtmlWithBrowser(url, RESULTS_SELECTOR),
  parse: parseHalooglasi,
};
