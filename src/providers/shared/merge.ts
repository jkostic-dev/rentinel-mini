import type { Listing } from "../../types.ts";
import { cleanText } from "./text.ts";

function mergeFeatures(left: string[], right: string[]): string[] {
  const unique = new Set<string>();

  for (const feature of [...left, ...right]) {
    const cleaned = cleanText(feature);
    if (cleaned) unique.add(cleaned);
  }

  return [...unique];
}

function merge(base: Listing, extra: Listing): Listing {
  return {
    url: base.url,
    name: base.name || extra.name,
    location: base.location ?? extra.location,
    features: mergeFeatures(base.features, extra.features),
    tier: base.tier ?? extra.tier,
    price: {
      value: base.price.value ?? extra.price.value,
      currency: base.price.currency ?? extra.price.currency,
      raw: base.price.raw ?? extra.price.raw,
    },
    datePosted: base.datePosted ?? extra.datePosted,
    imageUrl: base.imageUrl ?? extra.imageUrl,
  };
}

/**
 * Folds several readings of one page (JSON-LD nodes, DOM cards) into one listing per URL. Earlier
 * readings win, and the order of first appearance is kept.
 */
export function mergeByUrl(listings: Listing[]): Listing[] {
  const byUrl = new Map<string, Listing>();

  for (const listing of listings) {
    const existing = byUrl.get(listing.url);
    byUrl.set(listing.url, existing ? merge(existing, listing) : listing);
  }

  return [...byUrl.values()];
}
