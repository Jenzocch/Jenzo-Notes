const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { requireCloudBudgetAuthorization } = require("./cloud-budget.cjs");
test("unconfigured production budget cannot authorize a paid request", () => {
  assert.throws(requireCloudBudgetAuthorization, /Cloud AI paused/);
  const main = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
  for (const channel of ["openrouter-chat", "provider-chat", "provider-test"]) {
    const start = main.indexOf(`ipcMain.handle("ai:${channel}"`);
    const guard = main.indexOf('require("./cloud-budget.cjs").requireCloudBudgetAuthorization()', start);
    assert(guard > start && guard - start < 120, `${channel} must gate before credential/network operations`);
  }
});
