import type { Listing } from "./types.ts";

// Telegram counts these after entity parsing. We measure the HTML source, which is never shorter.
export const MAX_MESSAGE_LENGTH = 4096;
export const MAX_CAPTION_LENGTH = 1024;

// Caps on provider text, so an ordinary listing always fits.
const LIMITS = {
  label: 120,
  name: 300,
  location: 200,
  price: 80,
  feature: 120,
  features: 12,
};

/** For a 429 without `retry_after`. */
const DEFAULT_RETRY_AFTER_SECONDS = 30;

/**
 * One listing as one message. Price and title come first, since that line is the phone
 * notification; the query name is last. To fit `maxLength`, features are dropped from the end,
 * then the URL. Null when even that does not fit, which the caps above should prevent.
 */
export function renderListing(
  listing: Listing,
  queryName: string,
  options: { maxLength?: number; now?: Date } = {},
): string | null {
  const maxLength = options.maxLength ?? MAX_MESSAGE_LENGTH;
  const now = options.now ?? new Date();
  const footer = `\n\n<i>${escapeHtml(truncate(queryName, LIMITS.label))}</i>`;
  const most = Math.min(listing.features.length, LIMITS.features);

  for (let features = most; features >= 0; features--) {
    const text = listingBlock(listing, now, features, true) + footer;
    if (text.length <= maxLength) return text;
  }

  const text = listingBlock(listing, now, 0, false) + footer;
  return text.length <= maxLength ? text : null;
}

/** The three characters Telegram's HTML mode needs escaped. */
function escapeHtml(raw: string): string {
  return raw
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** By code point, so an emoji is never split. */
function truncate(raw: string, max: number): string {
  const chars = [...raw];
  return chars.length <= max ? raw : `${chars.slice(0, max - 1).join("")}…`;
}

const NO_LINK = "🔗 link too long for Telegram — find it on the search page";

function listingBlock(
  listing: Listing,
  now: Date,
  featureCount: number,
  withUrl: boolean,
): string {
  const text = (raw: string, max: number) => escapeHtml(truncate(raw, max));
  const features = listing.features.slice(0, featureCount);

  const lines = [
    `<b>${text(priceText(listing), LIMITS.price)}</b> • <b>${text(listing.name, LIMITS.name)}</b>`,
    "",
    `• ${text(listing.location ?? "N/A", LIMITS.location)}`,
  ];

  if (listing.tier) {
    lines.push(`• ${text(listing.tier.toUpperCase(), LIMITS.feature)}`);
  }
  for (const feature of features) {
    lines.push(`• ${text(feature, LIMITS.feature)}`);
  }
  if (listing.features.length > features.length) lines.push("• …");

  const posted = postedText(listing.datePosted, now);
  if (posted) lines.push("", posted);
  lines.push("", withUrl ? escapeHtml(listing.url) : NO_LINK);
  return lines.join("\n");
}

const CURRENCY_TOKEN = /\b(?:EUR|RSD|USD|CHF|GBP)\b|[€$£]|дин/iu;

function priceText(listing: Listing): string {
  const { raw, value, currency } = listing.price;
  if (raw) {
    return !CURRENCY_TOKEN.test(raw) && currency ? `${raw} ${currency}` : raw;
  }
  if (value !== null) return currency ? `${value} ${currency}` : String(value);
  return "N/A";
}

/** Formats a date as `YYYY-MM-DD` in Belgrade. */
const belgradeDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Belgrade",
});

/**
 * Two `<tg-time>` entities, which the reader's client renders in its own locale: the date, then
 * how long ago. Older clients show the fallback text, `21.08.2026 • yesterday`.
 */
function postedText(datePosted: string | null, now: Date): string | null {
  const match = datePosted?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match;

  const [todayYear, todayMonth, todayDay] = belgradeDay
    .format(now)
    .split("-")
    .map(Number);

  const days = Math.round(
    (Date.UTC(Number(todayYear), Number(todayMonth) - 1, Number(todayDay)) -
      Date.UTC(Number(year), Number(month) - 1, Number(day))) /
      86_400_000,
  );

  const relative =
    days === 0
      ? "today"
      : days === 1
        ? "yesterday"
        : days < 0
          ? `in ${-days} days`
          : `${days} days ago`;

  // Providers give a day, not a time. 11:00 UTC is about midday in Belgrade, so the day survives
  // most timezones. Clamped to now, or a listing dated today would read "in 2 hours".
  const midday = Date.UTC(Number(year), Number(month) - 1, Number(day), 11);
  const unix = Math.floor(
    (days === 0 ? Math.min(midday, now.getTime()) : midday) / 1000,
  );

  const time = (format: string, fallback: string) =>
    `<tg-time unix="${unix}" format="${format}">${fallback}</tg-time>`;

  return `${time("D", `${day}.${month}.${year}`)} • ${time("r", relative)}`;
}

type TelegramReply = {
  description?: string;
  parameters?: { retry_after?: unknown };
};

/**
 * Sends one listing to every chat. A listing with an image is a `sendPhoto` with the text as its
 * caption; one without, or whose image Telegram refuses, is a `sendMessage`. Throws when a chat
 * could not be reached, so the caller leaves the listing unseen and retries next cycle.
 */
export async function sendListing(options: {
  telegramToken: string;
  telegramChatIds: string[];
  queryName: string;
  listing: Listing;
}): Promise<void> {
  const { telegramToken, telegramChatIds, queryName, listing } = options;

  /** The HTTP status, once the request is through any rate limit. */
  async function call(method: string, payload: object): Promise<number> {
    for (let attempt = 1; ; attempt++) {
      const response = await fetch(
        `https://api.telegram.org/bot${telegramToken}/${method}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      // A 400 is the caller's to handle: for a photo, it has a fallback.
      if (response.ok || response.status === 400) return response.status;

      const reply = (await response
        .json()
        .catch(() => null)) as TelegramReply | null;

      if (response.status === 429 && attempt === 1) {
        const retryAfter = Number(reply?.parameters?.retry_after);
        const seconds =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter
            : DEFAULT_RETRY_AFTER_SECONDS;
        await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
        continue;
      }

      throw new Error(
        `Telegram ${method} failed (${response.status}): ${reply?.description ?? response.statusText}`,
      );
    }
  }

  const caption = listing.imageUrl
    ? renderListing(listing, queryName, { maxLength: MAX_CAPTION_LENGTH })
    : null;
  const text = renderListing(listing, queryName);
  if (!text) {
    throw new Error(`Listing does not fit one message: ${listing.url}`);
  }

  for (const chatId of telegramChatIds) {
    if (caption) {
      const status = await call("sendPhoto", {
        chat_id: chatId,
        photo: listing.imageUrl,
        caption,
        parse_mode: "HTML",
      });
      // A 400 here is in practice an image Telegram could not fetch. Nothing was delivered,
      // so fall through and send text.
      if (status !== 400) continue;
    }

    const status = await call("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
    if (status === 400) {
      throw new Error(`Telegram rejected the message for ${listing.url}`);
    }
  }
}
