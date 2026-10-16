import fs from "node:fs/promises";
import path from "node:path";
process.env.JENZO_QA_OUTPUT = "qa-artifacts/marketing-methods";
const {port,base,output,target,ws,errors,call,evaluate,wait,click,fill,screenshot} = await import("./qa-browser.mjs");
try {
  await call("Page.enable"); await call("Runtime.enable");
  await call("Page.addScriptToEvaluateOnNewDocument", {source: `window.__marketingQA={aiCalls:0};window.chengjing={platform:screen.width<600?'android':'win32',onShortcut:()=>()=>{},ai:{keyStatus:async()=>({configured:false}),listModels:async()=>[],openRouterChat:async()=>{window.__marketingQA.aiCalls++;throw new Error('No AI allowed')}}};`});
  const report=[];
  for(const [mode,width,height] of [["desktop",1440,1000],["mobile",390,844]]) {
    console.log(`QA ${mode} ${width}x${height}`);
    await call("Emulation.setDeviceMetricsOverride",{width,height,deviceScaleFactor:1,mobile:mode==="mobile"});
    await call("Page.navigate",{url:base}); await wait("document.querySelector('.workspace')");
    if(mode==="mobile") {
      await click("document.querySelector('.mobile-header button[aria-label=\"全部功能\"]')");
      await evaluate("[...document.querySelectorAll('.mobile-directory-item')].find(e=>e.textContent.includes('行銷方法庫')).click()");
    } else await evaluate("[...document.querySelectorAll('.primary-nav button')].find(e=>e.textContent.includes('行銷方法庫')).click()");
    await wait("document.querySelector('.marketing-methods-view input')");
    const packsBefore=await evaluate("performance.getEntriesByType('resource').filter(e=>e.name.includes('/thinkwithblack/packs/')).length");
    if(packsBefore!==0)throw new Error(`Method bodies eagerly loaded: ${packsBefore}`);
    await fill(".marketing-methods-view input","只買過一次 回購");
    const result=`[...document.querySelectorAll('.marketing-methods-results button')].find(e=>e.textContent.includes('MK-390'))`;
    await wait(result); await evaluate(`(${result}).click()`); await wait("document.querySelector('.marketing-method-reader h3')?.textContent.includes('第一次回購促進計畫')");
    const packRequests=await evaluate("performance.getEntriesByType('resource').filter(e=>e.name.includes('/thinkwithblack/packs/')).map(e=>e.name)");
    if(packRequests.length>1||!packRequests.some(name=>name.includes('mk-390.md')))throw new Error(`Expected only MK-390 body, got ${JSON.stringify(packRequests)}`);
    if(!await evaluate("document.querySelector('.marketing-method-boundary')?.textContent.includes('不能擴張')&&!document.querySelector('.marketing-method-content script,.marketing-method-content iframe,[onclick]')"))throw new Error("Method authority boundary or sanitization missing");
    await evaluate("document.querySelector('.marketing-method-reader .primary-button').click()");
    await wait("/已保存|已在卡片庫/.test(document.querySelector('.marketing-method-status')?.textContent||'')");
    if(!await evaluate("(async()=>{const {db}=await import('/src/db.ts');return (await db.cards.where('id').startsWith('thinkwithblack:').count())===1})()"))throw new Error("Method card was not saved exactly once");
    await evaluate("(async()=>{const {useAppStore}=await import('/src/store.ts');useAppStore.getState().closeCard()})()");
    await wait("!document.querySelector('.card-focus-layer')");
    await evaluate("document.querySelector('.marketing-method-reader .primary-button').click()");
    await wait("document.querySelector('.marketing-method-status')?.textContent.includes('已在卡片庫')");
    const saved=await evaluate("(async()=>{const {db}=await import('/src/db.ts');const cards=await db.cards.where('id').startsWith('thinkwithblack:').toArray();return cards.map(c=>({id:c.id,sourceUrl:c.sourceUrl,properties:c.properties}))})()");
    if(saved.length!==1||saved[0].properties.sourceLicense!=="MIT"||saved[0].properties.sourceCommit!=="28f0c2ccf0f8581b857f8d1d854d43908acc3656"||!saved[0].sourceUrl.includes("/blob/28f0c2c"))throw new Error("Saved method provenance mismatch");
    await evaluate("(async()=>{const {useAppStore}=await import('/src/store.ts');useAppStore.getState().closeCard()})()");
    await wait("!document.querySelector('.card-focus-layer')");
    await evaluate("document.querySelector('.marketing-methods-view').scrollTo(0,0);document.querySelector('.workspace').scrollTo(0,0)");
    if(await evaluate("document.documentElement.scrollWidth>innerWidth+1"))throw new Error("Horizontal overflow");
    if(await evaluate("window.__marketingQA.aiCalls"))throw new Error("Unexpected AI call");
    const external=await evaluate("performance.getEntriesByType('resource').map(e=>e.name).filter(name=>!new URL(name).hostname.match(/^(127\\.0\\.0\\.1|localhost)$/))");
    if(external.length)throw new Error(`Unexpected external request: ${external.join(', ')}`);
    await screenshot(`${mode}.png`);
    report.push({mode,width,catalogCount:365,searchSelected:"MK-390",lazyBodyCount:packRequests.length,sourceCommitVerified:true,licenseVerified:true,duplicateSavePrevented:true,noExternalRequests:true,noAICalls:true,noHorizontalOverflow:true});
  }
  if(errors.length)throw new Error(errors.join("\n"));
  await fs.writeFile(path.join(output,"report.json"),JSON.stringify({report,errors},null,2)); console.log(JSON.stringify(report,null,2));
}catch(error){console.error(await evaluate("document.querySelector('.marketing-methods-view')?.innerText"));await screenshot("failure.png");throw error;}
finally{await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`);ws.close();}
