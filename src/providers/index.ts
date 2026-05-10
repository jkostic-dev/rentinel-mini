import type { Provider } from "../types.ts";
import { fourZida } from "./4zida.ts";
import { halooglasi } from "./halooglasi.ts";

export const providers: Provider[] = [fourZida, halooglasi];

export function resolveProvider(url: string): Provider | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  return providers.find((provider) => provider.matches(parsed)) ?? null;
}
