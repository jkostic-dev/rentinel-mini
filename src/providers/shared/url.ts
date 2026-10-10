/** `url` on https and the site's primary host, without a port or fragment. */
export function onHost(url: URL, host: string): URL {
  const canonical = new URL(url.href);
  canonical.protocol = "https:";
  canonical.hostname = host;
  canonical.port = "";
  canonical.hash = "";
  return canonical;
}

export type Site = {
  matches(url: URL): boolean;
  canonicalize(url: URL): URL;
  /** The paths that are ads. Anything else on the site is a filter or a cross-sell. */
  listingPath: RegExp;
};

/**
 * A link to one of the site's ads in canonical form, or null for anything else. The host is
 * checked before canonicalising, which would otherwise rewrite an off-domain link onto the site.
 */
export function listingUrl(
  raw: string | null | undefined,
  base: URL,
  site: Site,
): string | null {
  const url = raw?.trim() ? URL.parse(raw.trim(), base.href) : null;
  if (!url || !site.matches(url) || !site.listingPath.test(url.pathname))
    return null;

  const canonical = site.canonicalize(url);
  canonical.search = "";
  return canonical.toString();
}

/**
 * An absolute `http(s)` image URL, or null (which drops lazy-loader `data:` placeholders). The
 * host is not checked, since images come from CDNs.
 */
export function parseImageUrl(
  raw: string | null | undefined,
  base: URL,
): string | null {
  const text = raw?.trim();
  if (!text) return null;

  let url: URL;

  try {
    url = new URL(text, base);
  } catch {
    return null;
  }

  return url.protocol === "https:" || url.protocol === "http:"
    ? url.toString()
    : null;
}
