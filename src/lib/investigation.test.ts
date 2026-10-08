import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "../db";
import { checkEvidence, FG17EvidenceRepository, localEvidenceRepository, referenceQuote, retrieveInvestigation } from "./investigationEvidence";
import { compileInvestigation, confirmInvestigationTask, exportInvestigation, fg17MockProposal, investigationPrivate, loadInvestigation, localEvidenceOutline, previewInvestigationTask, publishInvestigationRelation, renderInvestigation, saveInvestigation, validateInvestigation } from "./investigation";
import { lockSecureVault, readSecureVault, savePrivateItem, unlockSecureVault } from "./secureSecretary";
import { mockSecretaryVault } from "./secureSecretary.fixture";
beforeAll(() => { Object.defineProperty(globalThis.crypto, "subtle", { configurable: true, value: webcrypto.subtle }); });
afterEach(async () => { if (window.chengjing?.secretaryVault) await lockSecureVault(); window.chengjing = undefined; await db.cards.clear(); await db.brainEdges.clear(); vi.restoreAllMocks(); });
const setup = async (privateInput = false) => {
  const repo = new FG17EvidenceRepository(); repo.setPrivateAccess(privateInput);
  const hits = await retrieveInvestigation(repo, "FG-17", "en");
  const artifact = await compileInvestigation(fg17MockProposal(), hits.map(hit => hit.source.key), "Investigate FG-17", repo);
  return { repo, hits, artifact };
};
describe("cross-source evidence to action", () => {
  it("local private drafts/tasks use the vault and a preview cannot survive lock followed by unlock", async () => {
    window.chengjing = { secretaryVault: mockSecretaryVault() } as NonNullable<Window["chengjing"]>; await unlockSecureVault();
    const item = await savePrivateItem("note", "FG-71 private calibration evidence requires review.");
    const source = (await localEvidenceRepository.resolve(`private:${item.id}`))!;
    const artifact = await compileInvestigation(localEvidenceOutline([source], "FG-71"), [source.key], "FG-71", localEvidenceRepository);
    await saveInvestigation(artifact, localEvidenceRepository);
    const preview = await previewInvestigationTask(artifact, artifact.actions[0].id, localEvidenceRepository);
    await lockSecureVault(); await unlockSecureVault();
    await expect(confirmInvestigationTask(preview)).rejects.toThrow("session-changed");
    const fresh = await previewInvestigationTask(artifact, artifact.actions[0].id, localEvidenceRepository); const task = await confirmInvestigationTask(fresh);
    const entries = (await readSecureVault()).data.entries;
    expect(entries[`secretary-investigation:${artifact.id}`]).toBeDefined(); expect(entries[`secretary-task-evidence:${task.id}`]).toBeDefined();
    expect(await db.cards.count()).toBe(0); expect(await db.tasks.count()).toBe(0);
  });
  it("empty edited action references and manufactured causal classifications cannot pass validation", async () => {
    const { artifact, repo } = await setup(); artifact.actions[0].findingIds = [];
    await expect(validateInvestigation(artifact, repo)).rejects.toThrow("action-evidence-required");
    artifact.actions[0].findingIds = [artifact.findings[0].id]; artifact.findings[1].kind = "proven-cause" as never;
    await expect(validateInvestigation(artifact, repo)).rejects.toThrow("finding-invalid");
  });
  it("retrieves approved SOP, ledger, maintenance and long archived tails, excluding unrelated batches", async () => {
    const { hits } = await setup();
    expect(hits.map(hit => hit.source.key)).toEqual(expect.arrayContaining(["sample:qc", "sample:sop", "sample:maintenance", "sample:ledger", "sample:complaint", "sample:meeting", "sample:archive", "sample:draft-sop"]));
    expect(hits.some(hit => hit.source.key === "sample:unrelated" || hit.source.key === "sample:internal")).toBe(false);
    expect(hits.find(hit => hit.source.key === "sample:archive")!.evidence.start).toBeGreaterThan(20000);
  });
  it("retains all four classifications, quotes rather than model paraphrases and verifiable both-end references", async () => {
    const { artifact, repo } = await setup();
    expect(new Set(artifact.findings.map(item => item.kind)).size).toBe(4);
    expect(artifact.findings[0].text).not.toContain("ignored paraphrase");
    for (const relation of artifact.relations) for (const ref of relation.evidence) expect(await checkEvidence(ref, repo)).toBe("valid");
    expect(renderInvestigation(artifact)).toContain("SHA256:");
    expect(renderInvestigation(artifact)).toContain("unverified");
  });
  it("rejects invented, unselected and same-source conflict citations", async () => {
    const { repo, hits } = await setup(); const keys = hits.map(hit => hit.source.key);
    const invented = fg17MockProposal(); invented.findings[0].evidence[0].quote = "M1 definitely caused the complaint";
    await expect(compileInvestigation(invented, keys, "FG-17", repo)).rejects.toThrow("not-original");
    await expect(compileInvestigation(fg17MockProposal(), keys.filter(key => key !== "sample:sop"), "FG-17", repo)).rejects.toThrow("unselected");
    const conflict = fg17MockProposal(); conflict.findings[2].evidence[1] = conflict.findings[2].evidence[0];
    await expect(compileInvestigation(conflict, keys, "FG-17", repo)).rejects.toThrow("evidence-required");
  });
  it("detects altered text even when revision is unchanged and refuses forged spans", async () => {
    const { repo } = await setup(); const source = (await repo.resolve("sample:qc"))!;
    const ref = await referenceQuote(source, "FG-17 moisture measured 0.8%.");
    expect(await checkEvidence({ ...ref, start: 0 }, repo)).toBe("invalid");
    repo.records.set(source.key, { ...source, text: source.text + " correction" });
    expect(await checkEvidence(ref, repo)).toBe("changed");
  });
  it("keeps unquoted private inputs private, refuses manifest removal and private graph publication", async () => {
    const { artifact, repo } = await setup(true);
    expect(artifact.findings.flatMap(item => item.evidence).some(ref => ref.key === "sample:internal")).toBe(false);
    expect(investigationPrivate(artifact)).toBe(true);
    await expect(publishInvestigationRelation(artifact, artifact.relations[0].id, repo)).rejects.toThrow("graph-denied");
    const tampered = structuredClone(artifact); tampered.inputSources = tampered.inputSources.filter(source => source.privacy !== "private");
    await expect(validateInvestigation(tampered, repo)).rejects.toThrow("provenance-invalid");
  });
  it("saves/reloads and confirms deduplicated case tasks without touching real stores", async () => {
    const { artifact, repo } = await setup(); const counts = await Promise.all([db.cards.count(), db.fragments.count(), db.brainEdges.count(), db.tasks.count()]);
    await saveInvestigation(artifact, repo); expect((await loadInvestigation(artifact.id, repo)).id).toBe(artifact.id);
    const preview = await previewInvestigationTask(artifact, artifact.actions[0].id, repo);
    expect(preview.text).toContain("sample:qc"); await confirmInvestigationTask(preview); await confirmInvestigationTask(preview);
    expect(repo.tasks.size).toBe(1);
    expect(await Promise.all([db.cards.count(), db.fragments.count(), db.brainEdges.count(), db.tasks.count()])).toEqual(counts);
    await expect(confirmInvestigationTask({ ...preview })).rejects.toThrow("preview-required");
  });
  it("source changes/deletion revoke save, export and previously minted task preview", async () => {
    const { artifact, repo } = await setup(); const preview = await previewInvestigationTask(artifact, artifact.actions[0].id, repo);
    const consent = vi.spyOn(window, "confirm").mockReturnValue(true); repo.edit("sample:qc", "Changed FG-17 result");
    expect((await validateInvestigation(artifact, repo))["sample:qc"]).toBe("changed");
    await expect(saveInvestigation(artifact, repo)).rejects.toThrow("sources-invalid");
    await expect(exportInvestigation(artifact, repo, "en")).rejects.toThrow("sources-invalid");
    await expect(confirmInvestigationTask(preview)).rejects.toThrow("sources-invalid"); expect(consent).not.toHaveBeenCalled();
    repo.delete("sample:sop"); expect((await validateInvestigation(artifact, repo))["sample:sop"]).toBe("missing"); expect(repo.tasks.size).toBe(0);
  });
  it("locking even an unquoted private source invalidates actions and draft reopening", async () => {
    const { artifact, repo } = await setup(true); await saveInvestigation(artifact, repo);
    const preview = await previewInvestigationTask(artifact, artifact.actions[0].id, repo); repo.setPrivateAccess(false);
    expect((await validateInvestigation(artifact, repo))["sample:internal"]).toBe("locked");
    await expect(confirmInvestigationTask(preview)).rejects.toThrow("sources-invalid");
    await expect(loadInvestigation(artifact.id, repo)).rejects.toThrow("source-locked");
  });
});
