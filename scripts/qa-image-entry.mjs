import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {base,output,ws,errors,call,evaluate,wait,click,fill,screenshot} from './qa-browser.mjs';
import {qaPrivateVaultSource} from './qa-private-vault.mjs';
const report=[];const timeout=setTimeout(()=>{console.error('Image entry QA timeout');process.exit(1)},120000);
try {
 await call('Runtime.enable');await call('Page.enable');await call('Page.bringToFront');await call('DOM.enable');
 await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 const data=(await fs.readFile('qa-artifacts/image-ideas/zh.png')).toString('base64');
 await call('Page.addScriptToEvaluateOnNewDocument',{source:qaPrivateVaultSource+`
 window.__imageEntryAI=0;window.__imageEntryPicker=0;
 window.chengjing={platform:screen.width<600?'android':'win32',secretaryVault:window.__qaPrivateVaultBridge,onShortcut:()=>()=>{},files:{open:async()=>{window.__imageEntryPicker++;return {canceled:false,files:[{name:'synthetic-entry.png',path:'/synthetic-original.png',data:${JSON.stringify(data)}}]};}},ai:{keyStatus:async()=>({configured:false}),listModels:async()=>[],openRouterChat:async()=>{window.__imageEntryAI++;throw new Error('No AI allowed in QA');}}};`});
 for(const [name,width,height] of [['desktop',1440,1000],['mobile-layout',390,844]]){
  await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});
  await call('Page.navigate',{url:base});await wait(`document.querySelector('.app-shell') || document.querySelector('.workspace')`);
  await evaluate(`(async()=>{const {db}=await import('/src/db.ts');await db.cards.where('kind').equals('image').delete();await db.attachments.clear();await db.brainEdges.clear();const {useAppStore}=await import('/src/store.ts');useAppStore.setState({language:'zh-TW'});useAppStore.getState().setCreateCardOpen(true);})()`);
  await wait(`document.querySelector('.create-card-fields')`);
  await click(`[...document.querySelectorAll('.create-card-fields button')].find(el=>el.textContent.includes('+ idea'))`);
  await wait(`document.querySelector('.image-idea-capture')`);
  await click(`document.querySelector('.image-idea-capture input[type=checkbox]')`);
  if(width<600){await click(`[...document.querySelectorAll('.image-idea-capture button')].find(el=>el.textContent==='從手機選擇圖片')`);}
  else {const {root}=await call('DOM.getDocument');const {nodeId}=await call('DOM.querySelector',{nodeId:root.nodeId,selector:'.image-idea-capture input[type=file]'});await call('DOM.setFileInputFiles',{nodeId,files:[path.resolve('qa-artifacts/image-ideas/zh.png')]});}
  await wait(`document.querySelector('.image-idea-capture img')`);
  await fill('.image-idea-capture textarea[rows="3"]','SharedEntry ZT-82 合成圖片收藏想法');
  await click(`[...document.querySelectorAll('.image-idea-capture button')].find(el=>el.textContent==='收藏圖片與想法')`);
  await wait(`!document.querySelector('.unified-create-modal')`);
  await wait(`document.querySelector('.card-panel-content')`);
  await evaluate(`(async()=>{const {useAppStore}=await import('/src/store.ts');const {db}=await import('/src/db.ts');const {localEvidenceRepository}=await import('/src/lib/investigationEvidence.ts');const id=useAppStore.getState().selectedCardId;const source=await localEvidenceRepository.resolve('card:'+id);if(!source?.text.includes('SharedEntry'))throw new Error('Shared collection source invalid');const card=await db.cards.get(id);if(card.kind!=='image'||!card.attachmentIds.length)throw new Error('Original missing');})()`);
  await click(`[...document.querySelectorAll('.panel-tabs button')].find(el=>el.textContent.includes('資訊'))`);
  await wait(`document.querySelector('.card-info-panel .image-idea-capture')`);
  await screenshot('entry-'+name+'.png');
  assert.equal(await evaluate('window.__imageEntryAI'),0);
  report.push({name,width,height,sharedEntry:true,originalRetained:true,canonicalSourceValidAfterEditorOpen:true,phonePicker:width<600?'existing native API mocked; not device acceptance':'HTML file input',aiCalls:0});
 }
 // Android native startup console messages are not native-device proof.
 assert.deepEqual(errors,[]);await fs.writeFile(path.join(output,'entry-report.json'),JSON.stringify({report,exceptions:errors,nativeDeviceAcceptance:false},null,2));console.log(JSON.stringify(report,null,2));
}finally{clearTimeout(timeout);ws.close();}
