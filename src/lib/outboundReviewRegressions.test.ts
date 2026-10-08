import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { db } from "../db";
import { communityApi } from "./community";
import { mockSecretaryVault } from "./secureSecretary.fixture";
import { lockSecureVault, savePrivateItem, unlockSecureVault } from "./secureSecretary";
import { exportSourceDocument, searchNoteSources, sourceContext } from "./sourceWorkbench";
import { pendingSyncPackets, stagePendingSync } from "./syncEngine";
import { runAI } from "./ai";
import { resolvePublicShareSource } from "./publicShareSource";
import type { CardRecord } from "../types";
import { buildBrainGraph } from "./brain";
import { useAppStore } from "../store";
import { validatePublicSourceContext } from "./publicSourceContext";

const identity = { id: "synthetic", displayName: "Synthetic", token: "synthetic-only", seal: "synthetic" };
const marker = "R7_SYNTHETIC_PRIVATE_DO_NOT_SEND";
const publicCard = (id = "public"): CardRecord => ({ id, title: "Public original", plainText: "Public original evidence", contentHtml: "", kind: "note", state: "active", createdAt: 1, updatedAt: 1, tagIds: [], favorite: false, color: "slate", attachmentIds: [], properties: {} });
beforeEach(async () => {
  localStorage.clear(); Object.defineProperty(crypto, "subtle", { configurable: true, value: webcrypto.subtle });
  await db.open(); await db.transaction("rw", db.tables, async () => { for (const table of db.tables) await table.clear(); });
});
afterEach(async () => { if (window.chengjing?.secretaryVault) await lockSecureVault(); window.chengjing = undefined; localStorage.clear(); vi.restoreAllMocks(); });
async function privateContext() {
  window.chengjing = { secretaryVault: mockSecretaryVault() } as NonNullable<Window["chengjing"]>;
  await unlockSecureVault(); await savePrivateItem("note", marker);
  return sourceContext(await searchNoteSources(marker, "en"), "local-gemma");
}
function mockHTTP() {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ item: { id: "synthetic-remote" }, updated: true }), { status: 200 }));
}

it("R7: reconstructed real vault context without share provenance cannot reach HTTP", async () => {
  const body = await privateContext(); expect(body).toContain(marker);
  const fetch = mockHTTP();
  // Exact review counterexample: runtime caller omits formerly optional metadata.
  await expect(Reflect.apply(communityApi.share, communityApi, [identity, { sourceType: "card", title: "Reconstructed", body, intention: "share" }])).rejects.toThrow("share-source-required");
  expect(fetch).not.toHaveBeenCalled();
});

it("R7: a claimed public key cannot authorize a substituted body, title, unknown or deleted source", async () => {
  const body = await privateContext(); await db.cards.put(publicCard()); const fetch = mockHTTP();
  const request = { sourceType: "card" as const, sourceKey: "card:public", title: "Public original", body, intention: "share" as const };
  await expect(communityApi.share(identity, request)).rejects.toThrow("share-source-changed");
  await expect(communityApi.share(identity, { ...request, title: marker, body: "Public original evidence" })).rejects.toThrow("share-source-changed");
  await expect(communityApi.share(identity, { ...request, sourceKey: "card:missing" })).rejects.toThrow("share-source-unavailable");
  await db.cards.update("public", { state: "trash" });
  await expect(communityApi.share(identity, request)).rejects.toThrow("share-source-unavailable");
  expect(fetch).not.toHaveBeenCalled();
});

it("R7: legitimate legacy publication and bound update use canonical public data; raw PATCH is denied", async () => {
  await db.cards.put(publicCard()); const fetch = mockHTTP();
  const source = await resolvePublicShareSource("card:public");
  await communityApi.share(identity, { sourceType: source.sourceType, sourceKey: source.key, title: source.title, body: source.body, intention: "share" });
  expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({ sourceType: "card", title: source.title, body: source.body, intention: "share" });
  await expect(Reflect.apply(communityApi.updateNeuron, communityApi, [identity, "synthetic-remote", { title: "Reconstructed", body: marker }])).rejects.toThrow("share-source-required");
  await expect(communityApi.updateNeuron(identity, "unbound", { sourceKey: source.key })).rejects.toThrow("share-source-unbound");
  await db.brainShares.put({ id: source.key, localType: "card", localId: "public", remoteId: "synthetic-remote", status: "shared", sharedAt: 1, updatedAt: 1 });
  await db.cards.update("public", { plainText: "Public edited evidence", updatedAt: 2 });
  await communityApi.updateNeuron(identity, "synthetic-remote", { sourceKey: source.key });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(JSON.parse(String(fetch.mock.calls[1][1]?.body)).body).toBe("Public edited evidence");
});

