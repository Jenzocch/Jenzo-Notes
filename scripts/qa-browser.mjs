// Uses an already-installed Chrome/Edge launched with an isolated profile and
// --headless=new --remote-debugging-port=9237. No browser/package downloads.
import fs from "node:fs/promises";
import path from "node:path";
const port = process.env.JENZO_CDP_PORT || "9237";
const base = process.env.CHENGJING_URL || "http://127.0.0.1:5173";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(base).hostname)) throw new Error("QA requires a localhost development server");
const output = path.resolve(process.env.JENZO_QA_OUTPUT || "qa-artifacts/source-workbench");
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
export {port,base,output,target,ws,errors,call,evaluate,wait,click,fill,screenshot};
