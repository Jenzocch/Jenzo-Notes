/** Provenance policy is independent of providers, budget and connector enablement.
 * Only the packaged in-browser model is a verified local AI destination.
 * No persistent disclosure override is supported.
 */
export interface SourcePrivacy { key?: string; type?: string; private?: boolean }
export type OutboundDestination = "remote-ai" | "mcp" | "sync" | "share";
export function isPrivateSource(source: SourcePrivacy) {
  return source.private === true || source.type === "private" || source.key?.startsWith("private:") === true;
}
export function requirePublicSources(destination: OutboundDestination, sources: readonly SourcePrivacy[]) {
  if (sources.some(isPrivateSource)) throw new Error(`private-outbound-denied:${destination}`);
}
export function requireAISources(engine: string, sources: readonly SourcePrivacy[]) {
  if (engine !== "local-gemma") requirePublicSources("remote-ai", sources);
}
