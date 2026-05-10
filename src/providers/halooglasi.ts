import { load } from "cheerio";
import { fetchHtmlWithBrowser } from "../fetch.ts";
import type { Listing, Provider } from "../types.ts";
import {
  absoluteUrl,
  cleanText,
  inferCurrency,
  parseDate,
  parsePrice,
} from "./shared.ts";

const BASE_URL = "https://www.halooglasi.com";
const HOSTS = new Set(["halooglasi.com", "www.halooglasi.com"]);
const LISTING_PATH_PATTERN = /\/nekretnine\/.+\/\d+$/i;
const RESULTS_SELECTOR = "#ad-list-2 .product-item.product-list-item";

/** halooglasi labels square metres "m2"; the cards read better with "m²". */
function normalizeFeatureText(raw: string): string {
  const normalized = raw
    .replace(/\bm2\s*kvadratura\b\s*:\s*([0-9]+(?:[.,][0-9]+)?)/gi, "$1 m²")
    .replace(/\bm2\s*kvadratura\b\s*([0-9]+(?:[.,][0-9]+)?)/gi, "$1 m²")
    .replace(/\bm2\b/gi, "m²")
    .replace(/(\d)\s*m²\b/g, "$1 m²");

  return cleanText(normalized) ?? raw;
}

/** Feature cells read "65 Kvadratura"; flip them into "Kvadratura: 65". */
function buildFeatureText(valueWrapperText: string): string | null {
  const compact = cleanText(valueWrapperText);
  if (!compact) {
    return null;
  }

  const match = compact.match(/(.+?)\s+([A-ZČĆŠĐŽa-zčćšđž].*)$/);
  const value = cleanText(match?.[1]);
  const legend = cleanText(match?.[2]);
  if (!value || !legend) {
    return normalizeFeatureText(compact);
  }

  return normalizeFeatureText(`${legend}: ${value}`);
}

function isListingUrl(url: string): boolean {
  try {
    return LISTING_PATH_PATTERN.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

export function parseHalooglasi(html: string): Listing[] {
  const $ = load(html);
  const listings: Listing[] = [];

  $("#ad-list-2 .product-item.product-list-item[data-id]")
    .filter((_, element) => !$(element).hasClass("banner-list"))
    .each((_, element) => {
      const card = $(element);

      const href =
        card.find("h3.product-title a[href]").first().attr("href") ??
        card.find("a.a-images[href]").first().attr("href");
      const url = absoluteUrl(href, BASE_URL);
      if (!url || !isListingUrl(url)) {
        return;
      }

      const name = cleanText(card.find("h3.product-title a").first().text());
      if (!name) {
        return;
      }

      const locationParts = card
        .find("ul.subtitle-places li")
        .map((__, li) => cleanText($(li).text()))
        .get()
        .filter((part): part is string => Boolean(part));

      const features = card
        .find("ul.product-features li .value-wrapper")
        .map((__, node) => buildFeatureText($(node).text()))
        .get()
        .filter((feature): feature is string => Boolean(feature));

      const priceDataValue = cleanText(
        card
          .find(".central-feature span[data-value]")
          .first()
          .attr("data-value"),
      );
      const rawPrice =
        cleanText(card.find(".central-feature i").first().text()) ??
        cleanText(card.find(".central-feature").first().text());

      const dateText = cleanText(card.find("span.publish-date").first().text());

      listings.push({
        name,
        location: locationParts.length > 0 ? locationParts.join(", ") : null,
        features,
        price: {
          value: parsePrice(priceDataValue ?? rawPrice),
          currency: inferCurrency(rawPrice),
          raw: rawPrice,
        },
        datePosted: parseDate(dateText) ?? parseDate(card.text()),
        url,
      });
    });

  return listings;
}

export const halooglasi: Provider = {
  id: "halooglasi",
  matches: (url) => HOSTS.has(url.hostname.toLowerCase()),
  fetchPage: (url) => fetchHtmlWithBrowser(url, RESULTS_SELECTOR),
  parse: parseHalooglasi,
};
