import { createServer } from 'vite';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
const require = createRequire(import.meta.url);
const ocr = require('../../electron/local-ocr.cjs');
const port = 5190;
const origin = `http://127.0.0.1:${port}`;
const server = await createServer({ server: {host:'127.0.0.1',port,strictPort:true}, plugins:[{name:'selected-image-local-ocr',configureServer(vite){
 vite.middlewares.use(async(req,res,next)=>{
  if(!req.url?.startsWith('/__image_ocr/')) return next();
  res.setHeader('Content-Type','application/json'); res.setHeader('Cache-Control','no-store');
  const finish = (status,body)=>{res.statusCode=status;res.end(JSON.stringify(body));};
  if(req.headers.host!==`127.0.0.1:${port}` || !['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress) || req.headers['sec-fetch-site']!=='same-origin') return finish(403,{error:'same-origin-only'});
  try {
   if(req.url==='/__image_ocr/status' && req.method==='GET') return finish(200,await ocr.status());
   if(req.url!=='/__image_ocr/recognize' || req.method!=='POST' || req.headers.origin!==origin || req.headers['content-type']!=='application/json') return finish(403,{error:'explicit-same-origin-json-only'});
   let bytes=0;const chunks=[];
   for await (const chunk of req){bytes+=chunk.length;if(bytes>14*1024*1024+1000)return finish(413,{error:'image-too-large'});chunks.push(chunk);}
   const result = await ocr.recognize(JSON.parse(Buffer.concat(chunks).toString('utf8')));
   return finish(200,result);
  }catch{return finish(400,{error:'ocr-unavailable-or-image-invalid'});}
 });
 }}]});
await server.listen();
await fs.mkdir(path.resolve('qa-artifacts/image-trial'), {recursive:true});
await fs.writeFile(path.resolve('qa-artifacts/image-trial/server-state.json'),JSON.stringify({pid:process.pid,port,origin,cwd:process.cwd()},null,2));
console.log(`${origin}/scripts/image-trial/`);
