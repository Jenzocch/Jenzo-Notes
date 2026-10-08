import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (!process.env.JAVA_HOME) throw new Error("Use an already installed JDK 17+; this check does not install tools");
const output = path.join(repository, "qa-artifacts", "android-secretary-host");
fs.mkdirSync(output, { recursive: true });
const native = path.join(repository, "android/app/src/main/java/tw/techtarian/chengjing");
function run(name, args) {
  const result = spawnSync(path.join(process.env.JAVA_HOME, "bin", name + (process.platform === "win32" ? ".exe" : "")), args,
    { encoding: "utf8", windowsHide: true });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
run("javac", ["--release", "17", "-d", output, path.join(native, "SecretaryCipher.java"), path.join(native, "SecretaryBridgePolicy.java"), path.join(repository, "scripts/fixtures/java/SecretaryHostTest.java")]);
run("java", ["-cp", output, "tw.techtarian.chengjing.SecretaryHostTest"]);
