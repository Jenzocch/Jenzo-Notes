// Responsive UI integration through the production Android adapter + MOCK native calls.
// This does not certify Android Keystore, microphone or OS notification delivery.
import fs from "node:fs/promises";
import path from "node:path";
import { qaPrivateVaultSource } from "./qa-private-vault.mjs";
process.env.JENZO_QA_OUTPUT = "qa-artifacts/android-native-browser";
const { port, base, output, target, ws, errors, call, evaluate, wait, click, fill, screenshot } = await import("./qa-browser.mjs");
const button = text => `[...document.querySelectorAll('.secretary-panel button')].find(e=>e.textContent===${JSON.stringify(text)})`;
try {
  await call("Page.enable"); await call("Runtime.enable");
  await call("Page.addScriptToEvaluateOnNewDocument", { source: qaPrivateVaultSource + `
    window.__androidQA={calls:[],notificationPermission:false,speechPermission:false};
    window.chengjing={secretaryVault:window.__qaPrivateVaultBridge,platform:'android',onShortcut:()=>()=>{},ai:{keyStatus:async()=>({configured:false})}};
    window.__androidMockCall=async(method,args={})=>{
      window.__androidQA.calls.push({method,args});
      if(method==='secretary.notifications.status')return {available:window.__androidQA.notificationPermission,reason:window.__androidQA.notificationPermission?'available':'notification-permission-required',mode:'inexact-once'};
      if(method==='secretary.notifications.schedule'){if(!window.__androidQA.notificationPermission)throw Error('notifications-disabled');return {state:'scheduled',mode:'inexact-once'}};
      if(method==='secretary.speech.status')return {available:window.__androidQA.speechPermission,reason:window.__androidQA.speechPermission?'available':'microphone-permission-required'};
      if(method==='secretary.speech.start'){window.__androidQA.sessionId=args.sessionId;return {sessionId:args.sessionId}};
      if(method==='secretary.speech.stop')return {stopped:true};
      const action=method.replace('secretary.vault.','');
      if(action==='commit')return window.__qaPrivateVaultBridge.commit(args);
      return window.__qaPrivateVaultBridge[action]();
    };
  ` });
  const report = [];
  for (const [mode, width, height] of [["desktop", 1440, 1000], ["mobile", 390, 844]]) {
    await call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: mode === "mobile" });
    await call("Page.navigate", { url: base }); await wait("document.querySelector('.workspace')");
    await evaluate(`(async()=>{const {createAndroidPrivateAdapters}=await import('/src/lib/androidSecretary.ts');Object.assign(window.chengjing,createAndroidPrivateAdapters(window.__androidMockCall,(name,callback)=>{const listener=e=>callback(e.detail);window.addEventListener(name,listener);return ()=>window.removeEventListener(name,listener)}));const {useAppStore}=await import('/src/store.ts');useAppStore.setState({language:'en'});useAppStore.getState().setView('tasks')})()`);
    await wait("document.querySelector('.secretary-panel textarea')");
    await click(button("Unlock private storage")); await wait("!document.querySelector('.secretary-sensitive').disabled");
    const checkbox = "[...document.querySelectorAll('.secretary-panel label')].find(e=>e.textContent.includes('Android inexact one-shot notification')).querySelector('input')";
    await wait(`(${checkbox}).disabled`);
    await click(button("On-device voice")); await wait("document.querySelector('.secretary-panel [role=status]')?.textContent.includes('typing/paste')");
    if (await evaluate("window.__androidQA.calls.some(c=>c.method==='secretary.speech.start')")) throw new Error("Voice started without mock capability");
    await evaluate("window.__androidQA.notificationPermission=true;window.__androidQA.speechPermission=true");
    await click(button("Lock private storage")); await click(button("Unlock private storage")); await wait(`!(${checkbox}).disabled`);
    const title = `AndroidSynthetic${Date.now()}`;
    await fill(".secretary-panel textarea", title); await fill(".secretary-panel input[type=datetime-local]", "2099-01-01T12:00");
    await click(button("Preview reminder proposal")); await wait("document.querySelector('.secretary-proposal')");
    await click(checkbox); await wait("!document.querySelector('.secretary-proposal')");
    await click(button("Preview reminder proposal")); await wait("document.querySelector('.secretary-proposal')?.textContent.includes('inexact')");
    if (await evaluate("window.__androidQA.calls.some(c=>c.method==='secretary.notifications.schedule')")) throw new Error("Native schedule before consent");
    await click(button("Confirm creation")); await wait("document.querySelector('.secretary-panel [role=status]')?.textContent.includes('inexact notification scheduled')");
    const schedules = await evaluate("window.__androidQA.calls.filter(c=>c.method==='secretary.notifications.schedule')");
    if (schedules.length !== 1 || Object.keys(schedules[0].args).sort().join(',') !== 'fingerprint,operationId') throw new Error("Unexpected native scheduling payload/count");
    await click(button("On-device voice")); await wait("window.__androidQA.sessionId");
    await evaluate("window.dispatchEvent(new CustomEvent('chengjing:android-secretary-speech',{detail:{sessionId:window.__androidQA.sessionId,kind:'result',text:'SYNTHETIC editable transcript'}}))");
    await wait("document.querySelector('.secretary-panel textarea').value.includes('editable transcript')");
    await click(button("On-device voice"));
    await evaluate("(async()=>{await window.__qaPrivateVaultBridge.lock();window.dispatchEvent(new CustomEvent('chengjing:android-vault-state',{detail:{state:'locked'}}));window.dispatchEvent(new CustomEvent('chengjing:android-secretary-speech',{detail:{sessionId:window.__androidQA.sessionId,kind:'result',text:'LATE PRIVATE RESULT'}}))})()");
    await wait("document.querySelector('.secretary-sensitive').disabled && document.querySelector('.secretary-panel textarea').value===''");
    if (await evaluate("document.body.innerText.includes('LATE PRIVATE RESULT')")) throw new Error("Late speech leaked into locked UI");
    if (await evaluate("document.documentElement.scrollWidth>innerWidth+1")) throw new Error(`${mode}: horizontal overflow`);
    await screenshot(`${mode}-native-adapter-mock.png`);
    report.push({ mode, permissionUnavailableFailsClosed: true, previewReplacedOnDestinationChange: true, consentBeforeNativeCall: true, editableTranscript: true, backgroundLockClearsLateResults: true, nativeBoundary: "MOCK ONLY", deviceExecution: false });
  }
  if (errors.length) throw new Error(errors.join("\n"));
  await fs.writeFile(path.join(output, "native-adapter-report.json"), JSON.stringify({ report, realCloudCalls: 0, realMicCalls: 0, realNotifications: 0 }, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) { await screenshot("native-adapter-failure.png"); throw error; }
finally { await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`); ws.close(); }
