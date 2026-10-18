import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

process.env.JENZO_QA_OUTPUT = "qa-artifacts/branding";

const packageJson = JSON.parse(await fs.readFile("package.json", "utf8"));
const license = await fs.readFile("LICENSE.md", "utf8");
const androidBuild = await fs.readFile("android/app/build.gradle.kts", "utf8");
assert.equal(packageJson.name, "chengjing");
assert.equal(packageJson.build.appId, "tw.techtarian.chengjing");
assert.equal(packageJson.build.productName, "澄境");
assert.match(license, /Copyright \(c\) 2026 Coyoter/);
assert.match(androidBuild, /applicationId\s*=\s*"tw\.techtarian\.chengjing"/);

const { port, base, output, target, ws, errors, call, evaluate, wait, screenshot } = await import("./qa-browser.mjs");
try {
  await call("Page.enable");
  await call("Runtime.enable");
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `window.chengjing={platform:screen.width<600?'android':'win32',onShortcut:()=>()=>{},ai:{keyStatus:async()=>({configured:false}),listModels:async()=>[]}};` });
  const report = [];
  for (const [mode, width, height] of [["desktop", 1440, 1000], ["mobile", 390, 844]]) {
    await call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: mode === "mobile" });
    await call("Page.navigate", { url: base });
    await wait("document.querySelector('.workspace')");
    assert.equal(await evaluate("document.title"), "JENZO NOTE");
    if (mode === "desktop") {
      assert.equal(await evaluate("document.querySelector('.brand-row')?.textContent.trim()"), "JENZO NOTE");
      assert.equal(await evaluate("document.querySelector('.brand-row img,.brand-row svg')"), null);
    } else {
      assert.equal(await evaluate("document.querySelector('.mobile-header > span')?.textContent.trim()"), "JENZO NOTE");
      assert.equal(await evaluate("document.querySelector('.mobile-header > span img,.mobile-header > span svg')"), null);
    }
    assert.equal(await evaluate("document.documentElement.scrollWidth > innerWidth + 1"), false);
    await screenshot(`${mode}.png`);
    report.push({ mode, width, height, title: "JENZO NOTE", textOnlyBrand: true, noHorizontalOverflow: true });
  }
  if (errors.length) throw new Error(errors.join("\n"));
  await fs.writeFile(path.join(output, "report.json"), JSON.stringify({ report, preservedIdentity: true, preservedLicense: true }, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`);
  ws.close();
}
