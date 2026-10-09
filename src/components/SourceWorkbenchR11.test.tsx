import 'fake-indexeddb/auto';
import { Blob as NodeBlob } from 'node:buffer';
import { webcrypto } from 'node:crypto';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect,it,vi } from 'vitest';
import { SourceWorkbench } from '../components/SourceWorkbench';
import { db } from '../db';
import { collectImage,readImageIdea,reviseImage } from '../lib/imageIdeas';
import { searchNoteSources,sourcesStillCurrent } from '../lib/sourceWorkbench';
import { mockSecretaryVault } from '../lib/secureSecretary.fixture';
import { unlockSecureVault,lockSecureVault } from '../lib/secureSecretary';
vi.mock('../hooks/useI18n',()=>({useI18n:()=>({language:'en'})}));
vi.mock('../components/SecureVaultControls',()=>({SecureVaultControls:()=>null}));
vi.mock('../lib/ai',()=>({runAI:vi.fn()}));
it.each(['delete-original','correct-text'])('R11: source workbench disables stale image exports and preserves draft after %s',async mode=>{
 Object.defineProperty(crypto,'subtle',{configurable:true,value:webcrypto.subtle});(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
 await db.open();await db.transaction('rw',db.tables,async()=>{for(const table of db.tables)await table.clear();});
 const {card}=await collectImage('synthetic.png',new NodeBlob(['original'],{type:'image/png'}) as unknown as Blob,{annotation:'ZT-82 collection reason',sourceUrl:'',sourceDate:'',rawText:'ZT-82 OLD ORIGINAL TRANSCRIPTION',correctedText:'ZT-82 OLD ORIGINAL TRANSCRIPTION',reviewed:true,engine:'manual',language:''});
 const hit=(await searchNoteSources('ZT-82','en',24,false))[0];
 const save=vi.fn(async()=>({canceled:false}));const bridge=mockSecretaryVault();window.chengjing={secretaryVault:bridge,files:{save}} as unknown as NonNullable<Window['chengjing']>;await unlockSecureVault();
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 const settle=async (run:()=>unknown)=>act(async()=>{await run();await new Promise(resolve=>setTimeout(resolve,20));});
 const wait=async (predicate:()=>boolean)=>{for(let i=0;i<100&&!predicate();i++)await settle(()=>{});expect(predicate()).toBe(true);};
 const button=(name:string)=>[...host.querySelectorAll('button')].find(b=>b.textContent===name)!;
 const click=async(name:string)=>{await wait(()=>!!button(name)&&!button(name).disabled);await settle(()=>button(name).click());};
 const fill=async(selector:string,value:string)=>settle(()=>{const element=host.querySelector(selector)!;const prototype=element.tagName==='INPUT'?HTMLInputElement.prototype:HTMLTextAreaElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value')!.set!.call(element,value);element.dispatchEvent(new Event('input',{bubbles:true}));});
 try{
  await settle(()=>root.render(<SourceWorkbench/>));await fill('.source-workbench > form input','ZT-82');await click('Search sources');await wait(()=>!!host.querySelector('.source-results input[type=checkbox]'));
  await settle(()=> (host.querySelector('.source-results input[type=checkbox]') as HTMLInputElement).click());await fill('.source-selection + label textarea','Synthetic image excerpt document');await click('Create excerpt document');await wait(()=>!!host.querySelector('.source-document'));
  const snapshot=(host.querySelector('.source-document') as HTMLTextAreaElement).value;
  if(mode==='delete-original')await settle(()=>db.attachments.delete(readImageIdea(card)!.attachmentId));
  else await settle(()=>reviseImage(card,{annotation:'ZT-82 collection reason',sourceUrl:'',sourceDate:'',correctedText:'ZT-82 NEW CORRECTED TRANSCRIPTION',reviewed:true}));
  expect(await sourcesStillCurrent([hit])).toBe(false);
  await wait(()=>button('Export Markdown document').disabled);vi.spyOn(window,'confirm').mockReturnValue(true);await settle(()=>button('Export Markdown document').click());
  expect(save).not.toHaveBeenCalled();expect(button('Save document as note').disabled).toBe(true);expect(button('Save encrypted draft').disabled).toBe(true);expect((host.querySelector('.source-document') as HTMLTextAreaElement).value).toBe(snapshot);expect(host.textContent).toContain('OLD ORIGINAL TRANSCRIPTION');
  expect(host.querySelector('[role=alert]')?.textContent).toContain('Draft retained; save/export paused');
 }finally{await settle(()=>root.unmount());host.remove();vi.restoreAllMocks();await lockSecureVault();window.chengjing=undefined;}
});
