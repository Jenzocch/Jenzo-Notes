const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { clearSecret, readSecret, secretStatus, vaultPaths, writeSecret } = require("./key-vault.cjs");

test("AES-GCM 金鑰保存不含明碼且可跨次讀回", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "chengjing-vault-test-"));
  const value = "test-openrouter-local-vault-secret";
  try {
    await writeSecret(directory, value);
    assert.equal(await readSecret(directory), value);
    const paths = vaultPaths(directory);
    const raw = await fs.readFile(paths.secret, "utf8");
    assert.equal(raw.includes(value), false);
    assert.deepEqual(await secretStatus(directory), { configured: true, encrypted: true, storage: "app-local-aes-256-gcm" });
    await clearSecret(directory);
    assert.equal(await readSecret(directory), "");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("POSIX vault files restrict group/other access (not a Windows ACL assertion)", { skip: process.platform === "win32" ? "NTFS access uses ACLs; Node mode bits do not prove isolation" : false }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "chengjing-vault-mode-test-"));
  try {
    await writeSecret(directory, "synthetic-mode-test");
    const paths = vaultPaths(directory);
    assert.equal((await fs.stat(paths.secret)).mode & 0o777, 0o600);
    assert.equal((await fs.stat(paths.masterKey)).mode & 0o777, 0o600);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("AES-GCM rejects tampered ciphertext without returning plaintext", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "chengjing-vault-integrity-test-"));
  try {
    await writeSecret(directory, "synthetic-integrity-test");
    const paths = vaultPaths(directory);
    const payload = JSON.parse(await fs.readFile(paths.secret, "utf8"));
    const ciphertext = Buffer.from(payload.ciphertext, "base64");
    ciphertext[0] ^= 1;
    payload.ciphertext = ciphertext.toString("base64");
    await fs.writeFile(paths.secret, JSON.stringify(payload));
    await assert.rejects(readSecret(directory));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("documented boundary: copying both vault and adjacent master key allows recovery", async () => {
  const source = await fs.mkdtemp(path.join(os.tmpdir(), "chengjing-vault-source-test-"));
  const copy = await fs.mkdtemp(path.join(os.tmpdir(), "chengjing-vault-copy-test-"));
  try {
    await writeSecret(source, "synthetic-portable-secret");
    const originalPaths = vaultPaths(source); const copiedPaths = vaultPaths(copy);
    await fs.copyFile(originalPaths.secret, copiedPaths.secret);
    await fs.copyFile(originalPaths.masterKey, copiedPaths.masterKey);
    assert.equal(await readSecret(copy), "synthetic-portable-secret");
  } finally {
    await fs.rm(source, { recursive: true, force: true });
    await fs.rm(copy, { recursive: true, force: true });
  }
});
