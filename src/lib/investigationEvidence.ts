import { db } from "../db";
import type { AppLanguage } from "../types";
import { isMaterializedCard } from "./journalVisibility";
import { requirePublicRecord } from "./privateOutbound";
import { listPrivateItems, secureVaultEpoch, secureVaultStatus } from "./secureSecretary";
import { matchingExcerpt, queryTerms, searchNoteSources } from "./sourceWorkbench";

export type EvidencePrivacy = "public" | "private";
export interface SourceStamp {
  key: string; scope: string; title: string; updatedAt: number; fingerprint: string; privacy: EvidencePrivacy;
}
export interface EvidenceRef extends SourceStamp { start: number; end: number; quote: string }
export interface EvidenceSource { key: string; scope: string; title: string; text: string; updatedAt: number; privacy: EvidencePrivacy }
export type EvidenceState = "valid" | "changed" | "missing" | "locked" | "invalid";
export interface EvidenceRepository {
  readonly scope: string;
  resolve(key: string): Promise<EvidenceSource | null>;
  search(query: string, language: AppLanguage): Promise<string[]>;
}
export async function evidenceFingerprint(source: EvidenceSource) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([source.key, source.scope, source.title, source.text, source.updatedAt, source.privacy])));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}
export async function stampSource(source: EvidenceSource): Promise<SourceStamp> {
  return { key: source.key, scope: source.scope, title: source.title, updatedAt: source.updatedAt, fingerprint: await evidenceFingerprint(source), privacy: source.privacy };
}
export async function referenceQuote(source: EvidenceSource, quote: string): Promise<EvidenceRef> {
  if (typeof quote !== "string" || quote.trim().length < 8 || quote.length > 1600) throw new Error("evidence-quote-invalid");
  const start = source.text.indexOf(quote);
  if (start < 0) throw new Error("evidence-quote-not-original");
  return { ...await stampSource(source), start, end: start + quote.length, quote };
}
export async function checkEvidence(ref: SourceStamp | EvidenceRef, repository: EvidenceRepository): Promise<EvidenceState> {
  if (!ref || typeof ref.key !== "string" || !Number.isSafeInteger(ref.updatedAt) || ref.scope !== repository.scope || typeof ref.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(ref.fingerprint)) return "invalid";
  let source: EvidenceSource | null;
  try { source = await repository.resolve(ref.key); } catch (error) { return String(error).includes("locked") ? "locked" : "invalid"; }
  if (!source) return "missing";
  if (source.privacy !== ref.privacy || source.scope !== ref.scope) return "invalid";
  if (source.updatedAt !== ref.updatedAt || await evidenceFingerprint(source) !== ref.fingerprint) return "changed";
  if ("quote" in ref && (typeof ref.quote !== "string" || !Number.isSafeInteger(ref.start) || !Number.isSafeInteger(ref.end) || ref.start < 0 || ref.end <= ref.start || ref.quote.length < 8 || ref.quote.length > 1600 || source.text.slice(ref.start, ref.end) !== ref.quote)) return "invalid";
  return "valid";
}

function recordPrivacy(record: unknown): EvidencePrivacy {
  try { requirePublicRecord("share", record); return "public"; }
  catch (error) { if (String(error).includes("private-outbound-denied")) return "private"; throw error; }
}
export const localEvidenceRepository: EvidenceRepository = {
  scope: "local",
  async resolve(key) {
    if (typeof key !== "string") throw new Error("evidence-key-invalid");
    const match = /^(card|fragment|private):(.+)$/.exec(key);
    if (!match) throw new Error("evidence-key-invalid");
    const epoch = secureVaultEpoch();
    if (match[1] === "private") {
      if ((await secureVaultStatus()).state !== "unlocked") throw new Error("evidence-source-locked");
      const item = (await listPrivateItems()).find(item => item.id === match[2]);
      if (epoch !== secureVaultEpoch()) throw new Error("evidence-source-locked");
      return item ? { key, scope: "local", title: item.title, text: item.plainText, updatedAt: item.updatedAt, privacy: "private" } : null;
    }
    const record = match[1] === "card" ? await db.cards.get(match[2]) : await db.fragments.get(match[2]);
    if (!record || ("state" in record && (record.state === "trash" || !isMaterializedCard(record)))) return null;
    const privacy = recordPrivacy(record);
    if (privacy === "private" && (await secureVaultStatus()).state !== "unlocked") throw new Error("evidence-source-locked");
    if (privacy === "private" && epoch !== secureVaultEpoch()) throw new Error("evidence-source-locked");
    return { key, scope: "local", title: "title" in record ? record.title : record.text.split("\n")[0].slice(0, 80), text: "plainText" in record ? record.plainText : record.text, updatedAt: record.updatedAt, privacy };
  },
  async search(query, language) { return (await searchNoteSources(query, language)).map(source => source.key); },
};

