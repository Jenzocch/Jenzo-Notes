import fs from "node:fs/promises";
import path from "node:path";
process.env.JENZO_QA_OUTPUT = "qa-artifacts/security/unsupported";
const { base, port, target, ws, errors, call, evaluate, wait, screenshot } = await import("./qa-browser.mjs");
try {
  await call("Page.enable"); await call("Runtime.enable");
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `window.chengjing={platform:screen.width<600?'android':'win32',onShortcut:()=>()=>{},ai:{keyStatus:async()=>({configured:false}),listModels:async()=>[]}};` });
  const report = [];
  for (const [mode, width, height] of [["desktop-browser", 1440, 1000], ["android-without-key-adapter", 390, 844]]) {
    await call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 }); await call("Page.navigate", { url: base }); await wait("document.querySelector('.workspace')");
    await evaluate(`(async()=>{const {useAppStore}=await import('/src/store.ts');useAppStore.setState({language:'en'});useAppStore.getState().setView('tasks');})()`);
    await wait("document.querySelector('.secretary-sensitive')?.disabled && document.querySelector('.secure-vault-controls')?.textContent.includes('unsupported')");
    const result = await evaluate(`(async()=>{const {db}=await import('/src/db.ts');const {savePrivateItem}=await import('/src/lib/secureSecretary.ts');const before=[await db.cards.count(),await db.tasks.count(),await db.fragments.count(),await db.preferences.count()];let blocked=false;try{await savePrivateItem('note','SYNTHETIC_UNSUPPORTED_BODY')}catch(e){blocked=e.message.includes('unsupported')}return {blocked,unchanged:JSON.stringify(before)===JSON.stringify([await db.cards.count(),await db.tasks.count(),await db.fragments.count(),await db.preferences.count()])}})()`);
    if (!result.blocked || !result.unchanged) throw new Error("Unsupported persistence did not fail closed");
    const untouched = await evaluate(`(async()=>{const marker='SYNTHETIC_LEGACY_DRAFT_ONLY';window.__priorLegacyDraft=localStorage.getItem('chengjing-source-draft-v1');window.__legacyFixture=JSON.stringify({version:1,goal:marker,draft:marker,sources:[]});localStorage.setItem('chengjing-source-draft-v1',window.__legacyFixture);const {useAppStore}=await import('/src/store.ts');useAppStore.getState().openAI();return true})()`);
    await wait("document.querySelector('.source-workbench')"); await new Promise(resolve => setTimeout(resolve, 150));
    if (!untouched || !await evaluate("localStorage.getItem('chengjing-source-draft-v1')===window.__legacyFixture && !document.querySelector('.source-document')")) throw new Error("Legacy draft was automatically loaded or altered");
    await screenshot(`${mode}.png`);
    await evaluate("window.__priorLegacyDraft===null?localStorage.removeItem('chengjing-source-draft-v1'):localStorage.setItem('chengjing-source-draft-v1',window.__priorLegacyDraft)");
    report.push({ mode, unsupported: true, sensitiveControlsDisabled: true, noPlaintextFallback: true, legacyDraftUntouched: true });
  }
  if (errors.length) throw new Error(errors.join("\n")); await fs.writeFile(path.join("qa-artifacts/security/unsupported", "report.json"), JSON.stringify({ report, errors }, null, 2)); console.log(JSON.stringify(report, null, 2));
} catch (error) { console.error(JSON.stringify(errors)); console.error(await evaluate("document.body.innerText")); await screenshot("failure.png"); throw error; }
finally { await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`); ws.close(); }
