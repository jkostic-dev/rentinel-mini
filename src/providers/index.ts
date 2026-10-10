import type { Listing, Provider, RawPage } from "../types.ts";
import { fourZida } from "./4zida.ts";
import { halooglasi } from "./halooglasi.ts";
import { nekretnine } from "./nekretnine.ts";

export const providers: Provider[] = [fourZida, halooglasi, nekretnine];

export function resolveProvider(url: string): Provider | null {
  const parsed = URL.parse(url);
  if (!parsed) return null;

  return providers.find((provider) => provider.matches(parsed)) ?? null;
}

/**
 * A page's listings. A page served from outside the provider (a captcha wall, an off-domain
 * redirect) throws, so it is never read as a search with no results.
 */
export function parsePage(provider: Provider, page: RawPage): Listing[] {
  const servedFrom = URL.parse(page.url);

  if (!servedFrom || !provider.matches(servedFrom)) {
    throw new Error(
      `page was served from outside the provider: ${servedFrom?.hostname ?? "an invalid URL"}`,
    );
  }

  return provider.parse(page.body, servedFrom);
}
