import { db } from "../db";
import type { AppLanguage, BrainEdgeRecord } from "../types";
import { exportSourceDocument, matchingExcerpt, queryTerms } from "./sourceWorkbench";
import { readSecureVault, secureVaultEpoch, secureVaultTransaction, type PrivateItem } from "./secureSecretary";
import { requirePublicRecord } from "./privateOutbound";
import { checkEvidence, FG17EvidenceRepository, investigationIdentifiers, referenceQuote, stampSource, type EvidenceRef, type EvidenceRepository, type EvidenceSource, type EvidenceState, type SourceStamp } from "./investigationEvidence";

export type FindingKind = "fact" | "inference" | "conflict" | "gap";
export interface InvestigationFinding { id: string; kind: FindingKind; text: string; evidence: EvidenceRef[] }
export interface InvestigationRelation { id: string; kind: "association" | "possible-factor" | "conflict"; reason: string; evidence: [EvidenceRef, EvidenceRef]; decision: "proposed" | "accepted" | "rejected" }
export interface InvestigationAction { id: string; title: string; rationale: string; findingIds: string[] }
export interface Investigation {
  version: 1; id: string; scope: string; question: string; inputSources: SourceStamp[];
  findings: InvestigationFinding[]; relations: InvestigationRelation[]; actions: InvestigationAction[];
  notes: string; createdAt: number;
  secretaryProvenance: { version: 1; sources: Array<{ key: string; private: boolean }> };
}
const manifests = new WeakMap<EvidenceRepository, Map<string, string>>();
const manifest = (artifact: Investigation) => JSON.stringify(artifact.inputSources.map(source => [source.key, source.scope, source.title, source.updatedAt, source.fingerprint, source.privacy]));
function registerArtifact(artifact: Investigation, repository: EvidenceRepository) {
  const records = manifests.get(repository) || new Map<string, string>(); records.set(artifact.id, manifest(artifact)); manifests.set(repository, records);
}
interface RawCitation { key: string; quote: string }
export interface InvestigationProposal {
  findings: Array<{ id: string; kind: FindingKind; text: string; evidence: RawCitation[] }>;
  relations: Array<{ kind: InvestigationRelation["kind"]; reason: string; evidence: [RawCitation, RawCitation] }>;
  actions: Array<{ title: string; rationale: string; findingIds: string[] }>;
}
const boundedText = (value: unknown, max: number) => { if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error("investigation-text-invalid"); return value.trim(); };

/** All model/manual proposals are untrusted. Resolve citations against selected
 * authority and derive privacy from ALL inputs, including unquoted inputs.
 * Fact text is always original quotations, never the proposer's paraphrase.
 */
export async function compileInvestigation(proposal: InvestigationProposal, selected: string[], question: string, repository: EvidenceRepository): Promise<Investigation> {
  if (!Array.isArray(selected) || !selected.length || selected.length > 12 || new Set(selected).size !== selected.length) throw new Error("investigation-selection-invalid");
  boundedText(question, 2000);
  const sources = new Map<string, EvidenceSource>();
  for (const key of selected) { const source = await repository.resolve(key); if (!source) throw new Error("investigation-source-missing"); sources.set(key, source); }
  const cite = async (item: RawCitation) => { if (!item || !sources.has(item.key)) throw new Error("investigation-unselected-source"); return referenceQuote(sources.get(item.key)!, item.quote); };
  if (!proposal || !Array.isArray(proposal.findings) || !proposal.findings.length || proposal.findings.length > 24 || !Array.isArray(proposal.relations) || proposal.relations.length > 12 || !Array.isArray(proposal.actions) || proposal.actions.length > 12) throw new Error("investigation-proposal-invalid");
  const findings: InvestigationFinding[] = [];
  for (const finding of proposal.findings) {
    if (!finding || !["fact", "inference", "conflict", "gap"].includes(finding.kind) || !Array.isArray(finding.evidence) || finding.evidence.length > 6 || !/^[\w-]{1,80}$/.test(finding.id) || findings.some(item => item.id === finding.id)) throw new Error("investigation-finding-invalid");
    const evidence = await Promise.all(finding.evidence.map(cite));
    if (finding.kind !== "gap" && !evidence.length || finding.kind === "conflict" && new Set(evidence.map(item => item.key)).size < 2) throw new Error("investigation-evidence-required");
    findings.push({ id: finding.id, kind: finding.kind, text: finding.kind === "fact" ? evidence.map(item => item.quote).join("\n") : boundedText(finding.text, 4000), evidence });
  }
  const relations: InvestigationRelation[] = [];
  for (const relation of proposal.relations) {
    if (!relation || !["association", "possible-factor", "conflict"].includes(relation.kind) || !Array.isArray(relation.evidence) || relation.evidence.length !== 2) throw new Error("investigation-relation-invalid");
    const evidence = await Promise.all(relation.evidence.map(cite));
    if (evidence[0].key === evidence[1].key) throw new Error("investigation-two-sources-required");
    relations.push({ id: crypto.randomUUID(), kind: relation.kind, reason: boundedText(relation.reason, 700), evidence: evidence as [EvidenceRef, EvidenceRef], decision: "proposed" });
  }
  const actions = proposal.actions.map(action => {
    if (!action || !Array.isArray(action.findingIds) || !action.findingIds.length || action.findingIds.length > 6 || action.findingIds.some(id => !findings.some(finding => finding.id === id))) throw new Error("investigation-action-evidence-required");
    return { id: crypto.randomUUID(), title: boundedText(action.title, 200), rationale: boundedText(action.rationale, 1000), findingIds: [...action.findingIds] };
  });
  const artifact: Investigation = { version: 1, id: crypto.randomUUID(), scope: repository.scope, question, inputSources: await Promise.all([...sources.values()].map(stampSource)), findings, relations, actions, notes: "", createdAt: Date.now(), secretaryProvenance: { version: 1, sources: [...sources.values()].map(source => ({ key: source.key, private: source.privacy === "private" })) } };
  registerArtifact(artifact, repository);
  await assertInvestigationCurrent(artifact, repository);
  return artifact;
}

