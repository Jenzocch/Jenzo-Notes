const test = require("node:test"); const assert = require("node:assert/strict"); const { trustedAppUrl, assertSecretarySender } = require("./secretary-ipc.cjs");
test("vault IPC accepts only the main app frame at the exact app URL", () => {
  const frame = { url: "http://127.0.0.1:5173/?mode=test#tasks" }; const contents = { mainFrame: frame }; const window = { webContents: contents };
  assertSecretarySender({ sender: contents, senderFrame: frame }, window, "http://127.0.0.1:5173/");
  assert.throws(() => assertSecretarySender({ sender: {}, senderFrame: frame }, window, "http://127.0.0.1:5173/"), /sender/);
  assert.throws(() => assertSecretarySender({ sender: contents, senderFrame: { ...frame } }, window, "http://127.0.0.1:5173/"), /sender/);
  for (const url of ["http://127.0.0.1:51730/", "http://127.0.0.1:5173.evil.invalid/", "http://127.0.0.1:5173/foreign.html", "https://127.0.0.1:5173/", "http://user:pass@127.0.0.1:5173/"]) { frame.url = url; assert.throws(() => assertSecretarySender({ sender: contents, senderFrame: frame }, window, "http://127.0.0.1:5173/")); }
  assert.equal(trustedAppUrl("file:///C:/app/dist/index.html?x=1", "file:///C:/app/dist/index.html"), true);
  assert.equal(trustedAppUrl("file:///C:/untrusted.html", "file:///C:/app/dist/index.html"), false);
});
