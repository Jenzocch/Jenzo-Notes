import "fake-indexeddb/auto";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { db } from "../db";
import { communityApi } from "./community";
import { validatePublicSourceContext } from "./publicSourceContext";
import { stagePendingSync } from "./syncEngine";
import { requirePublicRecord } from "./privateOutbound";
const identity = { id: "synthetic", displayName: "Synthetic", token: "mock-only", seal: "mock" };
const card = { id: "public", title: "Public record", plainText: "Public original evidence", contentHtml: "", kind: "note", state: "active", createdAt: 1, updatedAt: 1, tagIds: [], favorite: false, color: "slate", attachmentIds: [] };
beforeEach(async () => { localStorage.clear(); Object.defineProperty(crypto, "subtle", { configurable: true, value: webcrypto.subtle }); await db.open(); await db.transaction("rw", db.tables, async () => { for (const table of db.tables) await table.clear(); }); });
afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
const transport = () => ({ stage: vi.fn(async (_packet: unknown) => {}), list: async () => [], get: async () => "", put: async () => {} });
it("R9: ordinary custom sources text/arrays and arbitrary property names preserve public share/context/sync", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ item: { id: "synthetic" } }), { status: 200 }));
  localStorage.setItem("chengjing-sync-enabled", "true");
  for (const sources of ["https://example.invalid/public-reference", ["reference A", "reference B"]]) {
    await db.table("cards").put({ ...card, properties: { sources, private: "a custom label", type: "private", secretaryProvenance: "ordinary user text", another: "arbitrary property" } });
    await communityApi.share(identity, { sourceKey: "card:public", sourceType: "card", title: card.title, body: card.plainText, intention: "share" });
    await expect(validatePublicSourceContext([{ key: "card:public", title: card.title, excerpt: card.plainText }])).resolves.toBeUndefined();
    const output = transport(); await stagePendingSync(output); expect(output.stage).toHaveBeenCalledOnce();
  }
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("R9: old queued custom-property publication remains publishable after editing current properties", async () => {
  localStorage.setItem("chengjing-sync-enabled", "true");
  await db.table("cards").put({ ...card, properties: { sources: "original public reference" } });
  const old = await db.table("syncOutbox").toArray(); expect(old).toHaveLength(1);
  await db.table("cards").put({ ...card, updatedAt: 2, properties: {} });
  expect(await db.table("syncOutbox").count()).toBe(2);
  const output = transport(); await stagePendingSync(output);
  expect(output.stage).toHaveBeenCalledOnce();
  const packet = output.stage.mock.calls[0][0] as unknown as { operations: Array<{ id: string; value: { properties: unknown } }> };
  expect(packet.operations.find(op => op.id === old[0].id)?.value.properties).toEqual({ sources: "original public reference" });
  expect(await db.table("syncOutbox").count()).toBe(2); // No history deletion or rewrite.
});
it("R9: genuine direct/namespaced private and malformed provenance still fail before transport", async () => {
  localStorage.setItem("chengjing-sync-enabled", "true");
  for (const marker of [
    { private: true }, { sources: [{ key: "private:synthetic" }] },
    { secretaryProvenance: { version: 1, sources: [{ key: "private:synthetic" }] } },
    { secretaryProvenance: { version: 1, sources: [{ key: "card:public" }], properties: { retained: { sources: [{ key: "private:synthetic" }] } } } },
    { secretaryProvenance: null }, { secretaryProvenance: { version: 9, sources: [{ key: "card:public" }] } },
    { secretaryProvenance: { version: 1, sources: [] } },
  ]) {
    const record = { ...card, properties: { sources: "legal custom property" }, ...marker };
    expect(() => requirePublicRecord("share", record)).toThrow(/private-outbound-denied|outbound-provenance-invalid/);
    await db.table("syncOutbox").clear(); // Synthetic test queue only.
    await db.table("syncOutbox").put({ id: "synthetic-op", table: "cards", key: "public", clock: { synthetic: 1 }, value: record });
    const output = transport(); await expect(stagePendingSync(output)).rejects.toThrow(/private-outbound-denied|outbound-provenance-invalid/);
    expect(output.stage).not.toHaveBeenCalled(); expect(await db.table("syncOutbox").count()).toBe(1);
  }
});
