const test = require("node:test"); const assert = require("node:assert/strict");
const crypto = require("node:crypto"); const fs = require("node:fs/promises"); const os = require("node:os"); const path = require("node:path");
const { createWindowsKeyAdapter, createSecretaryVault } = require("./secretary-vault.cjs");
function fakeOS() {
  const key = crypto.randomBytes(32);
  return { isEncryptionAvailable: () => true, encryptString(text) { const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv("aes-256-gcm", key, iv); const body = Buffer.concat([cipher.update(text), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), body]); }, decryptString(value) { const decipher = crypto.createDecipheriv("aes-256-gcm", key, value.subarray(0, 12)); decipher.setAuthTag(value.subarray(12, 28)); return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString(); } };
}
async function fixture(action) { const directory = await fs.mkdtemp(path.join(os.tmpdir(), "jenzo-vault-unit-")); const adapter = createWindowsKeyAdapter(fakeOS(), "win32"); try { await action(directory, adapter); } finally { await fs.rm(directory, { recursive: true, force: true }); } }
const data = text => ({ version: 2, entries: { "secretary-item:synthetic": { id: "synthetic", kind: "note", title: text, plainText: text, done: false, createdAt: 1, updatedAt: 1 } } });
test("unsupported/unavailable OS and plaintext-returning adapters never create a fallback key/vault", async () => {
  await fixture(async directory => {
    for (const adapter of [createWindowsKeyAdapter(fakeOS(), "linux"), createWindowsKeyAdapter({ ...fakeOS(), isEncryptionAvailable: () => false }, "win32"), createWindowsKeyAdapter({ isEncryptionAvailable: () => true, encryptString: text => Buffer.from(text), decryptString: value => value.toString() }, "win32")]) {
      const vault = createSecretaryVault(directory, adapter); await assert.rejects(vault.unlock()); assert.deepEqual(await fs.readdir(directory), []);
    }
  });
});
test("ciphertext contains neither body nor raw key, lock/restart require explicit unlock", async () => fixture(async (directory, adapter) => {
  const vault = createSecretaryVault(directory, adapter); await assert.rejects(vault.read(), /locked/); await vault.unlock();
  await vault.commit({ expectedRevision: 0, data: data("synthetic secret body") }); const backup = await vault.backup();
  assert.equal(backup.data.includes("synthetic secret body"), false); assert.equal(backup.data.includes("secretary-item"), false);
  assert.deepEqual(await fs.readdir(directory), ["secretary-v2.vault.json"]);
  await vault.lock(); await assert.rejects(vault.read(), /locked/);
  const restart = createSecretaryVault(directory, adapter); await assert.rejects(restart.read(), /locked/); await restart.unlock(); assert.deepEqual((await restart.read()).data, data("synthetic secret body"));
}));
test("copied vault without the original OS key cannot unlock; original encrypted bytes retained", async () => fixture(async (directory, adapter) => {
  const vault = createSecretaryVault(directory, adapter); await vault.unlock(); await vault.commit({ expectedRevision: 0, data: data("private synthetic") }); const original = (await vault.backup()).data;
  const wrongOS = createSecretaryVault(directory, createWindowsKeyAdapter(fakeOS(), "win32")); await assert.rejects(wrongOS.unlock()); assert.equal(await fs.readFile(path.join(directory, "secretary-v2.vault.json"), "utf8"), original);
}));
test("tampering/unsupported versions fail closed, including authenticated revision metadata", async () => fixture(async (directory, adapter) => {
  const vault = createSecretaryVault(directory, adapter); await vault.unlock(); const original = JSON.parse((await vault.backup()).data);
  for (const changes of [{ version: 99 }, { revision: 99 }, { tag: crypto.randomBytes(16).toString("base64") }]) await assert.rejects(vault.previewRestore(JSON.stringify({ ...original, ...changes })));
  assert.equal((await vault.read()).revision, 0);
}));
test("concurrent CAS writes cannot overwrite a committed operation", async () => fixture(async (directory, adapter) => {
  const vault = createSecretaryVault(directory, adapter); await vault.unlock();
  const results = await Promise.allSettled([vault.commit({ expectedRevision: 0, data: data("one") }), vault.commit({ expectedRevision: 0, data: data("two") })]); assert.equal(results.filter(value => value.status === "fulfilled").length, 1);
}));
test("restore preview/cancel is non-mutating; confirm saves encrypted rollback and can restore it", async () => fixture(async (directory, adapter) => {
  const vault = createSecretaryVault(directory, adapter); await vault.unlock(); await vault.commit({ expectedRevision: 0, data: data("before") }); const before = (await vault.backup()).data;
  await vault.commit({ expectedRevision: 1, data: data("after") }); const after = (await vault.backup()).data;
  const cancel = await vault.previewRestore(before); await vault.cancelRestore(cancel.token); assert.equal((await vault.backup()).data, after); await assert.rejects(vault.confirmRestore(cancel.token));
  const preview = await vault.previewRestore(before); const result = await vault.confirmRestore(preview.token); assert.deepEqual((await vault.read()).data, data("before"));
  const checkpoint = await fs.readFile(path.join(directory, `rollback-${result.rollbackId}.vault.json`), "utf8"); assert.equal(checkpoint, after); assert.equal(checkpoint.includes("after"), false);
  const rollback = await vault.previewRollback(result.rollbackId); await vault.confirmRestore(rollback.token); assert.deepEqual((await vault.read()).data, data("after"));
}));
test("changes invalidate previews; locking invalidates in-memory restore authority", async () => fixture(async (directory, adapter) => {
  const vault = createSecretaryVault(directory, adapter); await vault.unlock(); const preview = await vault.previewRestore((await vault.backup()).data);
  await vault.commit({ expectedRevision: 0, data: data("new") }); await assert.rejects(vault.confirmRestore(preview.token), /expired/);
  const second = await vault.previewRestore((await vault.backup()).data); await vault.lock(); await vault.unlock(); await assert.rejects(vault.confirmRestore(second.token), /expired/);
}));
test("loss of OS capability discards the unlocked session and never falls back", async () => fixture(async (directory, adapter) => {
  let available = true; const gated = { ...adapter, available: () => available }; const vault = createSecretaryVault(directory, gated); await vault.unlock();
  available = false; assert.equal(vault.status().state, "unsupported"); await assert.rejects(vault.read(), /unavailable/);
  available = true; assert.equal(vault.status().state, "locked"); await assert.rejects(vault.read(), /locked/);
}));
test("malformed body records fail before overwriting the encrypted original", async () => fixture(async (directory, adapter) => {
  const vault = createSecretaryVault(directory, adapter); await vault.unlock(); const original = (await vault.backup()).data;
  await assert.rejects(vault.commit({ expectedRevision: 0, data: { version: 2, entries: { "secretary-operation:bad": { title: "bad" } } } }), /invalid-reminder/);
  assert.equal((await vault.backup()).data, original);
}));