it("R7: all existing public graph types still publish exactly the displayed source", async () => {
  const language = useAppStore.getState().language;
  await db.cards.bulkPut([publicCard(), { ...publicCard("journal"), kind: "journal", journalDate: "2026-10-08", plainText: "Public journal body" }]);
  await db.boards.put({ id: "board", title: "Public board", description: "Public description", favorite: false, tagIds: [], createdAt: 1, updatedAt: 1 });
  await db.boardNodes.put({ id: "loose", boardId: "board", kind: "text", title: "Public loose text", x: 0, y: 0 });
  await db.fragments.put({ id: "fragment", text: "Public quick thought", pinned: false, tagIds: [], createdAt: 1, updatedAt: 1 });
  await db.tasks.put({ id: "task", title: "Public task", cardId: "public", done: false, dueAt: Date.UTC(2026, 9, 9), createdAt: 1, updatedAt: 1 });
  const graph = buildBrainGraph({ cards: await db.cards.toArray(), boards: await db.boards.toArray(), boardNodes: await db.boardNodes.toArray(), fragments: await db.fragments.toArray(), tasks: await db.tasks.toArray(), tags: [], storedEdges: [], language });
  const fetch = mockHTTP();
  for (const node of graph.nodes) await communityApi.share(identity, { sourceKey: node.key, sourceType: node.type, title: node.title, body: node.text.trim() || node.title, intention: "share" });
  expect(fetch).toHaveBeenCalledTimes(5);
});

it("R7: trusted source parsing rejects retained private and unknown declarations in legacy data", async () => {
  await db.table("cards").put({ ...publicCard(), properties: { sources: [{ key: "private:synthetic" }] } });
  await expect(resolvePublicShareSource("card:public")).rejects.toThrow("private-outbound-denied:share");
  await db.table("cards").put({ ...publicCard(), properties: { sources: [] } });
  await expect(resolvePublicShareSource("card:public")).rejects.toThrow("outbound-provenance-invalid:share");
});

it("R7: public-table sync operations retain and enforce nested private/unknown provenance", async () => {
  await privateContext();
  for (const extra of [
    { private: true },
    { sources: [{ type: "private", key: "private:synthetic" }] },
    { private: false, properties: { retained: { sources: [{ key: "private:synthetic" }] } } },
    { sources: [] }, { sources: [{}] }, { sources: undefined },
  ]) {
    await db.table("syncOutbox").clear();
    await db.table("syncOutbox").put({ id: "synthetic-operation", table: "cards", key: "public", clock: { synthetic: 1 }, value: { ...publicCard(), plainText: marker, ...extra } });
    await expect(pendingSyncPackets().next()).rejects.toThrow(/private-outbound-denied:sync|outbound-provenance-invalid:sync/);
    localStorage.setItem("chengjing-sync-enabled", "true");
    const stage = vi.fn();
    await expect(stagePendingSync({ stage, list: async () => [], get: async () => "", put: async () => {} })).rejects.toThrow(/private-outbound-denied:sync|outbound-provenance-invalid:sync/);
    expect(stage).not.toHaveBeenCalled();
    expect(await db.table("syncOutbox").count()).toBe(1);
  }
});

it("R7: normal public journal publication still produces a sync packet", async () => {
  localStorage.setItem("chengjing-sync-enabled", "true");
  await db.cards.put(publicCard());
  const { value } = await pendingSyncPackets().next();
  expect(value.operations[0].value.plainText).toBe("Public original evidence");
});

it("R7: serialized vault context cannot bypass remote AI refusal by omitting options.sources", async () => {
  const context = await privateContext(); const send = vi.fn();
  window.chengjing!.ai = { openRouterChat: send, providerChat: send } as unknown as NonNullable<Window["chengjing"]>["ai"];
  await expect(runAI({ engine: "openrouter", model: "synthetic", prompt: "compose", context })).rejects.toThrow("private-outbound-denied:remote-ai");
  await expect(runAI({ engine: "openrouter", model: "synthetic", prompt: "compose", context, sources: [] })).rejects.toThrow("private-outbound-denied:remote-ai");
  expect(send).not.toHaveBeenCalled();
});

it("R7: structured AI source context needs existing matching public authority, not caller labels", async () => {
  await db.cards.put(publicCard());
  const source = { key: "card:public", title: "Public original", excerpt: "Public original evidence" };
  await expect(validatePublicSourceContext([source])).resolves.toBeUndefined();
  await expect(validatePublicSourceContext([{ ...source, excerpt: marker }])).rejects.toThrow("outbound-source-changed:remote-ai");
  await expect(validatePublicSourceContext([{ ...source, key: "card:missing" }])).rejects.toThrow("outbound-source-unavailable:remote-ai");
  for (const context of ["[]", "[{}]", "[{invalid}"]) await expect(runAI({ engine: "openrouter", model: "synthetic", prompt: "compose", context })).rejects.toThrow("outbound-provenance-invalid:remote-ai");
});

it("R8: old false flag, missing metadata and invalid language cannot skip one-time consent", async () => {
  const save = vi.fn(async () => ({ canceled: false }));
  window.chengjing = { files: { save } } as unknown as NonNullable<Window["chengjing"]>;
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  expect(await Reflect.apply(exportSourceDocument, undefined, [marker, false, "en"])).toEqual({ canceled: true });
  expect(await exportSourceDocument(marker)).toEqual({ canceled: true });
  expect(await Reflect.apply(exportSourceDocument, undefined, [marker, { private: false }])).toEqual({ canceled: true });
  expect(confirm).toHaveBeenCalledTimes(3); expect(save).not.toHaveBeenCalled();
  confirm.mockReturnValue(true); await exportSourceDocument(marker, "en"); expect(save).toHaveBeenCalledOnce();
  confirm.mockReturnValue(false); await exportSourceDocument(marker, "en"); expect(save).toHaveBeenCalledOnce();
});
