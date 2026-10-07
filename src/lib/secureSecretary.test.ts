import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { listPrivateItems, lockSecureVault, readSecureVault, savePrivateItem, secureVaultTransaction, unlockSecureVault } from "./secureSecretary";
import { mockSecretaryVault } from "./secureSecretary.fixture";
afterEach(async () => { if (window.chengjing?.secretaryVault) await lockSecureVault(); window.chengjing = undefined; });
describe("secure secretary persistence boundary", () => {
  it("unsupported browser/Android and locked vault never fall back to plaintext stores", async () => {
    window.chengjing = undefined;
    await expect(savePrivateItem("note", "synthetic private body")).rejects.toThrow(/unsupported/);
    window.chengjing = { platform: "android" } as NonNullable<Window["chengjing"]>;
    await expect(savePrivateItem("task", "synthetic private body")).rejects.toThrow(/unsupported/);
    window.chengjing = { secretaryVault: mockSecretaryVault() } as NonNullable<Window["chengjing"]>;
    await expect(savePrivateItem("note", "synthetic private body")).rejects.toThrow(/locked/);
    expect(await db.cards.count()).toBe(0); expect(await db.tasks.count()).toBe(0); expect(await db.preferences.count()).toBe(0);
  });
  it("stores notes/drafts only at the native vault boundary and deduplicates conflicting concurrent writes", async () => {
    window.chengjing = { secretaryVault: mockSecretaryVault() } as NonNullable<Window["chengjing"]>; await unlockSecureVault();
    const id = crypto.randomUUID();
    await Promise.all([savePrivateItem("note", "synthetic body", id), savePrivateItem("note", "synthetic body", id)]);
    await secureVaultTransaction(data => { data.entries["source-draft-v2"] = { version: 2, goal: "private goal", draft: "private draft", sources: [] }; });
    expect(await listPrivateItems()).toHaveLength(1);
    expect((await readSecureVault()).data.entries["source-draft-v2"]).toMatchObject({ draft: "private draft" });
    expect(await db.cards.count()).toBe(0); expect(await db.fragments.count()).toBe(0); expect(localStorage.getItem("chengjing-source-draft-v1")).toBeNull();
    await lockSecureVault(); await expect(readSecureVault()).rejects.toThrow(/locked/);
  });
});