export function localEvidenceOutline(sources: EvidenceSource[], question = ""): InvestigationProposal {
  const citation = (source: EvidenceSource) => ({ key: source.key, quote: matchingExcerpt(source.text, queryTerms(question || investigationIdentifiers(source.text).join(" "))) });
  const findings: InvestigationProposal["findings"] = sources.map((source, index) => ({ id: `record-${index}`, kind: "fact", text: "", evidence: [citation(source)] }));
  const relations: InvestigationProposal["relations"] = [];
  for (let left = 0; left < sources.length; left++) for (let right = left + 1; right < sources.length && relations.length < 8; right++) {
    const shared = investigationIdentifiers(sources[left].text).filter(id => investigationIdentifiers(sources[right].text).includes(id));
    if (shared.length) relations.push({ kind: "association", reason: `Shared identifier ${shared.join(" / ")}. This is an association to review, not a proven cause.`, evidence: [citation(sources[left]), citation(sources[right])] });
  }
  findings.push({ id: "causal-gap", kind: "gap", text: "The selected records do not establish a cause. Verify methods, versions and missing records before deciding.", evidence: [] });
  return { findings, relations, actions: [{ title: "Review evidence and missing records", rationale: "Resolve the stated evidence gap before drawing a causal conclusion.", findingIds: ["causal-gap"] }] };
}

/** Deterministic synthetic provider fixture, only available to the isolated case. */
export function fg17MockProposal(): InvestigationProposal {
  const qc = { key: "sample:qc", quote: "FG-17 moisture measured 0.8%. Disposition recorded: pass." };
  const sop = { key: "sample:sop", quote: "finished material moisture must be at most 0.5%." };
  const maintenance = { key: "sample:maintenance", quote: "dryer M1 temperature drift was observed." };
  const ledger = { key: "sample:ledger", quote: "FG-17 used raw material R-42 on dryer M1 under SOP v3." };
  const complaint = { key: "sample:complaint", quote: "FG-17 caking was reported after delivery." };
  const meeting = { key: "sample:meeting", quote: "SOP v4 limit 0.7% was proposed, not approved." };
  return {
    findings: [
      { id: "qc-record", kind: "fact", text: "ignored paraphrase", evidence: [qc, complaint] },
      { id: "possible-factor", kind: "inference", text: "M1 drift is a possible factor to investigate; the records do not establish that it caused the complaint.", evidence: [maintenance, ledger] },
      { id: "disposition-conflict", kind: "conflict", text: "The recorded pass and approved 0.5% criterion appear inconsistent. Verify units, method and applicable version before resolving this.", evidence: [qc, sop] },
      { id: "certificate-gap", kind: "gap", text: "No supplier certificate is included in the selected evidence. Request it; absence here does not prove it does not exist elsewhere.", evidence: [ledger] },
      { id: "approval-record", kind: "fact", text: "not an approval", evidence: [meeting] },
    ],
    relations: [
      { kind: "conflict", reason: "QC disposition versus SOP criterion needs review; a proposal is not an approved SOP change.", evidence: [qc, sop] },
      { kind: "possible-factor", reason: "Shared dryer M1 links batch and maintenance; causality remains unverified.", evidence: [ledger, maintenance] },
    ],
    actions: [
      { title: "Recheck FG-17 measurement and disposition", rationale: "Verify units, method, calibration and the applicable approved SOP.", findingIds: ["disposition-conflict"] },
      { title: "Verify M1 calibration", rationale: "Test the possible factor rather than assert a proven cause.", findingIds: ["possible-factor"] },
      { title: "Request the R-42 supplier certificate", rationale: "Fill the selected evidence gap.", findingIds: ["certificate-gap"] },
    ],
  };
}

