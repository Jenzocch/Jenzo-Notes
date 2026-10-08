import fs from "node:fs/promises";
import path from "node:path";
import { qaPrivateVaultSource } from "./qa-private-vault.mjs";
import {port,base,output,target,ws,errors,call,evaluate,wait,click,fill,screenshot} from "./qa-browser.mjs";
const button = text => `[...document.querySelectorAll('.source-workbench button')].find(e=>e.textContent===${JSON.stringify(text)})`;

try {
  await call("Page.enable"); await call("Runtime.enable");
  await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await call("Page.addScriptToEvaluateOnNewDocument", { source: qaPrivateVaultSource + `
    window.__sourceQA={requests:[],exports:[],invalid:false};
    window.confirm=()=>true; // Explicit synthetic export consent; never real data.
    window.chengjing={secretaryVault:window.__qaPrivateVaultBridge,platform:screen.width<600?'android':'win32',onShortcut:()=>()=>{},files:{save:async p=>{window.__sourceQA.exports.push(p);return {canceled:false}}},ai:{keyStatus:async()=>({configured:true,encrypted:true}),listModels:async()=>[],openRouterChat:async p=>{
      window.__sourceQA.requests.push(p);
      const content=p.messages.at(-1).content;
      const raw=content.slice(content.indexOf('>\\n')+2,content.indexOf('\\n</reference_material>'));
      const sources=JSON.parse(raw);
      return {text:JSON.stringify({title:'Voyage brief',sections:[{heading:'Compare recorded plans',text:'These notes share a voyage theme. Timing needs confirmation, not a causal claim.',evidence:sources.map(s=>({key:s.key,quote:window.__sourceQA.invalid?'invented evidence that is absent':s.excerpt.slice(-45)}))}]}),model:p.model};
    }}};
  ` });
  const report = [];
  for (const [mode, width, height] of [["desktop",1440,1000],["mobile",390,844]]) {
    const keyword = `VoyageQA${Date.now()}`;
    const fixtureId = `jenzo-phase-one-qa-${mode}-${Date.now()}`;
    await call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: mode === "mobile" });
    await call("Page.navigate", { url: base });
    await wait("document.querySelector('.app-shell') || document.querySelector('.workspace')");
    await evaluate(`(async()=>{ const {useAppStore}=await import('/src/store.ts'); useAppStore.setState({language:'en',aiEngine:'openrouter'}); const {db}=await import('/src/db.ts'); await db.cards.add({id:${JSON.stringify(fixtureId)},title:'QA Archive',plainText:'x'.repeat(20000)+${JSON.stringify(keyword)}+' budget remains uncertain; check next year.',contentHtml:'',kind:'note',state:'active',createdAt:1,updatedAt:1,tagIds:[],favorite:false,color:'slate',attachmentIds:[],properties:{},sourceUrl:'https://example.com/voyage'}); useAppStore.getState().openAI();})()`);
    await wait("document.querySelector('.source-workbench summary')");
    await new Promise(resolve => setTimeout(resolve, 400));
    await click("document.querySelector('.source-workbench summary')");
    await wait("document.querySelector('.source-workbench').open");
    await click(button("Unlock private storage")); await wait("!document.querySelector('.source-workbench > fieldset').disabled");
    await fill(".source-workbench > fieldset textarea", `${keyword} idea: plan next year. https://example.com/idea`);
    await click(button("Capture and select"));
    await wait("document.querySelector('.source-selection button')");
    await fill(".source-workbench form input", keyword);
    await click(button("Search sources"));
    await wait("document.querySelectorAll('.source-results article').length===2");
    await click("[...document.querySelectorAll('.source-results article')].find(e=>e.textContent.includes('QA Archive')).querySelector('input')");
    // Select by label location instead of relying on order of pasted/source excerpts.
    await evaluate(`(() => { const e=[...document.querySelectorAll('.source-workbench > label')].find(e=>e.textContent.includes('Document goal')).querySelector('textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'Compare voyage notes for a planning brief'); e.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await click(button("Create excerpt document"));
    await wait("document.querySelector('.source-document')");
    await click(button("AI compose draft"));
    await wait("document.querySelector('.source-workbench [role=status]')?.textContent.includes('private-outbound-denied:remote-ai')");
    const validated = await evaluate(`(async()=>{ const {parseSourcedDocument,searchNoteSources}=await import('/src/lib/sourceWorkbench.ts');const sources=await searchNoteSources(${JSON.stringify(keyword)},'en'); return parseSourcedDocument(JSON.stringify({title:'Voyage brief',sections:[{heading:'Comparison',text:'Mock comparison for manual review.',evidence:sources.map(s=>({key:s.key,quote:s.excerpt.slice(-40)}))}]}),sources).text; })()`);
    await fill(".source-document", validated);
    await fill(".source-document", "# Reviewed voyage brief\n\nTiming remains a question. Check both sources.");
    await click(button("Export Markdown document"));
    await wait("window.__sourceQA.exports.length>0");
    const exported = await evaluate("window.__sourceQA.exports.at(-1).data");
    await fs.writeFile(path.join(output, `${mode}-document.md`), exported);
    if (!exported.includes("Reviewed voyage brief") || !exported.includes("private:") || !exported.includes(`card:${fixtureId}`) || !exported.includes("https://example.com/voyage") || !exported.startsWith("~~~text")) throw new Error("Export lost inert text or source provenance");
    await click(button("Save document as note"));
    await wait("document.querySelector('.source-workbench [role=status]')?.textContent.includes('Saved in private encrypted vault')");
    const saved = await evaluate(`(async()=>{const {listPrivateItems}=await import('/src/lib/secureSecretary.ts');return (await listPrivateItems()).filter(c=>c.title.includes('Reviewed voyage brief')&&c.plainText.includes(${JSON.stringify(fixtureId)})).length})()`);
    if (saved !== 1) throw new Error("Document was not saved");
    await evaluate("window.__sourceQA.invalid=true");
    await click(button("AI compose draft"));
    await wait("document.querySelector('.source-workbench [role=status]')?.textContent.includes('private-outbound-denied:remote-ai')");
    if (!await evaluate("document.querySelector('.source-document').value.includes('Reviewed voyage brief')")) throw new Error("Invalid evidence replaced reviewed draft");
    const overflow = await evaluate("document.documentElement.scrollWidth > innerWidth+1");
    if (overflow) throw new Error(`${mode} horizontal overflow`);
    await screenshot(`${mode}.png`);
    if (await evaluate("window.__sourceQA.requests.length")) throw new Error("Private outbound policy allowed a remote request");
    const intact = await evaluate(`(async()=>{const {db}=await import('/src/db.ts');const card=await db.cards.get(${JSON.stringify(fixtureId)});return card.updatedAt===1&&card.plainText.startsWith('x'.repeat(20000));})()`);
    if (!intact) throw new Error("Original source was modified");
    await click(button("Save encrypted draft")); await wait("document.querySelector('.source-workbench [role=status]')?.textContent==='Encrypted draft saved'");
    if(!await evaluate("localStorage.getItem('chengjing-source-draft-v1')===null && !Object.values(localStorage).some(v=>v.includes('Reviewed voyage brief'))"))throw new Error("Plaintext draft persisted");
    await evaluate("(async()=>{ const {useAppStore}=await import('/src/store.ts');useAppStore.getState().closeRightPanel();})()");
    await wait("!document.querySelector('.source-workbench')");
    await evaluate("(async()=>{ const {useAppStore}=await import('/src/store.ts');useAppStore.getState().openAI();})()");
    await wait("document.querySelector('.source-document')?.value.includes('Reviewed voyage brief')");
    report.push({ mode, width, encryptedCapture: true, oldLongNoteRetrieved: true, mockDocumentValidated: true, cloudAIBlocked: true, edited: true, inertTextExported: true, privateNoteSaved: true, encryptedDraftRetained: true, noPlaintextDraft: true, horizontalOverflow: overflow, vaultBoundary:"MOCK; real Windows crypto verified separately" });
  }
  if(errors.length) throw new Error(errors.join("\n"));
  await fs.writeFile(path.join(output, "report.json"), JSON.stringify({ report, errors, realAICalls: 0 }, null, 2));
  console.log(JSON.stringify({ report, errors, realAICalls: 0 }, null, 2));
} catch (error) {
  console.error(await evaluate("({status:document.querySelector('.source-workbench [role=status]')?.textContent, requests:window.__sourceQA?.requests.length, body:document.querySelector('.source-workbench')?.innerText})"));
  await screenshot("failure.png");
  throw error;
} finally { await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`); ws.close(); }
