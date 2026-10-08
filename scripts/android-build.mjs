import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectAndroidToolchain, stageAndroidAssets, windowsCommand } from "./android-toolchain.mjs";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const report = inspectAndroidToolchain();
console.log(JSON.stringify(report, null, 2));
if (!report.ready) {
  console.error("Android native build blocked before mutation. No SDK/JDK/Gradle download, device install, permission grant or signing setup attempted.");
  process.exit(2);
}
if (process.argv.includes("--check")) process.exit(0);
function run(command, args, env = process.env) {
  const batch = process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
  const result = spawnSync(batch ? windowsCommand(command) : command, args, { cwd: repository, stdio: "inherit", env, windowsHide: true, shell: batch });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
if (process.platform === "win32") {
  // Resolve npm's JS entrypoint beside the installed Node, avoiding cmd's bare
  // quoted npm.cmd expansion of %~dp0 into the checkout directory.
  const npmCli = process.env.npm_execpath || path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (!fs.existsSync(npmCli)) throw new Error("Installed npm CLI not found; invoke this script via npm run android:build");
  run(process.execPath, [npmCli, "run", "build"]);
} else run("npm", ["run", "build"]);
stageAndroidAssets(repository);
run(report.gradle, ["-p", "android", ":app:assembleDebug", "--offline", "--no-daemon", "--console=plain", "-Pandroid.builder.sdkDownload=false"], { ...process.env, ANDROID_HOME: report.sdk, ANDROID_SDK_ROOT: report.sdk });
