import { load } from "cheerio";
import { fetchHtml } from "../fetch.ts";
import type { Listing, Provider } from "../types.ts";
import { toIsoDate } from "./shared/date.ts";
import {
  asObject,
  asText,
  collectByType,
  extractJsonLd,
  type JsonObject,
} from "./shared/json.ts";
import { mergeByUrl } from "./shared/merge.ts";
import { parsePrice } from "./shared/price.ts";
import { cleanText } from "./shared/text.ts";
import { listingUrl, onHost, parseImageUrl } from "./shared/url.ts";

const HOST = "www.4zida.rs";
const HOSTS = new Set(["4zida.rs", HOST]);

/** Ads end in a 24-character id. Anything else on these paths is a filter or a cross-sell. */
const LISTING_PATH = /^\/(?:izdavanje|prodaja)-stanova\/.+\/[a-f0-9]{24}\/?$/i;

function matches(url: URL): boolean {
  return HOSTS.has(url.hostname.toLowerCase());
}

const parseListingUrl = (href: string | null | undefined, base: URL) =>
  listingUrl(href, base, {
    matches,
    canonicalize: (url) => onHost(url, HOST),
    listingPath: LISTING_PATH,
  });

/** JSON-LD has the exact price and floor area but no date or address; the cards supply those. */
function parseJsonLd(html: string, base: URL): Listing[] {
  const nodes = extractJsonLd(html).flatMap((block) =>
    collectByType(block, "RealEstateListing"),
  );

  return nodes.flatMap((node) => {
    const offer = asObject(node.offers);

    const url = parseListingUrl(
      asText(node.url) ?? asText(node["@id"]) ?? asText(offer?.url),
      base,
    );

    const name = asText(node.name);
    if (!url || !name) return [];

    return [
      {
        url,
        name,
        location: null,
        features: floorSizeFeature(asObject(node.itemOffered)),
        tier: null,
        price: parsePrice(
          asText(offer?.price),
          asText(offer?.priceCurrency) ?? "EUR",
        ),
        datePosted: toIsoDate(
          asText(node.datePosted) ?? asText(node.datePublished),
        ),
        imageUrl: parseImageUrl(primaryImage(node.image), base),
      },
    ];
  });
}

/** `image` is an `ImageObject`, a bare URL, or a list of either; the first is the primary one. */
function primaryImage(image: unknown): string | null {
  const first = Array.isArray(image) ? image[0] : image;
  const object = asObject(first);
  return object
    ? (asText(object.url) ?? asText(object.contentUrl))
    : asText(first);
}

/** `{ value: 38, unitCode: "MTK" }` reads as `38 m²`, which is how the site writes it. */
function floorSizeFeature(itemOffered: JsonObject | null): string[] {
  const floorSize = asObject(itemOffered?.floorSize);
  const value = asText(floorSize?.value);
  if (!value) return [];

  const unit = asText(floorSize?.unitCode);
  return [unit ? `${value} ${unit.replace(/^MTK$/i, "m²")}` : value];
}

function parseCards(html: string, base: URL): Listing[] {
  const $ = load(html);

  return $("[test-data='ad-search-card']")
    .toArray()
    .flatMap((element) => {
      const card = $(element);

      const href = card
        .find("a[href]")
        .toArray()
        .map((anchor) => $(anchor).attr("href"))
        .find((candidate) => /-stanova\//i.test(candidate ?? ""));

      const url = parseListingUrl(href, base);
      const title = card.find("p.truncate.font-medium.leading-tight").first();
      const name =
        cleanText(title.text()) ??
        cleanText(card.find("img[alt]").first().attr("alt"));
      if (!url || !name) return [];

      const updated = card
        .find("span")
        .toArray()
        .map((span) => cleanText($(span).text()))
        .findLast(
          (text) =>
            text !== null && /Ažurirano|Azurirano|Objavljeno/i.test(text),
        );

      return [
        {
          url,
          name,
          location: cleanText(title.next("p").text()),
          features: card
            .find("span.rounded-full")
            .toArray()
            .flatMap((pill) => cleanText($(pill).text()) ?? []),
          tier: null,
          price: parsePrice(card.find("p.bg-spotlight span").first().text()),
          datePosted: toIsoDate(updated),
          // The card's `<img>` is a lazy-loaded `srcset`; JSON-LD names the same image outright.
          imageUrl: null,
        },
      ];
    });
}

export const fourZida: Provider = {
  id: "4zida",
  matches,
  fetchPage: fetchHtml,
  parse: (html, base) =>
    mergeByUrl([...parseJsonLd(html, base), ...parseCards(html, base)]),
};
