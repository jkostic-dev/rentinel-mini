import { load } from "cheerio";

/** The attributes selectors and parsers read. Everything else is styling and tracking. */
const KEPT_ATTRIBUTES = new Set([
  "class",
  "id",
  "href",
  "src",
  "alt",
  "type",
  "data-id",
  "data-value",
  "test-data",
]);

const NOT_CONTENT =
  "script:not([type='application/ld+json']), style, svg, noscript, link, meta, iframe, form, header, footer, nav";

/**
 * A fetched page cut down to what a parser reads: scripts, styles, page chrome, and unread
 * attributes are dropped. JSON-LD stays, since providers parse it.
 */
export function trimHtml(html: string): string {
  const $ = load(html);
  $(NOT_CONTENT).remove();

  $("*")
    .contents()
    .filter((_, node) => node.type === "comment")
    .remove();

  $("*").each((_, element) => {
    if (!("attribs" in element)) return;

    for (const name of Object.keys(element.attribs)) {
      if (!KEPT_ATTRIBUTES.has(name)) $(element).removeAttr(name);
    }
  });

  return $.html().replace(/\n\s*\n/g, "\n");
}