export function investigationIdentifiers(text: string) {
  return [...new Set((text.toUpperCase().match(/\b[A-Z][A-Z0-9]{0,15}[-_]\d{1,12}\b|\bM\d{1,6}\b|\bSOP\s*V\d{1,4}\b/g) || []).map(value => value.replace(/\s+/g, " ")))];
}
export interface InvestigationHit { source: EvidenceSource; evidence: EvidenceRef; reason: string }
export async function retrieveInvestigation(repository: EvidenceRepository, question: string, language: AppLanguage): Promise<InvestigationHit[]> {
  if (!question.trim() || question.length > 2000) throw new Error("investigation-question-required");
  const roots = investigationIdentifiers(question);
  const collected = new Map<string, EvidenceSource>();
  const read = async (query: string, anchors: string[]) => {
    for (const key of await repository.search(query, language)) {
      let source: EvidenceSource | null;
      try { source = await repository.resolve(key); } catch { continue; }
      if (!source) continue;
      const identifiers = investigationIdentifiers(source.title + "\n" + source.text);
      if (anchors.length && !anchors.some(anchor => identifiers.includes(anchor))) continue;
      collected.set(key, source);
    }
  };
  await read(question, roots);
  const expanded = [...new Set([...roots, ...[...collected.values()].flatMap(source => investigationIdentifiers(source.text))])].slice(0, 8);
  if (expanded.length) await read(expanded.join(" "), expanded); // At most two retrieval rounds.
  const hits: InvestigationHit[] = [];
  for (const source of [...collected.values()].slice(0, 12)) {
    const shared = investigationIdentifiers(source.text).filter(id => expanded.includes(id));
    const excerpt = matchingExcerpt(source.text, queryTerms((shared.length ? shared : [question]).join(" ")));
    if (excerpt.trim().length < 8) continue;
    hits.push({ source, evidence: await referenceQuote(source, excerpt), reason: shared.length ? `Shared identifier: ${shared.join(" / ")}` : `Keyword match: ${queryTerms(question).join(" / ")}` });
  }
  return hits;
}

/** Explicitly isolated synthetic authority: never inserts cards, vault entries,
 * sync operations or public graph edges. Closing the instance discards its data.
 */
export class FG17EvidenceRepository implements EvidenceRepository {
  readonly scope = "sandbox-fg17";
  readonly records = new Map<string, EvidenceSource>();
  readonly drafts = new Map<string, unknown>();
  readonly tasks = new Map<string, { id: string; title: string; plainText: string; done: boolean }>();
  private privateAccess = false;
  version = 0;
  constructor() {
    const seed = (id: string, title: string, text: string, privacy: EvidencePrivacy = "public") => this.records.set(`sample:${id}`, { key: `sample:${id}`, scope: this.scope, title, text, updatedAt: 1, privacy });
    seed("qc", "QC report FG-17", "QC report: FG-17 moisture measured 0.8%. Disposition recorded: pass. Method and calibration require verification.");
    seed("sop", "Approved SOP v3", "Approved SOP v3: finished material moisture must be at most 0.5%. Applies to dryer M1. Approval date: 2026-09-01.");
    seed("maintenance", "Dryer M1 maintenance", "Maintenance record: dryer M1 temperature drift was observed. No demonstrated causal link to FG-17 has been established.");
    seed("ledger", "Batch ledger FG-17", "Batch ledger: FG-17 used raw material R-42 on dryer M1 under SOP v3. Supplier certificate was not attached to this ledger.");
    seed("complaint", "Complaint FG-17", "Customer complaint: FG-17 caking was reported after delivery. Cause and storage conditions remain unverified.");
    seed("meeting", "Meeting FG-17", "Meeting proposal: inspect M1 and request the R-42 supplier certificate. SOP v4 limit 0.7% was proposed, not approved.");
    seed("archive", "Old long QC archive", "Historical unrelated context. ".repeat(900) + "Archived FG-17 note: calibration trace was requested; the result was not included in this selected record.");
    seed("draft-sop", "Unapproved SOP v4 draft", "Draft SOP v4: a moisture limit of 0.7% is proposed. This draft has no approval and does not replace approved SOP v3.");
    seed("internal", "Private internal meeting", "Private meeting: FG-17 commercial handling is under discussion. Do not treat this as technical proof.", "private");
    seed("unrelated", "Other batch FG-99", "Unrelated batch FG-99 ran on M9 using R-88. Separate production context.");
  }
  setPrivateAccess(value: boolean) { this.privateAccess = value; this.version++; }
  edit(key: string, text: string) { const source = this.records.get(key); if (source) { this.records.set(key, { ...source, text, updatedAt: source.updatedAt + 1 }); this.version++; } }
  delete(key: string) { this.records.delete(key); this.version++; }
  async resolve(key: string) { const source = this.records.get(key); if (source?.privacy === "private" && !this.privateAccess) throw new Error("evidence-source-locked"); return source ? { ...source } : null; }
  async search(query: string) {
    const terms = queryTerms(query);
    return [...this.records.values()].filter(source => (source.privacy === "public" || this.privateAccess) && terms.some(term => (source.title + " " + source.text).toLowerCase().includes(term))).map(source => source.key);
  }
}
