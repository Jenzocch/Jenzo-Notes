const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const native = path.resolve(__dirname, "../android/app/src/main/java/tw/techtarian/chengjing");
test("Android native production generation guard rejects queued old authority (JDK only, no device)", () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "jenzo-session-race-"));
  const executable = name => process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, "bin", name + (process.platform === "win32" ? ".exe" : "")) : name;
  try {
    const compile = spawnSync(executable("javac"), ["--release", "17", "-d", output, path.join(native, "SecretarySessionGuard.java"), path.resolve(__dirname, "../scripts/fixtures/java/SecretarySessionRaceTest.java")], { encoding: "utf8", windowsHide: true, timeout: 30000 });
    assert.equal(compile.status, 0, `Use an existing JDK17+; no install attempted: ${compile.error || compile.stderr}`);
    const run = spawnSync(executable("java"), ["-cp", output, "tw.techtarian.chengjing.SecretarySessionRaceTest"], { encoding: "utf8", windowsHide: true, timeout: 30000 });
    assert.equal(run.status, 0, run.error || run.stderr); assert.match(run.stdout, /PASS 43 production session-guard race checks/);
  } finally { fs.rmSync(output, { recursive: true, force: true }); }
});
test("Android dispatch carries ingress authority into the vault mutation monitor and locks synchronously", () => {
  const main = fs.readFileSync(path.join(native, "MainActivity.kt"), "utf8");
  const vault = fs.readFileSync(path.join(native, "SecretaryVault.kt"), "utf8");
  assert.match(main, /privateTicket = secretaryVault\.captureTicket\(\)/);
  assert.match(main, /secretaryVault\.call\(method, args, requireNotNull\(privateTicket\)\)/);
  assert.match(vault, /fun call\(method: String, args: JSONObject, ticket: SecretarySessionGuard\.Ticket\): JSONObject = session\.execute\(ticket\) \{ callAuthorized\(method, args\) \}/);
  assert.match(vault, /fun setActive\(value: Boolean\) = session\.setActive\(value\)/);
  assert.match(vault, /session\.revoke \{ unlocked = false; previews\.clear\(\) \}/);
  const lockBranch = main.match(/"secretary\.vault\.lock" -> \{[^\n]+/)?.[0];
  assert.ok(lockBranch?.includes("secretaryVault.lock()")); assert.ok(!lockBranch.includes("executor.execute"));
  assert.match(main, /override fun onPageStarted[^\n]+lockPrivateSession\(\)/);
  assert.match(main, /override fun onPause[^\n]+lockPrivateSession\(\)/);
  assert.match(main, /override fun onDestroy[^\n]+lockPrivateSession\(\)/);
});
