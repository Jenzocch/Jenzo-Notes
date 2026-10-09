import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
if(process.platform!=='win32')throw new Error('Synthetic native OCR fixtures use installed Windows System.Drawing; no installation or cloud fallback.');
await fs.mkdir('qa-artifacts/image-ideas',{recursive:true});
const script=await fs.readFile(new URL('./make-fixture.ps1',import.meta.url),'utf8');
execFileSync(path.join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,timeout:30000});
