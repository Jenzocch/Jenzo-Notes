const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
test("Android build CLI exits before assets mutation when native tools are absent", () => {
  const { spawnSync } = require("node:child_process");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "jenzo-toolchain-synthetic-"));
  try {
    const result = spawnSync(process.execPath, [path.resolve(__dirname, "../scripts/android-build.mjs"), "--check"], { encoding: "utf8", env: { ...process.env, JAVA_HOME: directory, ANDROID_HOME: directory, ANDROID_SDK_ROOT: directory, GRADLE_HOME: directory } });
    assert.equal(result.status, 2); assert.equal(JSON.parse(result.stdout).ready, false);
    assert.match(result.stderr, /blocked before mutation/); assert.deepEqual(fs.readdirSync(directory), []);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
test("Android preflight reports missing tools without installing or mutating", async () => {
  const { inspectAndroidToolchain } = await import("../scripts/android-toolchain.mjs");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "jenzo-toolchain-synthetic-"));
  try {
    const calls = []; const report = inspectAndroidToolchain({ env: {}, home: directory, platform: "win32", run: (...args) => { calls.push(args); return { error: new Error("not found"), status: null }; } });
    assert.equal(report.ready, false); assert.equal(report.gaps.length, 4); assert.equal(calls.length, 1);
    assert.deepEqual(calls[0][1], ["-version"]); assert.deepEqual(fs.readdirSync(directory), []);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
test("Android preflight accepts matching installed tools and replaces only generated assets", async () => {
  const { inspectAndroidToolchain, stageAndroidAssets, windowsCommand } = await import("../scripts/android-toolchain.mjs");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "jenzo-toolchain-synthetic-"));
  try {
    for (const name of ["sdk/platforms/android-36/android.jar", "sdk/build-tools/36.0.0/aapt2.exe", "gradle/bin/gradle.bat", "dist/index.html", "android/app/src/main/assets/public/stale.js"]) { const file = path.join(directory, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, "synthetic"); }
    const options = { env: { JAVA_HOME: path.join(directory, "jdk"), ANDROID_HOME: path.join(directory, "sdk"), GRADLE_HOME: path.join(directory, "gradle") }, home: directory, platform: "win32", run: (_, args) => ({ status: 0, stderr: args[0] === "-version" ? 'openjdk version "17.0.1"' : "", stdout: args[0] === "--version" ? "Gradle 8.14.3\n" : "" }) };
    assert.equal(inspectAndroidToolchain(options).ready, true);
    assert.equal(inspectAndroidToolchain({ ...options, run: () => ({ status: 0, stdout: "Gradle 9.0", stderr: 'openjdk version "17.0.1"' }) }).ready, false);
    assert.equal(windowsCommand("C:\\Program Files\\Gradle\\gradle.bat"), '"C:\\Program Files\\Gradle\\gradle.bat"');
    assert.throws(() => windowsCommand("tool&echo unsafe"));
    const target = stageAndroidAssets(directory); assert.equal(fs.readFileSync(path.join(target, "index.html"), "utf8"), "synthetic"); assert.equal(fs.existsSync(path.join(target, "stale.js")), false);
    fs.rmSync(path.join(directory, "dist/index.html")); assert.throws(() => stageAndroidAssets(directory), /Build dist/); assert.equal(fs.existsSync(path.join(target, "index.html")), true);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
