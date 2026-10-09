import fs from "node:fs/promises";
import path from "node:path";
import { qaPrivateVaultSource } from "./qa-private-vault.mjs";
import { base, output, ws, errors, call, evaluate, wait, click, fill, screenshot } from "./qa-browser.mjs";
const button = text => `[...document.querySelectorAll('.evidence-investigation button')].find(e=>e.textContent===${JSON.stringify(text)})`;
const report = [];
try {
  console.log("QA enable"); await call("Page.enable"); await call("Runtime.enable"); console.log("QA enabled");
  await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await call("Page.addScriptToEvaluateOnNewDocument", { source: qaPrivateVaultSource + `;window.__investigationQA={exports:[],consent:false};window.confirm=()=>window.__investigationQA.consent;window.chengjing={secretaryVault:window.__qaPrivateVaultBridge,platform:screen.width<600?'android':'win32',onShortcut:()=>()=>{},files:{save:async p=>{window.__investigationQA.exports.push(p);return {canceled:false}}}};` });
  for (const [mode,width,height] of [["desktop",1440,1000],["mobile",390,844]]) {
    await call("Emulation.setDeviceMetricsOverride", { width,height,deviceScaleFactor:1,mobile:mode==="mobile" });
    console.log("QA navigate",mode); await call("Page.navigate",{url:base}); console.log("QA navigated",mode); await wait("document.querySelector('.app-shell') || document.querySelector('.workspace')"); console.log("QA app ready",mode);
    await evaluate(`(async()=>{const {useAppStore}=await import('/src/store.ts');useAppStore.setState({language:'en'});useAppStore.getState().openAI();})()`);
    await wait("document.querySelector('.source-workbench > summary')");
    await screenshot(`${mode}-entry.png`);
    console.log("QA geometry", mode, await evaluate("JSON.stringify({width:innerWidth,height:innerHeight,rect:document.querySelector('.source-workbench > summary').getBoundingClientRect().toJSON()})"));
    await click("document.querySelector('.source-workbench > summary')");
    await wait("document.querySelector('.source-workbench').open");
    await click("document.querySelector('.evidence-investigation > summary')");
    await wait("document.querySelector('.evidence-investigation').open");
    await click(button("Open isolated FG-17 case")); await click(button("Retrieve related passages"));
    await wait("document.querySelectorAll('.investigation-results article').length>=8");
    await click(button("Review FG-17 mock proposal"));
    await wait("document.querySelector('.investigation-brief') && !"+button("Save sample draft (memory)")+".disabled");
    if(await evaluate("new Set([...document.querySelectorAll('[data-finding-kind]')].map(e=>e.dataset.findingKind)).size")!==4) throw new Error('Missing classifications');
    await fill(".investigation-notes","Reviewed synthetic improvement brief; verify calibration and missing certificate.");
    await click(button("Preview cited task")); await wait("document.querySelector('.investigation-task-preview')");
    await click(button("Confirm this cited task")); await wait("document.querySelector('.evidence-investigation').textContent.includes('Sample task count: 1')");
    await click(button("Save sample draft (memory)")); await wait("document.querySelector('.evidence-investigation').textContent.includes('Sample draft saved in memory')");
    await click(button("Export plaintext after confirmation")); await wait("document.querySelector('.evidence-investigation').textContent.includes('Export cancelled')");
    if(await evaluate("window.__investigationQA.exports.length")!==0) throw new Error('Export bypassed consent');
    await evaluate("window.__investigationQA.consent=true"); await click(button("Export plaintext after confirmation")); await wait("window.__investigationQA.exports.length===1");
    const exported=await evaluate("window.__investigationQA.exports[0].data");
    if(!exported.startsWith('~~~text')||!exported.includes('SHA256:')||!exported.includes('sample:ledger')||!exported.includes('Reviewed synthetic')) throw new Error('Missing inert document/provenance');
    await fs.writeFile(path.join(output,`${mode}-brief.md`),exported);
    if(await evaluate("document.documentElement.scrollWidth>innerWidth+1")) throw new Error('Horizontal overflow');
    await screenshot(`${mode}.png`);
    await click("[...document.querySelectorAll('.evidence-investigation details > summary')].find(e=>e.textContent==='Synthetic invalidation checks')");
    await click(button("Simulate QC source change")); await wait(button("Export plaintext after confirmation")+".disabled");
    if(!await evaluate("!!document.querySelector('[data-source-state=changed]')")) throw new Error('Invalid source not visible');
    await click(button("Close case · Use local sources"));
    // Real local flow, synthetic fixtures only. Uses existing DB and private vault paths.
    const result=await evaluate(`(async()=>{const {db}=await import('/src/db.ts');const {unlockSecureVault,readSecureVault}=await import('/src/lib/secureSecretary.ts');await unlockSecureVault();const {localEvidenceRepository,retrieveInvestigation}=await import('/src/lib/investigationEvidence.ts');const {compileInvestigation,localEvidenceOutline,saveInvestigation,loadInvestigation,previewInvestigationTask,confirmInvestigationTask,publishInvestigationRelation}=await import('/src/lib/investigation.ts');const ids=['qa-evidence-${mode}-a','qa-evidence-${mode}-b'];for(const [i,id] of ids.entries())await db.cards.put({id,title:'Synthetic local '+i,plainText:'FG-71 local original evidence '+i+' requires review of calibration.',contentHtml:'',kind:'note',state:'active',createdAt:1,updatedAt:1,tagIds:[],favorite:false,color:'slate',attachmentIds:[],properties:{}});const hits=(await retrieveInvestigation(localEvidenceRepository,'FG-71','en')).filter(h=>ids.some(id=>h.source.key==='card:'+id));const artifact=await compileInvestigation(localEvidenceOutline(hits.map(h=>h.source),'FG-71'),hits.map(h=>h.source.key),'FG-71',localEvidenceRepository);await saveInvestigation(artifact,localEvidenceRepository);await loadInvestigation(artifact.id,localEvidenceRepository);const preview=await previewInvestigationTask(artifact,artifact.actions[0].id,localEvidenceRepository);const task=await confirmInvestigationTask(preview);artifact.relations[0].decision='accepted';await publishInvestigationRelation(artifact,artifact.relations[0].id,localEvidenceRepository);const vault=(await readSecureVault()).data;const edge=await db.brainEdges.get(artifact.relations[0].id);return {encryptedDraft:!!vault.entries['secretary-investigation:'+artifact.id],privateTask:!!vault.entries['secretary-item:'+task.id],metadata:!!vault.entries['secretary-task-evidence:'+task.id],bothEnds:edge.evidenceRefs.length};})()`);
    if(!result.encryptedDraft||!result.privateTask||!result.metadata||result.bothEnds!==2) throw new Error('Local flow incomplete');
    report.push({mode,width,height,syntheticCase:true,consent:true,invalidated:true,localFlow:result});
  }
  if(errors.length)throw new Error(errors.join('\n'));
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify({report,errors},null,2));console.log(JSON.stringify(report));
} finally {ws.close();}
