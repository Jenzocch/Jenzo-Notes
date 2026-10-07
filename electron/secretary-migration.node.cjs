const test = require("node:test"); const assert = require("node:assert/strict"); const crypto = require("node:crypto");
const fs = require("node:fs/promises"); const os = require("node:os"); const path = require("node:path");
const { createSecretaryVault } = require("./secretary-vault.cjs");
const { previewSyntheticMigration, cancelSyntheticMigration, confirmSyntheticMigration } = require("./secretary-migration.cjs");
function mockAdapter() {
  const osKey = crypto.randomBytes(32);
  return { available: () => true, wrap(key) { const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv("aes-256-gcm", osKey, iv); return Buffer.concat([iv, cipher.update(key), cipher.final(), cipher.getAuthTag()]); }, unwrap(value) { const decipher = crypto.createDecipheriv("aes-256-gcm", osKey, value.subarray(0, 12)); decipher.setAuthTag(value.subarray(value.length - 16)); return Buffer.concat([decipher.update(value.subarray(12, -16)), decipher.final()]); } };
}
const legacy = () => ({ format: "chengjing-secretary-legacy", version: 1, synthetic: true, items: [{ id: "synthetic-legacy-note", kind: "note", title: "legacy private title", plainText: "legacy synthetic private body", createdAt: 1, updatedAt: 1 }], operations: [{ id: "synthetic-legacy-op", title: "old reminder", nextDueAt: 1 }], draft: { version: 1, goal: "legacy goal", draft: "legacy draft", sources: [] } });
async function fixture(action) { const directory = await fs.mkdtemp(path.join(os.tmpdir(), "jenzo-migration-unit-")); const vault = createSecretaryVault(path.join(directory, "new-vault"), mockAdapter()); try { await vault.unlock(); await action(directory, vault); } finally { await vault.lock(); await fs.rm(directory, { recursive: true, force: true }); } }
test("synthetic v1 preview/cancel writes nothing and retains the original source", async () => fixture(async (_directory, vault) => {
  const source = legacy(); const original = JSON.stringify(source); const encrypted = (await vault.backup()).data;
  const preview = await previewSyntheticMigration(vault, source); assert.equal(preview.itemCount, 1); assert.equal(preview.requiresManualReminderReconfirmation, true);
  assert.equal((await vault.backup()).data, encrypted); cancelSyntheticMigration(preview);
  await assert.rejects(confirmSyntheticMigration(vault, preview, source, true), /fresh/); assert.equal(JSON.stringify(source), original); assert.equal((await vault.backup()).data, encrypted);
}));
test("explicit migration backs up first, stores originals encrypted and rollback restores prior target", async () => fixture(async (directory, vault) => {
  const source = legacy(); const original = JSON.stringify(source); const preview = await previewSyntheticMigration(vault, source);
  await assert.rejects(confirmSyntheticMigration(vault, preview, source, false), /explicit/);
  const result = await confirmSyntheticMigration(vault, preview, source, true);
  const snapshot = await vault.read(); assert.equal(snapshot.data.entries["source-draft-v2"].version, 2);
  assert.equal(snapshot.data.entries["secretary-legacy-operation:synthetic-legacy-op"].status, "needs-manual-reconfirmation");
  assert.deepEqual(snapshot.data.entries["migration-source-v1"].source, source); assert.equal(JSON.stringify(source), original);
  const encrypted = (await vault.backup()).data; assert.equal(encrypted.includes("legacy synthetic private body"), false); assert.equal(encrypted.includes("legacy draft"), false);
  const checkpoint = await fs.readFile(path.join(directory, "new-vault", `rollback-${result.rollbackId}.vault.json`), "utf8"); assert.equal(checkpoint.includes("legacy"), false);
  const rollback = await vault.previewRollback(result.rollbackId); await vault.confirmRestore(rollback.token); assert.deepEqual((await vault.read()).data.entries, {}); assert.equal(JSON.stringify(source), original);
}));
test("missing backup, changed source/target, unsupported version and non-synthetic inputs fail closed", async () => fixture(async (_directory, vault) => {
  const source = legacy(); const preview = await previewSyntheticMigration(vault, source); const original = (await vault.backup()).data;
  await assert.rejects(confirmSyntheticMigration({ read: vault.read, checkpoint: async () => { throw new Error("backup-failed"); }, commit: () => assert.fail("No writes without backup") }, preview, source, true), /backup-failed/);
  assert.equal((await vault.backup()).data, original);
  await assert.rejects(confirmSyntheticMigration(vault, preview, { ...source, draft: { ...source.draft, draft: "changed" } }, true), /fresh/);
  await vault.commit({ expectedRevision: 0, data: { version: 2, entries: {} } }); await assert.rejects(confirmSyntheticMigration(vault, preview, source, true), /target-changed/);
  await assert.rejects(previewSyntheticMigration(vault, { ...source, version: 99 }), /synthetic/); await assert.rejects(previewSyntheticMigration(vault, { ...source, synthetic: false }), /synthetic/);
}));
