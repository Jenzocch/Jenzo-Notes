const { execFile } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
function invoke(args) {
  if (process.platform !== 'win32') return Promise.reject(new Error('ocr-unavailable'));
  // Execute our bundled, fixed script as a command; never change execution
  // policy. JSON arguments are base64 encoded, never interpreted as code.
  const request = Buffer.from(JSON.stringify({ ImagePath: args[1] || '', Language: args[3] || '' })).toString('base64');
  const script = require('node:fs').readFileSync(path.join(__dirname, 'local-ocr.ps1'), 'utf8');
  const command = `$r = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${request}')) | ConvertFrom-Json; & { ${script} } -ImagePath $r.ImagePath -Language $r.Language`;
  return new Promise((resolve, reject) => execFile(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
    if (error) return reject(new Error('ocr-failed-or-language-unavailable'));
    try { resolve(JSON.parse(stdout.replace(/^\uFEFF/, '').trim())); } catch { reject(new Error('ocr-invalid-result')); }
  }));
}
exports.status = async () => process.platform === 'win32' ? invoke([]) : { languages: [], engine: 'unavailable' };
exports.recognize = async (request) => {
  if (!request || typeof request.language !== 'string' || !/^[a-z]{2,3}(?:-[A-Za-z]{2,8}){0,3}$/.test(request.language)) throw new Error('ocr-invalid-language');
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(request.mime) || typeof request.data !== 'string' || request.data.length > 14 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(request.data)) throw new Error('ocr-invalid-image');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'jenzo-ocr-'));
  try {
    const file = path.join(directory, 'selected-image');
    await fs.writeFile(file, Buffer.from(request.data, 'base64'), { mode: 0o600 });
    return await invoke(['-ImagePath', file, '-Language', request.language]);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
};