export async function validateInvestigation(artifact: Investigation, repository: EvidenceRepository): Promise<Record<string, EvidenceState>> {
  if (!artifact || artifact.version !== 1 || artifact.scope !== repository.scope || !Array.isArray(artifact.inputSources) || !artifact.inputSources.length || artifact.inputSources.length > 12 || !Array.isArray(artifact.findings) || artifact.findings.length > 24 || !Array.isArray(artifact.relations) || artifact.relations.length > 12 || !Array.isArray(artifact.actions) || artifact.actions.length > 12 || typeof artifact.notes !== "string" || artifact.notes.length > 32000) throw new Error("investigation-draft-invalid");
  if (manifests.get(repository)?.get(artifact.id) !== manifest(artifact) || JSON.stringify(artifact.secretaryProvenance) !== JSON.stringify({ version: 1, sources: artifact.inputSources.map(source => ({ key: source.key, private: source.privacy === "private" })) })) throw new Error("investigation-provenance-invalid");
  const status: Record<string, EvidenceState> = Object.create(null);
  boundedText(artifact.question, 2000);
  const findingIds = new Set<string>();
  for (const finding of artifact.findings) {
    if (!finding || !["fact", "inference", "conflict", "gap"].includes(finding.kind) || typeof finding.id !== "string" || findingIds.has(finding.id) || !Array.isArray(finding.evidence) || finding.evidence.length > 6) throw new Error("investigation-finding-invalid");
    findingIds.add(finding.id);
    if (finding.kind !== "fact") boundedText(finding.text, 4000);
    if (finding.kind !== "gap" && !finding.evidence.length || finding.kind === "conflict" && new Set(finding.evidence.map(ref => ref.key)).size < 2) throw new Error("investigation-evidence-required");
  }
  for (const relation of artifact.relations) {
    if (!relation || !["association", "possible-factor", "conflict"].includes(relation.kind) || !["proposed", "accepted", "rejected"].includes(relation.decision) || !Array.isArray(relation.evidence) || relation.evidence.length !== 2 || relation.evidence[0].key === relation.evidence[1].key) throw new Error("investigation-relation-invalid");
    boundedText(relation.reason, 700);
  }
  for (const action of artifact.actions) {
    boundedText(action.title, 200); boundedText(action.rationale, 1000);
    if (!Array.isArray(action.findingIds) || !action.findingIds.length || action.findingIds.length > 6 || action.findingIds.some(id => !findingIds.has(id))) throw new Error("investigation-action-evidence-required");
  }
  for (const source of artifact.inputSources) status[source.key] = await checkEvidence(source, repository);
  const refs = [...artifact.findings.flatMap(finding => finding.evidence), ...artifact.relations.flatMap(relation => relation.evidence)];
  for (const ref of refs) {
    if (!artifact.inputSources.some(source => source.key === ref.key && source.fingerprint === ref.fingerprint && source.privacy === ref.privacy)) throw new Error("investigation-provenance-invalid");
    const next = await checkEvidence(ref, repository); if (next !== "valid") status[ref.key] = next;
  }
  return status;
}
export async function assertInvestigationCurrent(artifact: Investigation, repository: EvidenceRepository) {
  const states = await validateInvestigation(artifact, repository);
  if (Object.values(states).some(state => state !== "valid")) throw new Error("investigation-sources-invalid: " + Object.entries(states).filter(([, state]) => state !== "valid").map(([key, state]) => `${key} ${state}`).join(" / "));
}
export const investigationPrivate = (artifact: Investigation) => artifact.inputSources.some(source => source.privacy === "private");
export const findingLabels = { fact: "Recorded facts (original quotations)", inference: "Inference — unverified", conflict: "Apparent conflict — verify context", gap: "Missing evidence — selected scope only" };
export function renderInvestigation(artifact: Investigation) {
  const quote = (ref: EvidenceRef) => `\n> ${ref.quote.replace(/\n/g, "\n> ")}\nSource: ${ref.key}; scope: ${ref.scope}; revision: ${ref.updatedAt}; span: ${ref.start}-${ref.end}; SHA256: ${ref.fingerprint}\n`;
  return `# ${artifact.question}\n\nScope: ${artifact.scope}. Quotations can be verified; interpretations are not established facts.\n` + artifact.findings.map(finding => `\n## ${findingLabels[finding.kind]}\n${finding.kind === "fact" ? "" : finding.text}\n${finding.evidence.map(quote).join("\n")}`).join("\n") + "\n## Relationship proposals\n" + artifact.relations.map(relation => `${relation.decision}: ${relation.reason}\n${relation.evidence.map(quote).join("\n")}`).join("\n") + "\n## Improvement / task proposals\n" + artifact.actions.map(action => `- ${action.title}: ${action.rationale} [findings: ${action.findingIds.join(", ")}]`).join("\n") + `\n\n## User notes (not revalidated conclusions)\n${artifact.notes}\n\n## All input sources / retained privacy\n` + artifact.inputSources.map(source => `${source.key}: ${source.privacy}, ${source.fingerprint}`).join("\n");
}
export async function saveInvestigation(artifact: Investigation, repository: EvidenceRepository) {
  const epoch = secureVaultEpoch();
  await assertInvestigationCurrent(artifact, repository);
  if (repository instanceof FG17EvidenceRepository) { repository.drafts.set(artifact.id, structuredClone(artifact)); return; }
  if (repository.scope !== "local") throw new Error("investigation-scope-invalid");
  if (epoch !== secureVaultEpoch()) throw new Error("vault-session-changed");
  await secureVaultTransaction(data => { data.entries[`secretary-investigation:${artifact.id}`] = structuredClone(artifact); });
}
export async function loadInvestigation(id: string, repository: EvidenceRepository) {
  if (!/^[\w-]{8,100}$/.test(id)) throw new Error("investigation-draft-invalid");
  const artifact = repository instanceof FG17EvidenceRepository ? structuredClone(repository.drafts.get(id)) : (await readSecureVault()).data.entries[`secretary-investigation:${id}`];
  const draft = artifact as Investigation;
  if (!draft || draft.id !== id || draft.version !== 1 || draft.scope !== repository.scope || !Array.isArray(draft.inputSources) || draft.inputSources.length > 12) throw new Error("investigation-draft-invalid");
  registerArtifact(draft, repository); const states = await validateInvestigation(draft, repository);
  if (Object.values(states).includes("locked")) throw new Error("investigation-source-locked");
  return draft;
}
export async function exportInvestigation(artifact: Investigation, repository: EvidenceRepository, language: AppLanguage) {
  const epoch = secureVaultEpoch(); await assertInvestigationCurrent(artifact, repository);
  if (repository.scope === "local" && epoch !== secureVaultEpoch()) throw new Error("vault-session-changed");
  return exportSourceDocument(renderInvestigation(artifact), language);
}

