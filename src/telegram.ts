import type { Listing } from "./types.ts";

const MAX_MESSAGE_LENGTH = 4096;
const LISTING_SEPARATOR = "────────────";

function escapeHtml(raw: string): string {
  return raw
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function priceText(listing: Listing): string {
  const { raw, value, currency } = listing.price;

  if (raw) {
    const hasCurrencyToken = /\b(?:EUR|RSD|USD|CHF|GBP)\b|[€$£]|дин/iu.test(
      raw,
    );
    return !hasCurrencyToken && currency ? `${raw} ${currency}` : raw;
  }
  if (value !== null && currency) {
    return `${value} ${currency}`;
  }
  if (value !== null) {
    return String(value);
  }

  return "N/A";
}

/** Two features per line, so a card stays scannable on a phone. */
function featuresText(listing: Listing): string {
  if (listing.features.length === 0) {
    return "N/A";
  }

  const lines: string[] = [];
  for (let index = 0; index < listing.features.length; index += 2) {
    const pair = listing.features.slice(index, index + 2);
    lines.push(pair.map((feature) => `• ${escapeHtml(feature)}`).join("  "));
  }

  return lines.join("\n");
}

/** "23.08.2026 • (yesterday)". Calendar-day math avoids a timezone shift. */
function postedDateText(datePosted: string | null): string {
  const match = datePosted?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return "N/A";
  }

  const [, year = "", month = "", day = ""] = match;
  const now = new Date();
  const diffDays = Math.round(
    (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) -
      Date.UTC(Number(year), Number(month) - 1, Number(day))) /
      86_400_000,
  );

  let relative = `${diffDays} days ago`;
  if (diffDays === 0) {
    relative = "today";
  } else if (diffDays === 1) {
    relative = "yesterday";
  } else if (diffDays < 0) {
    relative = `in ${Math.abs(diffDays)} days`;
  }

  return `${day}.${month}.${year} • (${relative})`;
}

function listingBlock(listing: Listing): string {
  const query = listing.queryName ?? listing.name;
  const location = listing.location ?? "N/A";
  const price = priceText(listing);

  return [
    `${escapeHtml(query)} • <b>${escapeHtml(listing.name)}</b> • ${escapeHtml(
      price,
    )}`,
    "",
    `• ${escapeHtml(location)}`,
    `• ${escapeHtml(price)}`,
    featuresText(listing),
    "",
    `🗓️ ${escapeHtml(postedDateText(listing.datePosted))}`,
    "",
    escapeHtml(listing.url),
  ].join("\n");
}

/** Packs blocks into as few messages as Telegram's 4096-char limit allows. */
export function buildMessages(
  listings: Listing[],
  maxLength: number = MAX_MESSAGE_LENGTH,
): string[] {
  const messages: string[] = [];
  let current = "";

  for (const listing of listings) {
    const block = listingBlock(listing);
    if (block.length > maxLength) {
      throw new Error(
        `Single listing payload exceeds Telegram message limit (${maxLength} characters).`,
      );
    }

    const separator =
      current.length === 0 ? "" : `\n\n${LISTING_SEPARATOR}\n\n`;
    const candidate = `${current}${separator}${block}`;
    if (candidate.length <= maxLength) {
      current = candidate;
      continue;
    }

    messages.push(current);
    current = block;
  }

  if (current.length > 0) {
    messages.push(current);
  }

  return messages;
}

export async function sendListings(options: {
  telegramToken: string;
  telegramChatIds: string[];
  listings: Listing[];
}): Promise<number> {
  const messages = buildMessages(options.listings);
  let sentCount = 0;

  for (const chatId of options.telegramChatIds) {
    for (const text of messages) {
      const response = await fetch(
        `https://api.telegram.org/bot${options.telegramToken}/sendMessage`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: "HTML",
            disable_web_page_preview: true,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(
          `Telegram request failed (${response.status}): ${await response.text()}`,
        );
      }

      sentCount += 1;
    }
  }

  return sentCount;
}
