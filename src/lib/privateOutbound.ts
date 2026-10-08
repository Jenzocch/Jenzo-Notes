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

/** Inspect our retained structured provenance, not note text. Absence on legacy
 * records is compatible; a declared source list must be valid and nonempty.
 * Legacy `properties` is user data, not a provenance namespace. New retained
 * metadata belongs in `secretaryProvenance: { version: 1, sources: [...] }`.
 * This cannot identify unmarked text manually copied into a legacy public record.
 */
export function requirePublicRecord(destination: OutboundDestination, value: unknown) {
  let remaining = 100000;
  const visit = (item: unknown, depth: number, provenance = false) => {
    if (!item || typeof item !== "object") return;
    if (depth > 32 || --remaining < 0) throw new Error(`outbound-provenance-invalid:${destination}`);
    if (Array.isArray(item)) { item.forEach(child => visit(child, depth + 1, provenance)); return; }
    const record = item as Record<string, unknown>;
    requirePublicSources(destination, [{ private: record.private === true, type: typeof record.type === "string" ? record.type : undefined, key: typeof record.key === "string" ? record.key : undefined }]);
    if (Object.hasOwn(record, "sources")) {
      if (!Array.isArray(record.sources) || !record.sources.length) throw new Error(`outbound-provenance-invalid:${destination}`);
      for (const source of record.sources) {
        if (!source || typeof source !== "object" || typeof source.key !== "string" || !/^(card|board|task|fragment|private):.+$/.test(source.key)) throw new Error(`outbound-provenance-invalid:${destination}`);
      }
    }
    for (const [name, child] of Object.entries(record)) {
      if (name === "properties" && !provenance) continue;
      if (name === "secretaryProvenance") {
        if (!child || typeof child !== "object" || Array.isArray(child) || (child as Record<string, unknown>).version !== 1 || !Object.hasOwn(child, "sources")) throw new Error(`outbound-provenance-invalid:${destination}`);
        visit(child, depth + 1, true);
      } else visit(child, depth + 1, provenance);
    }
  };
  visit(value, 0);
}

/** sourceContext's JSON wire format retains its own keys even when a caller
 * omits options.sources. Ordinary legacy prose is not a source-derived payload.
 */
export function requireAIContext(engine: string, context?: string) {
  if (engine === "local-gemma" || !context?.trimStart().startsWith("[")) return;
  let parsed: unknown;
  try { parsed = JSON.parse(context); } catch { throw new Error("outbound-provenance-invalid:remote-ai"); }
  requirePublicRecord("remote-ai", { sources: parsed });
  return parsed;
}