export interface InvestigationTaskPreview { readonly id: string; readonly title: string; readonly text: string }
const taskTickets = new WeakMap<InvestigationTaskPreview, { artifact: Investigation; repository: EvidenceRepository; actionId: string; epoch: number }>();
export async function previewInvestigationTask(artifact: Investigation, actionId: string, repository: EvidenceRepository): Promise<InvestigationTaskPreview> {
  const epoch = secureVaultEpoch();
  await assertInvestigationCurrent(artifact, repository);
  const action = artifact.actions.find(action => action.id === actionId); if (!action) throw new Error("investigation-action-invalid");
  const evidence = action.findingIds.flatMap(id => artifact.findings.find(finding => finding.id === id)?.evidence || []);
  const text = `${action.title}\n${action.rationale}\nUnverified investigation proposal; no alarm scheduled.\n${action.findingIds.map(id => { const finding = artifact.findings.find(item => item.id === id)!; return `${findingLabels[finding.kind]}: ${finding.kind === "fact" ? finding.evidence.map(ref => ref.quote).join("\n") : finding.text}`; }).join("\n")}\n${evidence.map(ref => `${ref.key} [${ref.start}-${ref.end}] SHA256 ${ref.fingerprint}\n${ref.quote}`).join("\n")}`;
  const preview = Object.freeze({ id: action.id, title: action.title, text });
  if (repository.scope === "local" && epoch !== secureVaultEpoch()) throw new Error("vault-session-changed");
  taskTickets.set(preview, { artifact: structuredClone(artifact), repository, actionId, epoch }); return preview;
}
export async function confirmInvestigationTask(preview: InvestigationTaskPreview) {
  const ticket = taskTickets.get(preview); if (!ticket) throw new Error("investigation-task-preview-required");
  const { artifact, repository } = ticket; await assertInvestigationCurrent(artifact, repository);
  if (repository instanceof FG17EvidenceRepository) {
    const existing = repository.tasks.get(preview.id); if (existing) return existing;
    const task = { id: preview.id, title: preview.title, plainText: preview.text, done: false }; repository.tasks.set(task.id, task); return task;
  }
  if (repository.scope !== "local" || ticket.epoch !== secureVaultEpoch()) throw new Error("vault-session-changed");
  return secureVaultTransaction(data => {
    const key = `secretary-item:${preview.id}`; const prior = data.entries[key] as PrivateItem | undefined;
    if (prior) { if (prior.kind !== "task" || prior.plainText !== preview.text) throw new Error("investigation-task-conflict"); return prior; }
    const now = Date.now(); const task: PrivateItem = { id: preview.id, kind: "task", title: preview.title, plainText: preview.text, done: false, createdAt: now, updatedAt: now };
    data.entries[key] = task;
    data.entries[`secretary-task-evidence:${preview.id}`] = { version: 1, taskId: preview.id, investigationId: artifact.id, inputSources: artifact.inputSources, evidence: artifact.findings.filter(finding => artifact.actions.find(action => action.id === ticket.actionId)?.findingIds.includes(finding.id)).flatMap(finding => finding.evidence) };
    return task;
  });
}

