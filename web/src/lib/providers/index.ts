import { vercel } from "../vercel.ts";
import { plausible } from "./plausible.ts";
import { umami } from "./umami.ts";
import { cloudflare } from "./cloudflare.ts";
import { ga4 } from "./ga4.ts";
import { github } from "./github.ts";
import { ProviderError, type Provider } from "./types.ts";

export const PROVIDERS: Record<string, Provider<any>> = { vercel, plausible, umami, cloudflare, ga4, github }; // eslint-disable-line @typescript-eslint/no-explicit-any

export function provider(kind: string): Provider<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const p = PROVIDERS[kind];
  if (!p) throw new ProviderError(400, `Unknown source type "${kind}".`);
  return p;
}
