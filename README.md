# rentinel-mini

Telegram alerts for new Serbian rental listings, minutes after they post.

Listings move within the hour, so a daily digest is already too late. This
watches the search pages you already use and messages you when one of them
gets something new.

A minimal public cut of a larger Rentinel: multi-user, saved queries in a
database, bot and dashboard UI.

## What an alert looks like

```
Voždovac 4zida p1 • Dvosoban stan • 350 €

• Voždovac opština, Beograd
• 350 €
• 2 sobe  • Namešteno
• Etažno  • Useljivo
• Agencija

🗓️ 23.08.2026 • (yesterday)

https://www.4zida.rs/izdavanje-stanova/vozdovac-opstina-beograd/dvosoban-stan/0123456789abcdef01234567
```

## How it works

1. Resolve a provider from the URL's hostname: 4zida or halooglasi.
2. Fetch the page. 4zida over plain HTTP; halooglasi through stealth headless Chromium, which its bot challenge requires.
3. Parse the result cards with cheerio.
4. Normalize each listing URL: absolute, no query, no hash. That is the dedupe key.
5. Diff against every URL already seen, across all searches.
6. Send what is left to Telegram, then persist the state.

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
  "Voždovac halo p2": "https://www.halooglasi.com/nekretnine/izdavanje-stanova/beograd-vozdovac?cena_d_to=400&cena_d_unit=4&page=2"
}
```

- **4zida** sorts with `?sortiranje=najnoviji` and pages with `&strana=2`.
- **halooglasi** pages with `?page=2` but has **no URL sort parameter**. Its sort dropdown is JavaScript-driven, and the server-rendered order ignores `sort`, `sortField` and `sortOrder`. Promoted ads lead the results, so watching three or four pages is worth it there.

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

Tests parse committed HTML fixtures captured from both sites, so they run
offline. Each provider is checked two ways: invariants across every card, which
survive a fixture refresh, and exact values on the first card, which catch
field-mapping bugs.

Fixtures are five cards plus the ancestors that give them structural context.
Page chrome is stripped, and every word, link and id that could point at a real
listing is scrambled; only prices, dates, sizes and the sites' own vocabulary
stay readable. None of the rest is parsed, and it is not mine to republish.

Re-capture when a site's markup moves and the tests fail:

```bash
npm run fixtures
```

It fetches through the providers' own fetch path and refuses to write a fixture
that parses to zero listings. Update the first-card assertions afterwards. 4zida
moved its cards out of `<main>` in August 2026 and the alerts went silent; see
`fix(4zida): re-anchor card selectors after markup change`.

## Scraping responsibly

Public listing pages only. No accounts, no logins, no paywalls. One cycle every
five minutes, ten seconds between requests.

## License

MIT. See [LICENSE](LICENSE).