export async function publishInvestigationRelation(artifact: Investigation, relationId: string, repository: EvidenceRepository) {
  await assertInvestigationCurrent(artifact, repository);
  if (repository.scope !== "local" || investigationPrivate(artifact)) throw new Error("investigation-public-graph-denied");
  const relation = artifact.relations.find(item => item.id === relationId); if (!relation || relation.decision !== "accepted") throw new Error("investigation-relation-acceptance-required");
  const endpoints = relation.evidence.map(ref => /^(card|fragment):(.+)$/.exec(ref.key));
  if (endpoints.some(endpoint => !endpoint)) throw new Error("investigation-public-graph-denied");
  const originals = await Promise.all(artifact.inputSources.map(ref => repository.resolve(ref.key)));
  for (let index = 0; index < originals.length; index++) if (!originals[index] || (await stampSource(originals[index]!)).fingerprint !== artifact.inputSources[index].fingerprint) throw new Error("investigation-source-changed");
  await db.transaction("rw", db.cards, db.fragments, db.brainEdges, async () => {
    for (let index = 0; index < artifact.inputSources.length; index++) {
      const stamp = artifact.inputSources[index]; const endpoint = /^(card|fragment):(.+)$/.exec(stamp.key);
      if (!endpoint) throw new Error("investigation-public-graph-denied");
      const record = endpoint[1] === "card" ? await db.cards.get(endpoint[2]) : await db.fragments.get(endpoint[2]);
      if (!record || "state" in record && record.state === "trash") throw new Error("investigation-source-changed");
      requirePublicRecord("sync", record);
      if (record.updatedAt !== stamp.updatedAt || ("plainText" in record ? record.plainText : record.text) !== originals[index]?.text || ("title" in record ? record.title : record.text.split("\n")[0].slice(0, 80)) !== stamp.title) throw new Error("investigation-source-changed");
    }
    const edge: BrainEdgeRecord = { id: relation.id, sourceType: endpoints[0]![1] as "card" | "fragment", sourceId: endpoints[0]![2], targetType: endpoints[1]![1] as "card" | "fragment", targetId: endpoints[1]![2], origin: "manual", reason: relation.reason, relationType: relation.kind === "conflict" ? "contrast" : relation.kind === "possible-factor" ? "possible_influence" : "shared_context", evidence: relation.evidence.map(ref => ref.quote), evidenceRefs: relation.evidence, createdAt: artifact.createdAt };
    await db.brainEdges.put(edge);
  });
}
