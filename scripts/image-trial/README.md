# Selected-image local trial (Windows)

Uses the installed Windows OCR API, Node, Chrome and the repository's locked Vite dependencies. No new OCR package, model, language pack, account, credentials, or execution-policy changes. This is a trial-only loopback adapter; the shipped desktop app uses the preload IPC adapter.

From the repository root:

```powershell
node scripts/image-trial/make-fixtures.mjs
node scripts/image-trial/server.mjs
```

Open `http://127.0.0.1:5190/scripts/image-trial/`. This browser origin has its own IndexedDB and does not import the original app's notes, sync, AI, or private vault. Use synthetic/non-private pictures only. Close the Node process with Ctrl+C when launched in a terminal. No autostart or persistent service.

1. Download a synthetic screenshot, choose it, and explicitly acknowledge ordinary-note storage.
2. Run local OCR, record why you saved it, and collect. Unreviewed OCR is searchable but excluded from evidence. Recollecting the same image opens the existing record without changing its annotation.
3. Open the collected original, correct its transcription, explicitly check it against the image, and save a revision. Raw OCR and prior revisions remain available in properties/backup.
4. Open cross-source investigation, retrieve `ZT-82`, build a local quote outline, check original passages, and accept/reject proposed associations. Public graph writes require acceptance. Export requires plaintext confirmation. Real private task confirmation remains unavailable in this browser trial because it has no OS vault; the existing isolated memory task sample remains available.

For automated browser checks, launch an installed Chrome with an isolated temporary profile and remote-debugging port 9246 (no browser download), then:

```powershell
$env:JENZO_CDP_PORT='9246'
$env:CHENGJING_URL='http://127.0.0.1:5190'
$env:JENZO_QA_OUTPUT='qa-artifacts/image-ideas/browser'
node scripts/qa-image-ideas.mjs
node scripts/qa-image-entry.mjs
```

The adapter accepts only same-origin loopback requests; OCR accepts bounded PNG/JPEG/WebP bytes rather than filesystem paths. Temporary OCR files are removed after success/failure/timeout. Cancellation discards late results; Windows recognition may finish in the background before temporary-file cleanup. This is not an ACL audit, Android device test, or proof of Electron IPC acceptance. Indonesian in this environment uses installed `en-US` with explicit correction; no dedicated Indonesian support is claimed.
