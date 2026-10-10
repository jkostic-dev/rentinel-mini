import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { afterEach, mock } from "node:test";
import { fourZida } from "../src/providers/4zida.ts";
import { halooglasi } from "../src/providers/halooglasi.ts";
import { parsePage, resolveProvider } from "../src/providers/index.ts";
import { nekretnine } from "../src/providers/nekretnine.ts";
import type { Listing, Provider } from "../src/types.ts";

const SEARCH = {
  "4zida":
    "https://www.4zida.rs/izdavanje-stanova/vozdovac-opstina-beograd/do-400-evra",
  halooglasi:
    "https://www.halooglasi.com/nekretnine/izdavanje-stanova/beograd-vozdovac",
  nekretnine:
    "https://www.nekretnine.rs/izdavanje-stambenih-nekretnina/beograd/vozdovac/?prezzoMassimo=400",
};

const FIXTURE = {
  "4zida": "4zida.html",
  halooglasi: "halooglasi.html",
  nekretnine: "nekretnine.json",
};

function readFixture(provider: Provider): string {
  return readFileSync(
    new URL(`./fixtures/${FIXTURE[provider.id]}`, import.meta.url),
    "utf8",
  );
}

/**
 * The fixtures are real search pages (for nekretnine, a search API answer), trimmed to what the parsers read. Every word, link and
 * id that could point at a real listing is scrambled; prices, dates and sizes are not, since
 * those are what the parsers are tested on.
 */
function parseFixture(provider: Provider): Listing[] {
  return parsePage(provider, {
    url: SEARCH[provider.id],
    body: readFixture(provider),
  });
}

/** Holds for every listing, so a markup change is caught even after a fixture refresh. */
function assertUsableListings(
  listings: Listing[],
  host: string,
  listingPath: RegExp,
): void {
  assert.ok(listings.length >= 5, `only ${listings.length} listings parsed`);

  for (const listing of listings) {
    const url = new URL(listing.url);
    assert.equal(url.origin, `https://${host}`);
    assert.match(url.pathname, listingPath);
    assert.equal(url.search, "", `${listing.url} must not carry a query`);
    assert.equal(url.hash, "", `${listing.url} must not carry a hash`);

    assert.ok(listing.name.length > 0, `${listing.url} lost its name`);
    assert.ok(listing.location, `${listing.url} lost its location`);
    assert.ok(listing.features.length > 0, `${listing.url} lost its features`);
    assert.ok(listing.price.value, `${listing.url} lost its price`);
    assert.equal(listing.price.currency, "EUR");
  }

  const urls = listings.map((listing) => listing.url);
  assert.equal(new Set(urls).size, urls.length, "a listing parsed twice");
}

test("halooglasi: every parsed card is a usable listing", () => {
  const listings = parseFixture(halooglasi);
  assertUsableListings(
    listings,
    "www.halooglasi.com",
    /^\/nekretnine\/.+\/\d+$/,
  );

  for (const listing of listings) {
    assert.match(listing.datePosted ?? "", /^\d{4}-\d{2}-\d{2}$/);
    assert.match(listing.tier ?? "", /^(premium|top|standard)$/);
    assert.match(
      listing.imageUrl ?? "",
      /^https:\/\/img\.halooglasi\.com\/.+\.(jpe?g|png|webp)$/i,
    );
    // "m2 Kvadratura: 34" is rewritten the way a person reads it.
    assert.match(listing.features[0] ?? "", /^\d+(?:[.,]\d+)? m²$/);
  }
});

