// Uses an already-installed Chrome/Edge launched with an isolated profile and
// --headless=new --remote-debugging-port=9237. No browser/package downloads.
import fs from "node:fs/promises";
import path from "node:path";
const port = process.env.JENZO_CDP_PORT || "9237";
const base = process.env.CHENGJING_URL || "http://127.0.0.1:5173";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(base).hostname)) throw new Error("QA requires a localhost development server");
const output = path.resolve("qa-artifacts/source-workbench");
await fs.mkdir(output, { recursive: true });
const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener("open", resolve, { once: true }));
let id = 0; const pending = new Map(); const errors = [];
ws.addEventListener("message", event => {
  const message = JSON.parse(event.data);
  if (message.id) { const item = pending.get(message.id); pending.delete(message.id); message.error ? item.reject(new Error(message.error.message)) : item.resolve(message.result); }
  if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.text + ": " + (message.params.exceptionDetails.exception?.description || ""));
});
const call = (method, params = {}) => new Promise((resolve, reject) => { const request = ++id; pending.set(request, { resolve, reject }); ws.send(JSON.stringify({ id: request, method, params })); });
const evaluate = async expression => { const result = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; };
const wait = async expression => { const start = Date.now(); while (Date.now() - start < 20000) { if (await evaluate(`Boolean(${expression})`)) return; await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error(`Timed out: ${expression}`); };
const click = async expression => {
  await wait(`(${expression}) && !(${expression}).disabled`);
  const point = await evaluate(`(() => { const el = ${expression}; if(!el) throw new Error('Missing click target'); el.scrollIntoView({block:'center'}); const r=el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
  await call("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
  await call("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
};
const button = text => `[...document.querySelectorAll('.source-workbench button')].find(e=>e.textContent===${JSON.stringify(text)})`;
const fill = async (selector, text) => evaluate(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(text)}); e.dispatchEvent(new Event('input',{bubbles:true})); })()`);
const screenshot = async name => { const result = await call("Page.captureScreenshot", { format: "png" }); await fs.writeFile(path.join(output, name), Buffer.from(result.data, "base64")); };
try {
  await call("Page.enable"); await call("Runtime.enable");
  await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `
    window.__sourceQA={requests:[],exports:[],invalid:false};
    window.chengjing={platform:screen.width<600?'android':'win32',onShortcut:()=>()=>{},files:{save:async p=>{window.__sourceQA.exports.push(p);return {canceled:false}}},ai:{keyStatus:async()=>({configured:true,encrypted:true}),listModels:async()=>[],openRouterChat:async p=>{
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
    await fill(".source-workbench > label textarea", `${keyword} idea: plan next year. https://example.com/idea`);
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
    await wait("document.querySelector('.source-document').value.includes('Voyage brief')");
    await fill(".source-document", "# Reviewed voyage brief\n\nTiming remains a question. Check both sources.");
    await click(button("Export Markdown document"));
    await wait("window.__sourceQA.exports.length>0");
    const exported = await evaluate("window.__sourceQA.exports.at(-1).data");
    await fs.writeFile(path.join(output, `${mode}-document.md`), exported);
    if (!exported.includes("Reviewed voyage brief") || !exported.includes("fragment:") || !exported.includes(`card:${fixtureId}`) || !exported.includes("https://example.com/voyage")) throw new Error("Export lost document or source provenance");
    await click(button("Save document as note"));
    await wait("document.querySelector('.source-workbench [role=status]')?.textContent.includes('Saved as a new note')");
    const saved = await evaluate(`(async()=>{const {db}=await import('/src/db.ts');return (await db.cards.toArray()).filter(c=>c.title==='Reviewed voyage brief'&&c.plainText.includes(${JSON.stringify(fixtureId)})).length})()`);
    if (saved !== 1) throw new Error("Document was not saved");
    await evaluate("window.__sourceQA.invalid=true");
    await click(button("AI compose draft"));
    await wait("document.querySelector('.source-workbench [role=status]')?.textContent.includes('Unverified source quote')");
    if (!await evaluate("document.querySelector('.source-document').value.includes('Reviewed voyage brief')")) throw new Error("Invalid evidence replaced reviewed draft");
    const overflow = await evaluate("document.documentElement.scrollWidth > innerWidth+1");
    if (overflow) throw new Error(`${mode} horizontal overflow`);
    await screenshot(`${mode}.png`);
    const request = await evaluate("window.__sourceQA.requests[0].messages.at(-1).content");
    if (!request.includes("fragment:") || !request.includes(`card:${fixtureId}`)) throw new Error("AI missed selected sources");
    const intact = await evaluate(`(async()=>{const {db}=await import('/src/db.ts');const card=await db.cards.get(${JSON.stringify(fixtureId)});return card.updatedAt===1&&card.plainText.startsWith('x'.repeat(20000));})()`);
    if (!intact) throw new Error("Original source was modified");
    await evaluate("(async()=>{ const {useAppStore}=await import('/src/store.ts');useAppStore.getState().closeRightPanel();})()");
    await wait("!document.querySelector('.source-workbench')");
    await evaluate("(async()=>{ const {useAppStore}=await import('/src/store.ts');useAppStore.getState().openAI();})()");
    await wait("document.querySelector('.source-document')?.value.includes('Reviewed voyage brief')");
    report.push({ mode, width, captured: true, oldLongNoteRetrieved: true, mockedAI: true, badQuoteRejected: true, edited: true, exported: true, saved: true, draftRetained: true, horizontalOverflow: overflow });
  }
  if(errors.length) throw new Error(errors.join("\n"));
  await fs.writeFile(path.join(output, "report.json"), JSON.stringify({ report, errors, realAICalls: 0 }, null, 2));
  console.log(JSON.stringify({ report, errors, realAICalls: 0 }, null, 2));
} catch (error) {
  console.error(await evaluate("({status:document.querySelector('.source-workbench [role=status]')?.textContent, requests:window.__sourceQA?.requests.length, body:document.querySelector('.source-workbench')?.innerText})"));
  await screenshot("failure.png");
  throw error;
} finally { await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`); ws.close(); }
