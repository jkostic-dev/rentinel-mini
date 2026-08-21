import { load } from "cheerio";
import { fetchHtml } from "../fetch.ts";
import type { Listing, Provider } from "../types.ts";
import {
  absoluteUrl,
  cleanText,
  inferCurrency,
  parseDate,
  parsePrice,
} from "./shared.ts";

const BASE_URL = "https://www.4zida.rs";
const HOSTS = new Set(["4zida.rs", "www.4zida.rs"]);
const LISTING_PATH_PATTERN =
  /\/(?:izdavanje|prodaja)-stanova\/.+\/[a-f0-9]{24}\/?$/i;

function isListingUrl(url: string): boolean {
  try {
    return LISTING_PATH_PATTERN.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

export function parse4zida(html: string): Listing[] {
  const $ = load(html);
  const listings: Listing[] = [];

  $("[test-data='ad-search-card']").each((_, element) => {
    const card = $(element);

    const href = card
      .find("a[href]")
      .map((__, anchor) => $(anchor).attr("href") ?? "")
      .get()
      .find((value) => /\/(?:izdavanje|prodaja)-stanova\//i.test(value));

    const url = absoluteUrl(href, BASE_URL);
    if (!url || !isListingUrl(url)) {
      return;
    }

    const nameParagraph = card
      .find("p.truncate.font-medium.leading-tight")
      .first();
    const name =
      cleanText(nameParagraph.text()) ??
      cleanText(card.find("img[alt]").first().attr("alt"));
    if (!name) {
      return;
    }

    // Anchored on position, not on Tailwind classes, which change without notice.
    const location =
      cleanText(nameParagraph.next("p").text()) ??
      cleanText(card.find("p.line-clamp-2").first().text());

    // Features are pill chips in the row directly below the title link.
    const features = nameParagraph
      .closest("a")
      .next("div")
      .children()
      .map((__, chip) => cleanText($(chip).text()))
      .get()
      .filter((chip): chip is string => Boolean(chip));

    const rawPrice = cleanText(card.find("p.bg-spotlight span").first().text());

    const dateText =
      cleanText(
        card
          .find("span")
          .filter((__, span) =>
            /Ažurirano|Azurirano|Objavljeno/i.test($(span).text()),
          )
          .last()
          .text(),
      ) ?? cleanText(card.text());

    listings.push({
      name,
      location,
      features,
      price: {
        value: parsePrice(rawPrice),
        currency: inferCurrency(rawPrice),
        raw: rawPrice,
      },
      datePosted: parseDate(dateText),
      url,
    });
  });

  return listings;
}

export const fourZida: Provider = {
  id: "4zida",
  matches: (url) => HOSTS.has(url.hostname.toLowerCase()),
  fetchPage: (url) => fetchHtml(url),
  parse: parse4zida,
};
