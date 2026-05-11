import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Listing, State, Target } from "./types.ts";

function emptyState(): State {
  return { seenUrls: [], seededTargets: [] };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/** A missing or unreadable file starts clean: every target re-seeds and sends nothing. */
export async function loadState(path: string): Promise<State> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return emptyState();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return emptyState();
  }

  if (!parsed || typeof parsed !== "object") {
    return emptyState();
  }

  const candidate = parsed as Partial<State>;
  return {
    seenUrls: stringArray(candidate.seenUrls),
    seededTargets: stringArray(candidate.seededTargets),
  };
}

export async function saveState(path: string, state: State): Promise<void> {
  await mkdir(dirname(path), { recursive: true });

  const sorted: State = {
    seenUrls: [...state.seenUrls].sort((left, right) =>
      left.localeCompare(right),
    ),
    seededTargets: [...state.seededTargets].sort((left, right) =>
      left.localeCompare(right),
    ),
  };

  await writeFile(path, `${JSON.stringify(sorted, null, 2)}\n`);
}

/**
 * Returns what to notify about and the state to persist.
 *
 * A target's first scrape is seeded.
 * Seen URLs are global, so a listing on two targets notifies once.
 */
export function selectNewListings(
  state: State,
  target: Target,
  listings: Listing[],
): { newListings: Listing[]; nextState: State } {
  const seenUrls = new Set(state.seenUrls);
  const isSeeded = state.seededTargets.includes(target.url);
  const newListings: Listing[] = [];

  for (const listing of listings) {
    if (isSeeded && !seenUrls.has(listing.url)) {
      newListings.push(listing);
    }
    seenUrls.add(listing.url);
  }

  return {
    newListings,
    nextState: {
      seenUrls: [...seenUrls],
      seededTargets: isSeeded
        ? state.seededTargets
        : [...state.seededTargets, target.url],
    },
  };
}
