import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "../db";
import type { CardRecord } from "../types";
import { compileInvestigation, confirmInvestigationTask, exportInvestigation, localEvidenceOutline, previewInvestigationTask, saveInvestigation, validateInvestigation } from "./investigation";
import { localEvidenceRepository, type EvidenceRepository } from "./investigationEvidence";
import { lockSecureVault, readSecureVault, savePrivateItem, secureVaultTransaction, unlockSecureVault } from "./secureSecretary";
import { mockSecretaryVault } from "./secureSecretary.fixture";

beforeAll(() => Object.defineProperty(globalThis.crypto, "subtle", { configurable: true, value: webcrypto.subtle }));
afterEach(async () => { vi.restoreAllMocks(); if (window.chengjing?.secretaryVault) await lockSecureVault(); window.chengjing = undefined; await db.cards.clear(); await db.fragments.clear(); });
const card = (id: string, text: string): CardRecord => ({ id, title: id, plainText: text, contentHtml: "", kind: "note", state: "active", createdAt: 1, updatedAt: 1, tagIds: [], favorite: false, color: "slate", attachmentIds: [], properties: {} });
function gate() {
  let release!: () => void; let enter!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; }); const wait = new Promise<void>(resolve => { release = resolve; });
  return { entered, release, enter, wait };
}
async function setup() {
  const bridge = mockSecretaryVault(); window.chengjing = { secretaryVault: bridge } as NonNullable<Window["chengjing"]>; await unlockSecureVault();
  await db.cards.bulkAdd([card("zt-quality", "ZT-82 pressure measured 8 bar on M6. Measurement needs review."), card("zt-maintenance", "M6 valve maintenance recorded. No proven causal link to ZT-82.")]);
  const sources = await Promise.all(["card:zt-quality", "card:zt-maintenance"].map(key => localEvidenceRepository.resolve(key)));
  const artifact = await compileInvestigation(localEvidenceOutline(sources.map(source => source!), "ZT-82"), sources.map(source => source!.key), "ZT-82 / M6", localEvidenceRepository);
  artifact.actions[0].findingIds = ["record-0"];
  const preview = await previewInvestigationTask(artifact, artifact.actions[0].id, localEvidenceRepository);
  return { bridge, artifact, preview };
}
function delayNextRead(bridge: ReturnType<typeof mockSecretaryVault>) {
  const pause = gate(); const original = bridge.read;
  vi.spyOn(bridge, "read").mockImplementationOnce(async () => { pause.enter(); await pause.wait; return original(); });
  return pause;
}
describe("R10: invalidate source-dependent persistence during asynchronous preparation", () => {
  it.each(["delete", "edit", "lock", "lock-unlock"])("refuses a new task if a source %s occurs while vault.read waits", async mutation => {
    const { bridge, artifact, preview } = await setup(); const commit = vi.spyOn(bridge, "commit"); const pause = delayNextRead(bridge);
    const pending = confirmInvestigationTask(preview); const failure = expect(pending).rejects.toThrow(/sources-invalid|locked|session-changed/);
    await pause.entered;
    if (mutation === "delete") await db.cards.delete("zt-quality");
    else if (mutation === "edit") await db.cards.update("zt-quality", { plainText: "ZT-82 reading corrected to 6 bar", updatedAt: 2 });
    else { await lockSecureVault(); if (mutation === "lock-unlock") await unlockSecureVault(); }
    pause.release(); await failure; expect(commit).not.toHaveBeenCalled();
    if (mutation === "lock") await unlockSecureVault();
    const entries = (await readSecureVault()).data.entries;
    expect(entries[`secretary-item:${preview.id}`]).toBeUndefined(); expect(entries[`secretary-task-evidence:${preview.id}`]).toBeUndefined();
    await expect(confirmInvestigationTask(preview)).rejects.toThrow("preview-required");
    if (mutation === "delete") expect((await validateInvestigation(artifact, localEvidenceRepository))["card:zt-quality"]).toBe("missing");
  });
  it("revokes even a same-revision edit restored before the pending read completes", async () => {
    const { bridge, preview } = await setup(); const before = (await db.cards.get("zt-quality"))!; const commit = vi.spyOn(bridge, "commit"); const pause = delayNextRead(bridge);
    const pending = confirmInvestigationTask(preview); const failure = expect(pending).rejects.toThrow("sources-invalidated"); await pause.entered;
    await db.cards.update(before.id, { plainText: "Temporary changed reading" }); await db.cards.put(before);
    pause.release(); await failure; expect(commit).not.toHaveBeenCalled();
  });
  it("also refuses draft persistence after deletion during its vault read", async () => {
    const { bridge, artifact } = await setup(); const commit = vi.spyOn(bridge, "commit"); const pause = delayNextRead(bridge);
    const pending = saveInvestigation(artifact, localEvidenceRepository); const failure = expect(pending).rejects.toThrow("sources-invalidated"); await pause.entered;
    await db.cards.delete("zt-quality"); pause.release(); await failure; expect(commit).not.toHaveBeenCalled();
    expect((await readSecureVault()).data.entries[`secretary-investigation:${artifact.id}`]).toBeUndefined();
  });
  it("source edits during the final multi-source validation cannot reuse an earlier checked source", async () => {
    const { bridge, artifact } = await setup(); const pause = gate(); let armed = false;
    const repository: EvidenceRepository = { ...localEvidenceRepository, async resolve(key) { const source = await localEvidenceRepository.resolve(key); if (armed && key === "card:zt-maintenance") { armed = false; pause.enter(); await pause.wait; } return source; } };
    const sources = await Promise.all(artifact.inputSources.map(source => repository.resolve(source.key)));
    const draft = await compileInvestigation(localEvidenceOutline(sources.map(source => source!), "ZT-82"), sources.map(source => source!.key), "ZT-82", repository);
    draft.actions[0].findingIds = ["record-0"]; const preview = await previewInvestigationTask(draft, draft.actions[0].id, repository);
    const originalRead = bridge.read; vi.spyOn(bridge, "read").mockImplementationOnce(async () => { armed = true; return originalRead(); });
    const commit = vi.spyOn(bridge, "commit"); const pending = confirmInvestigationTask(preview); const failure = expect(pending).rejects.toThrow(/sources-invalid/); await pause.entered;
    await db.cards.update("zt-quality", { plainText: "ZT-82 changed after first source check" }); pause.release(); await failure; expect(commit).not.toHaveBeenCalled();
  });
  it("revalidates on a CAS retry rather than committing an old evidence snapshot", async () => {
    const { bridge, preview } = await setup(); const originalCommit = bridge.commit;
    const commits = vi.spyOn(bridge, "commit").mockImplementationOnce(async () => { await db.cards.delete("zt-quality"); throw new Error("vault-revision-conflict"); }).mockImplementation(originalCommit);
    await expect(confirmInvestigationTask(preview)).rejects.toThrow("sources-invalidated"); expect(commits).toHaveBeenCalledTimes(1);
    expect((await readSecureVault()).data.entries[`secretary-item:${preview.id}`]).toBeUndefined();
  });
  it("also revokes a quick-fragment input deleted during the vault read", async () => {
    const { bridge } = await setup(); await db.fragments.add({ id: "zt-fragment", text: "ZT-82 M6 valve inspection idea requires review.", tagIds: [], pinned: false, createdAt: 1, updatedAt: 1 });
    const source = (await localEvidenceRepository.resolve("fragment:zt-fragment"))!;
    const artifact = await compileInvestigation(localEvidenceOutline([source], "ZT-82"), [source.key], "ZT-82", localEvidenceRepository);
    artifact.actions[0].findingIds = ["record-0"]; const preview = await previewInvestigationTask(artifact, artifact.actions[0].id, localEvidenceRepository);
    const commit = vi.spyOn(bridge, "commit"); const pause = delayNextRead(bridge); const pending = confirmInvestigationTask(preview); const failure = expect(pending).rejects.toThrow(/sources-invalid/); await pause.entered;
    await db.fragments.delete("zt-fragment"); pause.release(); await failure; expect(commit).not.toHaveBeenCalled();
  });
  it("an unquoted private input change revokes a public-citation task during preparation", async () => {
    const { artifact } = await setup(); const item = await savePrivateItem("note", "ZT-82 private commercial discussion, not technical proof.");
    const sources = await Promise.all([...artifact.inputSources.map(source => source.key), `private:${item.id}`].map(key => localEvidenceRepository.resolve(key)));
    const draft = await compileInvestigation(localEvidenceOutline(sources.slice(0, 2).map(source => source!), "ZT-82"), sources.map(source => source!.key), "ZT-82", localEvidenceRepository);
    draft.actions[0].findingIds = ["record-0"]; const preview = await previewInvestigationTask(draft, draft.actions[0].id, localEvidenceRepository);
    const bridge = window.chengjing!.secretaryVault!; const original = bridge.read; const pause = gate(); let reads = 0;
    // Initial validation reads the unquoted private input once. Pause the
    // transaction's next snapshot read, not that source-resolution read.
    vi.spyOn(bridge, "read").mockImplementation(async () => { if (++reads === 2) { pause.enter(); await pause.wait; } return original(); });
    const pending = confirmInvestigationTask(preview); const failure = expect(pending).rejects.toThrow("sources-invalidated"); await pause.entered;
    await secureVaultTransaction(data => { data.entries[`secretary-item:${item.id}`] = { ...item, plainText: "Changed private ZT-82 discussion", updatedAt: 2 }; });
    pause.release(); await failure; expect((await readSecureVault()).data.entries[`secretary-item:${preview.id}`]).toBeUndefined();
  });
  it("refuses export if an input changes while explicit consent is obtained", async () => {
    const { artifact } = await setup(); const save = vi.fn(async () => ({ canceled: false })); window.chengjing = { ...window.chengjing!, files: { save, open: vi.fn(async () => ({ canceled: true, files: [] })) } } as NonNullable<Window["chengjing"]>;
    vi.spyOn(window, "confirm").mockImplementation(() => { void db.cards.delete("zt-quality"); return true; });
    await expect(exportInvestigation(artifact, localEvidenceRepository, "en")).rejects.toThrow(/sources-invalid/);
    expect(save).not.toHaveBeenCalled();
  });
  it("keeps valid confirmation/deduplication working and releases invalidation subscriptions", async () => {
    const { bridge, preview } = await setup(); const pause = delayNextRead(bridge);
    const pending = confirmInvestigationTask(preview); await pause.entered; await db.cards.add(card("unrelated", "AB-12 on M2 unrelated evidence.")); pause.release();
    const task = await pending; await confirmInvestigationTask(preview);
    const entries = (await readSecureVault()).data.entries; expect(entries[`secretary-item:${task.id}`]).toBeDefined(); expect(entries[`secretary-task-evidence:${task.id}`]).toBeDefined();
    expect(Object.keys(entries).filter(key => key.startsWith("secretary-item:")).length).toBe(1);
  });
});
