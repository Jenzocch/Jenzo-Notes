function trustedAppUrl(value, expected) {
  try { const actual = new URL(value); const target = new URL(expected); return actual.protocol === target.protocol && actual.host === target.host && actual.pathname === target.pathname && !actual.username && !actual.password; } catch { return false; }
}
function assertSecretarySender(event, mainWindow, expectedUrl) {
  if (!mainWindow || event.sender !== mainWindow.webContents || !event.senderFrame || event.senderFrame !== event.sender.mainFrame) throw new Error("vault-untrusted-sender");
  if (!trustedAppUrl(event.senderFrame.url, expectedUrl)) throw new Error("vault-untrusted-origin");
}
function registerSecretaryVaultIPC(ipcMain, getMainWindow, getVault, getExpectedUrl) {
  for (const [channel, method] of Object.entries({ status: "status", unlock: "unlock", lock: "lock", read: "read", commit: "commit", backup: "backup", "preview-restore": "previewRestore", "cancel-restore": "cancelRestore", "confirm-restore": "confirmRestore", "preview-rollback": "previewRollback" })) {
    ipcMain.handle(`secretary-vault:${channel}`, async (event, request) => { assertSecretarySender(event, getMainWindow(), getExpectedUrl()); return getVault()[method](request); });
  }
}
module.exports = { trustedAppUrl, assertSecretarySender, registerSecretaryVaultIPC };
