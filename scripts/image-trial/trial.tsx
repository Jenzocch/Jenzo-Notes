import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {useLiveQuery} from 'dexie-react-hooks';
import {ImageIdeaCapture} from '../../src/components/ImageIdeaCapture';
import {EvidenceInvestigation} from '../../src/components/EvidenceInvestigation';
import {db} from '../../src/db';
import {searchNoteSources} from '../../src/lib/sourceWorkbench';
import {imageIdeaKey} from '../../src/lib/imageIdeas';
import {useAppStore} from '../../src/store';
import '../../src/styles.css';
import './trial.css';
async function json(url:string,body?:unknown){const response=await fetch(url,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined);if(!response.ok)throw new Error('Local OCR unavailable / 本機辨識失敗，可手動輸入');return response.json();}
Object.defineProperty(window,'chengjing',{configurable:false,writable:false,value:Object.freeze({attachments:Object.freeze({ocrStatus:()=>json('/__image_ocr/status'),recognizeImage:(request:unknown)=>json('/__image_ocr/recognize',request)})})});
useAppStore.setState({language:'zh-TW',theme:'light'});document.documentElement.dataset.theme='light';
function Trial(){
 const cards=useLiveQuery(()=>db.cards.where('kind').equals('image').filter(card=>card.state!=='trash'&&card.properties[imageIdeaKey]!=null).toArray(),[],[]);
 const [selected,setSelected]=useState('');const [query,setQuery]=useState('');const [hits,setHits]=useState<any[]>([]);
 const card=cards.find(card=>card.id===selected);
 return <main><h1>Jenzo 圖片與想法試用</h1><p>獨立本機試用空間，不連接原有筆記、同步、AI 或私人保險箱。請使用非私密圖片；此網址的資料只留在瀏覽器。手機版為此電腦上的窄螢幕驗收，不是手機原生 OCR。</p><a href="/qa-artifacts/image-ideas/zh.png" download>下載合成繁中截圖</a> · <a href="/qa-artifacts/image-ideas/id.png" download>下載合成印尼文截圖</a><ImageIdeaCapture key="capture" onSaved={card=>setSelected(card.id)}/><section><h2>找回收藏</h2><label>搜尋文字或收藏原因<input value={query} onChange={event=>setQuery(event.target.value)}/></label><button onClick={()=>void searchNoteSources(query,'zh-TW',24,false).then(setHits)}>搜尋收藏</button><ul>{hits.map(hit=><li key={hit.key}><button onClick={()=>setSelected(hit.id)}>{hit.title}</button><pre>{hit.excerpt}</pre></li>)}</ul><h3>已收藏 {cards.length} 張圖片</h3>{cards.map(card=><button key={card.id} onClick={()=>setSelected(card.id)}>{card.title}</button>)}</section>{card&&<section><h2>原圖與校正</h2><ImageIdeaCapture key={card.id} card={card}/></section>}<EvidenceInvestigation/><footer>Windows 本機 OCR 實作；無印尼文專用語言包。未校正文不可當引用證據，校正也不代表內容是真實事實。尚未支援視覺含義理解、手機原生 OCR 或私人圖片儲存。</footer></main>;
}
createRoot(document.getElementById('root')!).render(<Trial/>);
