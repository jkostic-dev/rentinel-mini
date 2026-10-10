import { parsePage, resolveProvider } from "./providers/index.ts";
import { loadState, saveState, selectNewListings } from "./state.ts";
import { sendListing } from "./telegram.ts";
import type { Config, State, Target } from "./types.ts";

export const TARGET_DELAY_MS = 10_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createRunner(config: Config): {
  runOnce: () => Promise<void>;
  start: () => Promise<void>;
} {
  let state: State | null = null;
  let cycleInProgress = false;

  const scrapeTarget = async (target: Target): Promise<void> => {
    const provider = resolveProvider(target.url);
    if (!provider) {
      console.warn(`[scraper] No provider for ${target.url}`);
      return;
    }

    const listings = parsePage(provider, await provider.fetchPage(target.url));

    if (listings.length === 0) {
      // The only signal that a site changed its markup or served a challenge.
      console.warn(
        `[scraper] "${target.queryName}" returned no listings; check the URL or the parser.`,
      );
      return;
    }

    const current = state ?? (await loadState(config.stateFilePath));
    const { newListings, nextState } = selectNewListings(
      current,
      target,
      listings,
    );

    if (newListings.length === 0) {
      state = nextState;
      await saveState(config.stateFilePath, nextState);
      console.log(
        `[scraper] "${target.queryName}": ${listings.length} listings, none new.`,
      );
      return;
    }

    // Recorded as seen only once Telegram has them, so a failed send retries next cycle.
    const unsent = new Set(newListings.map((listing) => listing.url));
    try {
      for (const listing of newListings) {
        await sendListing({
          telegramToken: config.telegramToken,
          telegramChatIds: config.telegramChatIds,
          queryName: target.queryName,
          listing,
        });
        unsent.delete(listing.url);
      }
    } finally {
      state = {
        ...nextState,
        seenUrls: nextState.seenUrls.filter((url) => !unsent.has(url)),
      };
      await saveState(config.stateFilePath, state);
    }

    console.log(
      `[scraper] "${target.queryName}": sent ${newListings.length} new listing(s).`,
    );
  };

  const runCycle = async (): Promise<void> => {
    if (cycleInProgress) {
      console.warn("[scraper] Previous cycle still running, skipping tick.");
      return;
    }

    cycleInProgress = true;
    try {
      state = await loadState(config.stateFilePath);

      for (const [index, target] of config.targets.entries()) {
        console.log(`[scraper] Scraping "${target.queryName}": ${target.url}`);
        try {
          await scrapeTarget(target);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          console.error(`[scraper] "${target.queryName}" failed: ${message}`);
        }

        if (index < config.targets.length - 1) {
          await sleep(TARGET_DELAY_MS);
        }
      }
    } finally {
      cycleInProgress = false;
    }
  };

  return {
    runOnce: runCycle,
    start: async () => {
      await runCycle();
      setInterval(() => {
        void runCycle();
      }, config.scrapeIntervalMs);
    },
  };
}
