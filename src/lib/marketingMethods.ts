import catalogJson from "../assets/thinkwithblack/catalog.json";
import provenanceJson from "../assets/thinkwithblack/provenance.json";
import { db } from "../db";
import { renderSafeMarkdown } from "./safeMarkdown";
import type { CardRecord } from "../types";

export interface MarketingMethodEntry {
  id: string;
  name: string;
  description: string;
  pack: string;
  packSha256: string;
}

interface MarketingCatalog {
  schemaVersion: string;
  edition: string;
  version: string;
  entryCount: number;
  entries: MarketingMethodEntry[];
}

export interface LoadedMarketingMethod {
  entry: MarketingMethodEntry;
  content: string;
  sourceUrl: string;
}

type RawLoader = () => Promise<string>;

const rawLoaders = import.meta.glob<string>("../assets/thinkwithblack/packs/*.md", {
  query: "?raw",
  import: "default",
});
const catalog = catalogJson as MarketingCatalog;
const entriesById = new Map(catalog.entries.map((entry) => [entry.id, entry]));
const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase("zh-TW").trim();

export const marketingMethodCatalog = catalog;
export const marketingMethodProvenance = provenanceJson;

export function validateMarketingMethodCatalog() {
  const errors: string[] = [];
  const ids = new Set<string>();
  const packs = new Set<string>();
  if (catalog.entryCount !== catalog.entries.length) errors.push("entry-count-mismatch");
  for (const entry of catalog.entries) {
    if (!entry.id || ids.has(entry.id)) errors.push(`duplicate-or-empty-id:${entry.id}`);
    if (!entry.pack.startsWith("packs/") || entry.pack.includes("..") || packs.has(entry.pack)) errors.push(`invalid-or-duplicate-pack:${entry.pack}`);
    if (!/^[a-f0-9]{64}$/.test(entry.packSha256)) errors.push(`invalid-pack-hash:${entry.id}`);
    const loaderKey = `../assets/thinkwithblack/${entry.pack}`;
    if (!rawLoaders[loaderKey]) errors.push(`missing-pack:${entry.pack}`);
    ids.add(entry.id); packs.add(entry.pack);
  }
  if (Object.keys(rawLoaders).length !== packs.size) errors.push("unlisted-pack");
  return errors;
}

function scoreEntry(entry: MarketingMethodEntry, query: string, terms: string[]) {
  const id = normalize(entry.id); const name = normalize(entry.name); const description = normalize(entry.description);
  if (id === query || name === query) return 1000;
  let score = 0;
  if (id.includes(query)) score += 300;
  if (name.includes(query)) score += 240;
  if (description.includes(query)) score += 120;
  for (const term of terms) {
    if (id.includes(term)) score += 30;
    if (name.includes(term)) score += 20;
    if (description.includes(term)) score += 8;
  }
  return terms.every((term) => id.includes(term) || name.includes(term) || description.includes(term)) ? score : 0;
}

export function searchMarketingMethods(value: string, limit = 80) {
  const query = normalize(value);
  if (!query) return catalog.entries.slice(0, limit);
  const terms = query.split(/\s+/).filter(Boolean);
  return catalog.entries
    .map((entry) => ({ entry, score: scoreEntry(entry, query, terms) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.entry.id.localeCompare(right.entry.id))
    .slice(0, limit)
    .map((item) => item.entry);
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function normalizeMarketingMethodSource(value: string) {
  return value.replace(/\r\n/g, "\n");
}

export async function loadMarketingMethod(id: string): Promise<LoadedMarketingMethod> {
  const entry = entriesById.get(id);
  if (!entry) throw new Error("marketing-method-not-found");
  const loader = rawLoaders[`../assets/thinkwithblack/${entry.pack}`] as RawLoader | undefined;
  if (!loader) throw new Error("marketing-method-content-missing");
  const content = normalizeMarketingMethodSource(await loader());
  if (await sha256(content) !== entry.packSha256) throw new Error("marketing-method-integrity-failed");
  return {
    entry,
    content,
    sourceUrl: `${provenanceJson.repository}/blob/${provenanceJson.commit}/${entry.pack}`,
  };
}

export function marketingMethodCardId(entry: MarketingMethodEntry) {
  return `thinkwithblack:${catalog.version}:${entry.id}`;
}

export async function saveMarketingMethodCard(method: LoadedMarketingMethod): Promise<{ card: CardRecord; created: boolean }> {
  const id = marketingMethodCardId(method.entry);
  const existing = await db.cards.get(id);
  if (existing) return { card: existing, created: false };
  const now = Date.now();
  const card: CardRecord = {
    id,
    title: `${method.entry.id}｜${method.entry.name}`,
    contentHtml: renderSafeMarkdown(method.content),
    plainText: method.content,
    kind: "note",
    state: "active",
    createdAt: now,
    updatedAt: now,
    tagIds: [],
    favorite: false,
    color: "slate",
    sourceUrl: method.sourceUrl,
    attachmentIds: [],
    properties: {
      sourceKind: "thinkwithblack-marketing-method",
      sourceId: method.entry.id,
      sourceVersion: catalog.version,
      sourceCommit: provenanceJson.commit,
      sourcePack: method.entry.pack,
      sourceLicense: provenanceJson.license,
    },
  };
  try {
    await db.cards.add(card);
    return { card, created: true };
  } catch (error) {
    const raced = await db.cards.get(id);
    if (raced) return { card: raced, created: false };
    throw error;
  }
}