test("4zida: every parsed card is a usable listing", () => {
  const listings = parseFixture(fourZida);
  assertUsableListings(
    listings,
    "www.4zida.rs",
    /^\/(?:izdavanje|prodaja)-stanova\/.+\/[a-f0-9]{24}$/,
  );

  for (const listing of listings) {
    assert.match(listing.datePosted ?? "", /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(listing.tier, null);
    // Only JSON-LD names the image, so this also proves both readings were merged.
    assert.match(
      listing.imageUrl ?? "",
      /^https:\/\/resizer2\.4zida\.rs\/.+\.webp$/,
    );
  }
});

const card4zida = (href: string, name: string) =>
  `<div test-data="ad-search-card"><a href="${href}"></a>` +
  `<p class="truncate font-medium leading-tight">${name}</p></div>`;

test("4zida: drops a card linking off the domain instead of rewriting it onto one", () => {
  const real =
    "https://www.4zida.rs/izdavanje-stanova/beograd/aaaaaaaaaaaaaaaaaaaaaaaa";

  const listings = parsePage(fourZida, {
    url: SEARCH["4zida"],
    body:
      card4zida(
        "https://sponsor.example.com/izdavanje-stanova/beograd/bbbbbbbbbbbbbbbbbbbbbbbb",
        "Ad",
      ) + card4zida(real, "A real listing"),
  });

  assert.deepEqual(
    listings.map((listing) => listing.url),
    [real],
  );
});

test("4zida: merges a listing's JSON-LD with its card", () => {
  const path = "/izdavanje-stanova/beograd/aaaaaaaaaaaaaaaaaaaaaaaa";
  const node = {
    "@type": "RealEstateListing",
    url: path,
    name: "Stan",
    image: ["https://cdn.example/a.jpg", "https://cdn.example/b.jpg"],
    offers: { price: 350, priceCurrency: "EUR" },
    itemOffered: { floorSize: { value: 38, unitCode: "MTK" } },
  };

  const [listing, ...rest] = parsePage(fourZida, {
    url: SEARCH["4zida"],
    body:
      `<script type="application/ld+json">${JSON.stringify(node)}</script>` +
      card4zida(path, "Stan iz kartice"),
  });

  assert.deepEqual(rest, []);
  assert.deepEqual(listing, {
    url: `https://www.4zida.rs${path}`,
    name: "Stan",
    location: null,
    features: ["38 m²"],
    tier: null,
    price: { value: 350, currency: "EUR", raw: "350" },
    datePosted: null,
    imageUrl: "https://cdn.example/a.jpg",
  });
});

test("halooglasi: canonicalizes a relative link, and skips the stock no-image thumbnail", () => {
  const body =
    '<div id="ad-list-2"><div class="product-item product-list-item Top" data-id="1">' +
    '<a class="a-images" href="oglas/1234567890123"><img src="/Content/img/no-image.jpg"></a>' +
    '<h3 class="product-title"><a href="oglas/1234567890123">A real listing</a></h3>' +
    "</div></div>";

  const [listing] = parsePage(halooglasi, {
    url: "https://halooglasi.com/nekretnine/izdavanje-stanova/",
    body,
  });

  assert.equal(
    listing?.url,
    "https://www.halooglasi.com/nekretnine/izdavanje-stanova/oglas/1234567890123",
  );
  assert.equal(listing?.tier, "top");
  assert.equal(listing?.imageUrl, null);
});

test("nekretnine: every search result is a usable listing", () => {
  const listings = parseFixture(nekretnine);
  assertUsableListings(listings, "www.nekretnine.rs", /^\/oglasi\/\d+\/$/);

  for (const listing of listings) {
    assert.match(listing.tier ?? "", /^(premium|top|standard)$/);
    assert.ok(listing.price.value && listing.price.value <= 400);
    // The search API returns no date.
    assert.equal(listing.datePosted, null);
    if (listing.imageUrl !== null) {
      assert.match(
        listing.imageUrl,
        /^https:\/\/pic\.nekretnine\.rs\/image\/\d+\//,
      );
    }
  }
});

test("nekretnine: drops an off-domain advert and tolerates a body that is not JSON", () => {
  const body = JSON.stringify({
    results: [
      {
        realEstate: { title: "Elsewhere" },
        seo: { url: "https://evil.example/oglasi/1/" },
      },
      { realEstate: { title: "Ours" }, seo: { url: "/oglasi/2" } },
    ],
  });

  assert.deepEqual(
    parsePage(nekretnine, { url: SEARCH.nekretnine, body }).map(
      (listing) => listing.url,
    ),
    ["https://www.nekretnine.rs/oglasi/2/"],
  );
  assert.deepEqual(
    parsePage(nekretnine, {
      url: SEARCH.nekretnine,
      body: "<html>challenge</html>",
    }),
    [],
  );
});

const VOZDOVAC = {
  id: "20",
  type: 3,
  keyurl: "vozdovac",
  parents: [
    { id: "324", type: 2, keyurl: "beograd" },
    { id: "RS_3", type: 1, keyurl: "beograd-okrug" },
    { id: "RS_1", type: 0, keyurl: "grad-beograd" },
    { id: "RS", type: -1, keyurl: "srbija" },
  ],
};

/** The three endpoints nekretnine's fetch talks to, answering as the site does. Returns the URLs requested. */
function stubNekretnine(resolvedPath: string): URL[] {
  const requested: URL[] = [];

  mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    requested.push(url);

    if (url.pathname.endsWith("/geography/autocomplete/")) {
      return Response.json([VOZDOVAC]);
    }
    if (url.pathname.endsWith("/search-list/url-resolver/")) {
      return Response.json({ url: resolvedPath });
    }

    const response = new Response(readFixture(nekretnine));
    Object.defineProperty(response, "url", { value: url.toString() });
    return response;
  });

  return requested;
}

afterEach(() => mock.restoreAll());

test("nekretnine: asks the search API for the ids the pasted path resolves to", async () => {
  const requested = stubNekretnine(
    "/izdavanje-stambenih-nekretnina/beograd/vozdovac/",
  );

  const page = await nekretnine.fetchPage(SEARCH.nekretnine);

  const search = requested.find((url) =>
    url.pathname.endsWith("/search-list/listings/"),
  );
  assert.deepEqual(Object.fromEntries(search?.searchParams ?? []), {
    idContratto: "2",
    idCategoria: "1",
    idNazione: "RS",
    fkRegione: "RS_1",
    idProvincia: "RS_3",
    idComune: "324",
    "idMZona[]": "20",
    prezzoMassimo: "400",
    pag: "1",
    path: "/izdavanje-stambenih-nekretnina/beograd/vozdovac/",
    __lang: "sr",
  });
  assert.equal(page.url, search?.toString());
  assert.ok(parsePage(nekretnine, page).length >= 5);
});

test("nekretnine: refuses a search whose ids resolve back to a different path", async () => {
  stubNekretnine("/izdavanje-stambenih-nekretnina/beograd/");

  await assert.rejects(
    nekretnine.fetchPage(
      "https://www.nekretnine.rs/izdavanje-stambenih-nekretnina/beograd/vozdovac/sa-liftom/",
    ),
    /cannot watch/,
  );
});

test("a page served from outside the provider is an error, not an empty search", () => {
  assert.throws(
    () =>
      parsePage(fourZida, {
        url: "https://interstitial.example.com/challenge",
        body: "<html></html>",
      }),
    /served from outside the provider/,
  );
});

test("resolves a provider from the search URL's host", () => {
  assert.equal(resolveProvider(SEARCH["4zida"]), fourZida);
  assert.equal(resolveProvider(SEARCH.halooglasi), halooglasi);
  assert.equal(resolveProvider(SEARCH.nekretnine), nekretnine);
  assert.equal(resolveProvider("https://4zida.rs/izdavanje-stanova"), fourZida);
  assert.equal(resolveProvider("https://www.4zida.rs.phishing.example/"), null);
  assert.equal(resolveProvider("not a url"), null);
});
