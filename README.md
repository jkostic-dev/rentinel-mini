# rentinel-mini

Telegram alerts for new Serbian rental listings, minutes after they post.

Listings move within the hour, so a daily digest is already too late. This
watches the search pages you already use and messages you when one of them
gets something new.

The single-user version of [Rentinel](https://github.com/jkostic-dev/rentinel):
one process, a JSON state file, and searches set in the environment. Rentinel
itself adds multiple users, a Telegram bot for managing searches, Postgres, and
an admin dashboard.

## What an alert looks like

One message per listing, sent as a photo when the listing has one:

```
350 € • Dvosoban stan

• Voždovac opština, Beograd
• 45 m²
• 2 sobe
• Namešteno

23.08.2026 • yesterday

https://www.4zida.rs/izdavanje-stanova/vozdovac-opstina-beograd/dvosoban-stan/0123456789abcdef01234567

Voždovac 4zida p1
```

Price and title come first, because that line is the phone notification. The
date is a Telegram time entity, so each reader sees it in their own locale.

## How it works

1. Resolve a provider from the URL's hostname: 4zida, halooglasi or nekretnine.
2. Fetch the page. 4zida over plain HTTP; halooglasi through stealth headless Chromium, which its bot challenge requires; nekretnine through the JSON search API its own pages call, since the HTML is behind a captcha.
3. Refuse a page served from another host, so a captcha wall is an error and not an empty search.
4. Parse the result cards with cheerio. 4zida also publishes JSON-LD, which is merged in for the exact price, floor area and image.
5. Normalize each listing URL: https, primary host, no query, no hash. That is the dedupe key.
6. Diff against every URL already seen, across all searches.
7. Send what is left to Telegram, recording each listing as seen once it is delivered.

The first run of a search URL seeds: it records what is there and sends nothing.
Adding a URL later is quiet for the same reason.

## Quick start

Needs Node 24 or newer. It runs TypeScript directly, with no build step.

```bash
npm ci
cp .env.example .env   # fill in your bot token and chat ID
npm run start:once     # one cycle, then exit
npm start              # run continuously
```

## Configuration

| Variable             | Required | Default                     | Notes                                                                                                             |
| -------------------- | -------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `SCRAPE_URLS`        | yes      | n/a                         | JSON of `"name": "url"` pairs. Unsupported hosts are skipped with a warning; no supported URL is a startup error. |
| `TELEGRAM_TOKEN`     | yes      | n/a                         | Bot token from [@BotFather](https://t.me/BotFather).                                                              |
| `TELEGRAM_CHAT_IDS`  | yes      | n/a                         | JSON array of chat IDs, e.g. `["1234567890"]`.                                                                    |
| `SCRAPE_INTERVAL_MS` | no       | `300000`                    | Time between cycles.                                                                                              |
| `STATE_FILE_PATH`    | no       | `./data/seen-listings.json` | Where seen URLs are persisted.                                                                                    |

## Writing search URLs

The app never rewrites your search URLs: no pagination logic, no injected sort
parameter, nothing stripped. Copy the URL out of the address bar and paste it in.

One entry per page you want watched. The key is what shows up in the Telegram
message, so keep the keys unique:

```json
{
  "Voždovac 4zida p1": "https://www.4zida.rs/izdavanje-stanova/vozdovac-opstina-beograd/do-400-evra?sortiranje=najnoviji",
  "Voždovac 4zida p2": "https://www.4zida.rs/izdavanje-stanova/vozdovac-opstina-beograd/do-400-evra?sortiranje=najnoviji&strana=2",
  "Voždovac halo p1": "https://www.halooglasi.com/nekretnine/izdavanje-stanova/beograd-vozdovac?cena_d_to=400&cena_d_unit=4",
  "Voždovac halo p2": "https://www.halooglasi.com/nekretnine/izdavanje-stanova/beograd-vozdovac?cena_d_to=400&cena_d_unit=4&page=2",
  "Voždovac nekretnine": "https://www.nekretnine.rs/izdavanje-stambenih-nekretnina/beograd/vozdovac/?criterio=data&ordine=desc&prezzoMassimo=400"
}
```

- **4zida** sorts with `?sortiranje=najnoviji` and pages with `&strana=2`.
- **halooglasi** pages with `?page=2` but has **no URL sort parameter**. Its sort dropdown is JavaScript-driven, and the server-rendered order ignores `sort`, `sortField` and `sortOrder`. Promoted ads lead the results, so watching three or four pages is worth it there.
- **nekretnine** sorts newest-first with `?criterio=data&ordine=desc` and pages with `&pag=2`. Residential searches only (apartments, houses, cottages, rooms); a path it cannot map to the search API fails that target with a "cannot watch" error instead of silently watching a broader search. Its API returns no posting date, so those alerts have none.

Dedupe is global, so a listing that drifts from page 1 to page 2 between cycles
is still sent once.

## Docker

```bash
docker compose up --build -d
```

The image uses the distro Chromium instead of Puppeteer's own download. Compose
passes `.env` through `env_file` and mounts `./data`, so state survives restarts.

## Tests and fixtures

```bash
npm test        # node --test, offline
npm run typecheck
npm run format:check
```

Tests parse committed fixtures captured from all three sites, so they run
offline. Each provider is held to invariants across every listing, which survive
a fixture refresh, and to hand-written cards for the edge cases.

Fixtures are real search pages run through two steps. `scripts/trimHtml.ts`
drops scripts, styles, page chrome and every attribute the parsers do not read.
`scripts/redactFixture.ts` then scrambles every word, link and id that could
point at a real listing; only prices, dates, sizes and the sites' own vocabulary
stay readable. No real listing is committed, and the markup keeps its shape.

Re-capture when a site's markup moves and the tests fail:

```bash
npm run fixtures
```

It fetches through the providers' own fetch path and refuses to write a fixture
that parses to zero listings. 4zida moved its cards out of `<main>` in August
2026 and the alerts went silent; see
`fix(4zida): re-anchor card selectors after markup change`.

## Scraping responsibly

Public listing pages only. No accounts, no logins, no paywalls. One cycle every
five minutes, ten seconds between requests.

## License

MIT. See [LICENSE](LICENSE).
