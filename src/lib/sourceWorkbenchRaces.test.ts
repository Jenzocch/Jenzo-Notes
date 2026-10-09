import "fake-indexeddb/auto";
import { Blob as NodeBlob } from "node:buffer";
import { webcrypto } from "node:crypto";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { db } from "../db";
import { collectImage, readImageIdea, reviseImage } from "./imageIdeas";
import { exportSourceDocument, noteSourceOperation, searchNoteSources } from "./sourceWorkbench";
import { lockSecureVault, readSecureVault, savePrivateItem, secureVaultTransaction, unlockSecureVault } from "./secureSecretary";
import { mockSecretaryVault } from "./secureSecretary.fixture";
beforeAll(() => Object.defineProperty(crypto, "subtle", { configurable: true, value: webcrypto.subtle }));
afterEach(async () => { vi.restoreAllMocks(); if (window.chengjing?.secretaryVault) await lockSecureVault(); window.chengjing = undefined; await db.cards.clear(); await db.attachments.clear(); });
async function setup() {
  const { card } = await collectImage("synthetic.png", new NodeBlob(["original"], { type: "image/png" }) as unknown as Blob, { annotation: "ZT-82 reason", sourceUrl: "", sourceDate: "", rawText: "ZT-82 original unverified claim", correctedText: "ZT-82 original unverified claim", reviewed: true, engine: "manual", language: "" });
  const sources = await searchNoteSources("ZT-82", "en", 24, false); const bridge = mockSecretaryVault();
  const save = vi.fn(async (_request: { data: string }) => ({ canceled: false }));
  window.chengjing = { secretaryVault: bridge, files: { save } } as unknown as NonNullable<Window["chengjing"]>; await unlockSecureVault();
  return { card, sources, bridge, save };
}
it.each(["delete", "correct", "delete-restore"])("R11: refuses export if %s occurs during plaintext consent", async mode => {
  const { card, sources, save } = await setup(); const guard = noteSourceOperation(sources);
  let changed: Promise<unknown> = Promise.resolve();
  vi.spyOn(window, "confirm").mockImplementation(() => {
    changed = (async () => {
      const attachment = (await db.attachments.get(readImageIdea(card)!.attachmentId))!;
      if (mode === "correct") await reviseImage(card, { annotation: "ZT-82 reason", sourceUrl: "", sourceDate: "", correctedText: "ZT-82 corrected original claim", reviewed: true });
      else { await db.attachments.delete(attachment.id); if (mode === "delete-restore") await db.attachments.put(attachment); }
    })(); return true;
  });
  // Simulate consent's awaited boundary explicitly: final source verification
  // must wait for the source mutation, not just the earlier UI check.
  const revalidate = guard.revalidate.bind(guard); const consentGuard = { assertCurrent: guard.assertCurrent, revalidate: async () => { await changed; await revalidate(); } };
  try { await expect(exportSourceDocument(sources[0].excerpt, "en", consentGuard)).rejects.toThrow("invalidated"); expect(save).not.toHaveBeenCalled(); }
  finally { guard.dispose(); }
});
it.each(["note", "draft"])("R11: refuses %s persistence when original is deleted/restored during vault read", async kind => {
  const { card, sources, bridge } = await setup(); const guard = noteSourceOperation(sources);
  let enter!: () => void; let release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; }); const wait = new Promise<void>(resolve => { release = resolve; });
  const read = bridge.read; vi.spyOn(bridge, "read").mockImplementationOnce(async () => { enter(); await wait; return read(); }); const commit = vi.spyOn(bridge, "commit");
  const pending = kind === "note" ? savePrivateItem("note", sources[0].excerpt, crypto.randomUUID(), guard) : secureVaultTransaction(data => { data.entries["source-draft-v2"] = { sources }; }, guard);
  const failure = expect(pending).rejects.toThrow("invalidated");
  try { await entered; const attachment = (await db.attachments.get(readImageIdea(card)!.attachmentId))!; await db.attachments.delete(attachment.id); await db.attachments.put(attachment); release(); await failure; expect(commit).not.toHaveBeenCalled(); }
  finally { release(); guard.dispose(); }
});
it("R11: rechecks corrected sources on vault CAS retry", async () => {
  const { card, sources, bridge } = await setup(); const guard = noteSourceOperation(sources); const commit = bridge.commit;
  const commits = vi.spyOn(bridge, "commit").mockImplementationOnce(async () => { await db.cards.update(card.id, { plainText: "changed while committing" }); throw new Error("vault-revision-conflict"); }).mockImplementation(commit);
  try { await expect(savePrivateItem("note", sources[0].excerpt, crypto.randomUUID(), guard)).rejects.toThrow("invalidated"); expect(commits).toHaveBeenCalledTimes(1); expect((await readSecureVault()).data.entries).toEqual({}); }
  finally { guard.dispose(); }
});
it("R11: unchanged sources still export, and cancelled consent never dispatches", async () => {
  const { sources, save } = await setup(); const guard = noteSourceOperation(sources);
  try { vi.spyOn(window, "confirm").mockReturnValue(false); expect((await exportSourceDocument(sources[0].excerpt, "zh-TW", guard)).canceled).toBe(true); expect(save).not.toHaveBeenCalled(); vi.mocked(window.confirm).mockReturnValue(true); await exportSourceDocument(sources[0].excerpt, "zh-TW", guard); expect(save).toHaveBeenCalledOnce(); }
  finally { guard.dispose(); }
});
