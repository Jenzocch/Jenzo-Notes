// Standalone Electron process: no app main, no browser, no real profile/credentials.
const { app, safeStorage, BrowserWindow, ipcMain } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const { registerSecretaryVaultIPC } = require("../electron/secretary-ipc.cjs");
const { createSecretaryVault, createWindowsKeyAdapter } = require("../electron/secretary-vault.cjs");
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-background-networking");
app.on("window-all-closed", () => {}); // Wait for the report; no hidden auto-quit race.
const deadline = setTimeout(() => { console.error("Synthetic OS vault runtime timed out"); app.exit(1); }, 20000);
(async () => {
  const existing = process.argv.find(value => value.startsWith("--reopen-synthetic="))?.slice("--reopen-synthetic=".length);
  const directory = existing ? path.resolve(existing) : await fs.mkdtemp(path.join(os.tmpdir(), "jenzo-os-vault-synthetic-"));
  if (existing) { assert.equal(path.dirname(directory).toLowerCase(), path.resolve(os.tmpdir()).toLowerCase()); assert.match(path.basename(directory), /^jenzo-os-vault-synthetic-[\w-]+$/); assert.equal(await fs.readFile(path.join(directory, "synthetic-marker.txt"), "utf8"), "JENZO_SYNTHETIC_VAULT_QA_ONLY"); }
  else await fs.writeFile(path.join(directory, "synthetic-marker.txt"), "JENZO_SYNTHETIC_VAULT_QA_ONLY");
  app.setPath("userData", directory);
  app.setAppLogsPath(path.join(directory, "logs"));
  await app.whenReady();
  const adapter = createWindowsKeyAdapter(safeStorage);
  assert.equal(process.platform, "win32"); assert.equal(adapter.available(), true);
  if (existing) {
    const reopened = createSecretaryVault(path.join(directory, "vault"), adapter); assert.equal(reopened.status().state, "locked"); await reopened.unlock();
    assert.equal((await reopened.read()).data.entries["secretary-item:synthetic"].plainText, "OS-VAULT-SYNTHETIC-NOT-A-REAL-SECRET"); await reopened.lock();
    const output = path.resolve("qa-artifacts/security/os-vault-report.json"); const report = JSON.parse(await fs.readFile(output, "utf8")); assert.equal(report.profile, directory); report.nativeProcessRestartRoundTrip = true; await fs.writeFile(output, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report)); clearTimeout(deadline); app.exit(0); return;
  }
  const store = createSecretaryVault(path.join(directory, "vault"), adapter);
  assert.equal(store.status().state, "locked"); await store.unlock();
  const initial = await store.read();
  const synthetic = "OS-VAULT-SYNTHETIC-NOT-A-REAL-SECRET";
  await store.commit({ expectedRevision: initial.revision, data: { version: 2, entries: { "secretary-item:synthetic": { id: "synthetic", kind: "note", title: synthetic, plainText: synthetic, done: false, createdAt: 1, updatedAt: 1 } } } });
  const backup = await store.backup(); const envelope = JSON.parse(backup.data);
  const wrappedKey = Buffer.from(envelope.wrappedKey, "base64"); const key = safeStorage.decryptString(wrappedKey);
  assert.equal(backup.data.includes(synthetic), false); assert.equal(backup.data.includes(key), false);
  assert.notEqual(wrappedKey.toString("utf8"), key);
  await store.lock(); await assert.rejects(store.read(), /locked/);
  const reopened = createSecretaryVault(path.join(directory, "vault"), adapter);
  assert.equal(reopened.status().state, "locked"); await reopened.unlock();
  assert.equal((await reopened.read()).data.entries["secretary-item:synthetic"].plainText, synthetic);
  await reopened.lock();
  const names = await fs.readdir(path.join(directory, "vault")); assert.deepEqual(names, ["secretary-v2.vault.json"]);
  const html = path.join(directory, "ipc-fixture.html"); await fs.writeFile(html, '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'"><title>Synthetic IPC fixture</title>');
  const options = { show: false, webPreferences: { preload: path.resolve("electron/preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false } };
  const main = new BrowserWindow(options); registerSecretaryVaultIPC(ipcMain, () => main, () => reopened, () => pathToFileURL(html).href);
  await main.loadFile(html); assert.equal(await main.webContents.executeJavaScript("window.chengjing.secretaryVault.status().then(s=>s.state)"), "locked");
  await main.webContents.executeJavaScript("window.chengjing.secretaryVault.unlock()");
  assert.equal(await main.webContents.executeJavaScript("window.chengjing.secretaryVault.read().then(s=>Boolean(s.data.entries['secretary-item:synthetic']))"), true);
  const foreign = new BrowserWindow(options); await foreign.loadFile(html);
  assert.equal(await foreign.webContents.executeJavaScript("window.chengjing.secretaryVault.read().then(()=>false,e=>e.message.includes('vault-untrusted-sender'))"), true);
  foreign.destroy(); await main.webContents.executeJavaScript("window.chengjing.secretaryVault.lock()"); main.destroy();
  const report = { platform: process.platform, electron: process.versions.electron, osProtectionAvailable: true, protection: "windows-dpapi+aes-256-gcm", encryptedBody: true, noRawKeyFile: true, explicitUnlock: true, serviceReopenRoundTrip: true, realPreloadIPC: true, foreignWindowRejected: true, syntheticOnly: true, profile: directory };
  const output = path.resolve("qa-artifacts/security/os-vault-report.json"); await fs.mkdir(path.dirname(output), { recursive: true }); await fs.writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report)); clearTimeout(deadline); app.exit(0);
})().catch(error => { console.error(error.message); app.exit(1); });
