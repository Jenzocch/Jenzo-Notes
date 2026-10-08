import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
export function windowsCommand(command) {
  if (/["\r\n&|<>^%!]/.test(command)) throw new Error("Unsupported executable path characters");
  return `"${command}"`;
}

// Read-only preflight: no installs, device permission requests or signing secret reads.
export function inspectAndroidToolchain({ env = process.env, platform = process.platform, home = os.homedir(), run = spawnSync } = {}) {
  const gaps = []; const warnings = [];
  const java = env.JAVA_HOME ? path.join(env.JAVA_HOME, "bin", platform === "win32" ? "java.exe" : "java") : "java";
  const result = run(java, ["-version"], { encoding: "utf8", windowsHide: true });
  const version = `${result.stderr || ""}\n${result.stdout || ""}`.match(/version\s+"(?:1\.)?(\d+)/)?.[1];
  const javaMajor = Number(version);
  if (result.error || result.status !== 0 || !Number.isInteger(javaMajor) || javaMajor < 17 || javaMajor > 24) gaps.push("JDK 17–24 executable (Java 17 bytecode; repo Gradle 8.14.3)");
  const sdk = env.ANDROID_HOME || env.ANDROID_SDK_ROOT;
  if (!sdk || !fs.existsSync(path.join(sdk, "platforms", "android-36", "android.jar"))) gaps.push("ANDROID_HOME/ANDROID_SDK_ROOT with SDK platform android-36");
  if (!sdk || !fs.existsSync(path.join(sdk, "build-tools", "36.0.0", platform === "win32" ? "aapt2.exe" : "aapt2"))) gaps.push("Android SDK Build Tools 36.0.0");
  const executable = platform === "win32" ? "gradle.bat" : "gradle";
  let gradle;
  if (env.GRADLE_HOME) {
    const candidate = path.join(env.GRADLE_HOME, "bin", executable);
    if (fs.existsSync(candidate)) gradle = candidate;
  } else {
    const root = path.join(env.GRADLE_USER_HOME || path.join(home, ".gradle"), "wrapper", "dists");
    for (const name of ["gradle-8.14.3-all", "gradle-8.14.3-bin"]) {
      const directory = path.join(root, name);
      if (!fs.existsSync(directory)) continue;
      for (const hash of fs.readdirSync(directory)) {
        const candidate = path.join(directory, hash, "gradle-8.14.3", "bin", executable);
        if (fs.existsSync(candidate)) { gradle = candidate; break; }
      }
    }
  }
  if (gradle) {
    const check = run(platform === "win32" ? windowsCommand(gradle) : gradle, ["--version"], { encoding: "utf8", windowsHide: true, shell: platform === "win32" });
    if (check.error || check.status !== 0 || !/Gradle 8\.14\.3(?:\s|$)/.test(check.stdout || "")) { gradle = undefined; gaps.push("Installed/cached Gradle must match repo version 8.14.3"); }
  } else gaps.push("Existing Gradle 8.14.3 (GRADLE_HOME or repo-version wrapper cache); automatic tool downloads disabled");
  if (!sdk || !fs.existsSync(path.join(sdk, "platform-tools", platform === "win32" ? "adb.exe" : "adb"))) warnings.push("adb/device tests unavailable; adb is not required for APK compilation");
  return { ready: gaps.length === 0, java, javaMajor: Number.isFinite(javaMajor) ? javaMajor : null, sdk: sdk || null, gradle: gradle || null, gaps, warnings };
}

export function stageAndroidAssets(repository) {
  const source = path.resolve(repository, "dist");
  const target = path.resolve(repository, "android/app/src/main/assets/public");
  if (!fs.existsSync(path.join(source, "index.html"))) throw new Error("Build dist/index.html before staging Android assets");
  // Fixed generated directory in this checkout, never a user-selected profile.
  if (target !== path.join(path.resolve(repository), "android", "app", "src", "main", "assets", "public")) throw new Error("Unsafe assets target");
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(source, target, { recursive: true });
  return target;
}
