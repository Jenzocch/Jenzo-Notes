import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { db } from "../db";
import { requireAISources, requirePublicSources } from "./privateOutbound";
import { runAI, buildSpaceContext } from "./ai";
import { sourceContext, searchNoteSources, exportSourceDocument, type NoteSource } from "./sourceWorkbench";
import { mockSecretaryVault } from "./secureSecretary.fixture";
import { savePrivateItem, unlockSecureVault, lockSecureVault } from "./secureSecretary";
import { handleMcpWorkspaceRequest } from "./mcpWorkspace";
import { pendingSyncPackets } from "./syncEngine";
import { communityApi } from "./community";

const source: NoteSource = { key: "private:synthetic", type: "private", id: "synthetic", title: "Private", excerpt: "PRIVATE_BODY_DO_NOT_SEND", updatedAt: 1, matched: [] };
beforeEach(async () => { await db.open(); await db.transaction("rw", db.tables, async () => { for (const table of db.tables) await table.clear(); }); });
afterEach(async () => { if (window.chengjing?.secretaryVault) await lockSecureVault(); window.chengjing = undefined; vi.restoreAllMocks(); });

it("rejects mixed private provenance independently of any budget/provider setting", async () => {
  const mixed = [{ key: "card:public", type: "card" }, source];
  for (const destination of ["mcp", "sync", "share", "remote-ai"] as const) expect(() => requirePublicSources(destination, mixed)).toThrow(`private-outbound-denied:${destination}`);
  expect(() => requirePublicSources("mcp", [{ key: "private:synthetic", type: "card", private: false }])).toThrow();
  for (const engine of ["openrouter", "custom-provider", "ollama", "unknown"]) expect(() => requireAISources(engine, mixed)).toThrow("private-outbound-denied:remote-ai");
  expect(() => requireAISources("local-gemma", mixed)).not.toThrow();
  expect(() => sourceContext([source])).toThrow("private-outbound-denied:remote-ai");
  expect(sourceContext([source], "local-gemma")).toContain(source.excerpt);
  const send = vi.fn(); window.chengjing = { ai: { openRouterChat: send, providerChat: send } } as unknown as NonNullable<Window["chengjing"]>;
  await expect(runAI({ engine: "openrouter", model: "mock", prompt: "compose", sources: mixed, context: source.excerpt })).rejects.toThrow("private-outbound-denied:remote-ai");
  expect(send).not.toHaveBeenCalled();
});

it("legacy string chat retrieval never reads private vault contents while local workbench can", async () => {
  window.chengjing = { secretaryVault: mockSecretaryVault() } as NonNullable<Window["chengjing"]>;
  await unlockSecureVault(); await savePrivateItem("note", source.excerpt);
  expect((await searchNoteSources("PRIVATE_BODY", "en")).some(item => item.type === "private")).toBe(true);
  const read = vi.spyOn(window.chengjing.secretaryVault!, "read"); read.mockClear();
  expect(await buildSpaceContext("PRIVATE_BODY")).not.toContain(source.excerpt);
  expect(read).not.toHaveBeenCalled();
  await expect(handleMcpWorkspaceRequest({ requestId: "mock", tool: "chengjing_get_item", arguments: { type: "private", id: "synthetic" } })).rejects.toThrow("private-outbound-denied:mcp");
  await expect(handleMcpWorkspaceRequest({ requestId: "mock", tool: "chengjing_search", arguments: { query: "PRIVATE_BODY", types: ["note", "private"] } })).rejects.toThrow("private-outbound-denied:mcp");
  const result = await handleMcpWorkspaceRequest({ requestId: "mock", tool: "chengjing_search", arguments: { query: "PRIVATE_BODY" } });
  expect(JSON.stringify(result)).not.toContain(source.excerpt);
  const packets = []; for await (const packet of pendingSyncPackets()) packets.push(packet);
  expect(JSON.stringify(packets)).not.toContain(source.excerpt);
});

it("refuses explicit private sync operations before producing a transport packet", async () => {
  await db.table("syncOutbox").put({ id: "synthetic-op", table: "cards", key: "private:synthetic", clock: { mock: 1 }, value: { plainText: source.excerpt } });
  await expect(pendingSyncPackets().next()).rejects.toThrow("private-outbound-denied:sync");
  expect(await db.table("syncOutbox").count()).toBe(1);
});

it("sharing refuses private provenance before any HTTP or identity use", async () => {
  const fetch = vi.spyOn(globalThis, "fetch");
  await expect(communityApi.share({ id: "mock", displayName: "Mock", token: "mock-only", seal: "mock" }, { sourceType: "card", sourceKey: source.key, title: source.title, body: source.excerpt, intention: "share" })).rejects.toThrow("private-outbound-denied:share");
  expect(fetch).not.toHaveBeenCalled();
});

it("plaintext export cancellation writes nothing; consent remains one-time and cannot change remote policy", async () => {
  const save = vi.fn(async () => ({ canceled: false }));
  window.chengjing = { files: { save } } as unknown as NonNullable<Window["chengjing"]>;
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  expect(await exportSourceDocument(source.excerpt)).toEqual({ canceled: true }); expect(save).not.toHaveBeenCalled();
  confirm.mockReturnValue(true); await exportSourceDocument(source.excerpt); expect(save).toHaveBeenCalledOnce();
  expect(() => requireAISources("openrouter", [source])).toThrow("private-outbound-denied:remote-ai");
  confirm.mockReturnValue(false); await exportSourceDocument(source.excerpt); expect(save).toHaveBeenCalledOnce();
});
