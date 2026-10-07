import { spawnSync } from "node:child_process";
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
  const result = spawnSync(process.platform === "win32" ? windowsCommand(command) : command, args, { cwd: repository, stdio: "inherit", env, windowsHide: true, shell: process.platform === "win32" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"]);
stageAndroidAssets(repository);
run(report.gradle, ["-p", "android", ":app:assembleDebug", "--offline", "--console=plain", "-Pandroid.builder.sdkDownload=false"], { ...process.env, ANDROID_HOME: report.sdk, ANDROID_SDK_ROOT: report.sdk });
