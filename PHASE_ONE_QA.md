# Phase one: capture → sources → document

Base: `main` at `14d53d84` (v0.10.0). Implemented on the isolated branch
`codex/phase-one-capture-evidence-docs`. No AGENTS.md or .agents/skills were
present in this checkout or its workspace ancestors. At start, origin had only
main and no open PRs.

## Try the flow

1. Open **AI Assistant / Ask AI**, then expand **Source workbench · Search to document**
   (中文：來源工作台 · 搜尋到文件). On Android, AI Assistant is in All features.
2. Paste an idea, source text or URL into **Capture an idea or paste material**.
   **Capture and select** saves a normal fragment through the existing database.
   Existing desktop quick capture, Android share capture and imports remain usable.
3. Search by **Source keywords**. Cards and fragments are searched together, including
   archived cards and old notes. Trash and untouched journal placeholders are excluded.
   Select up to eight excerpts. **Read original** opens full stored text in the panel;
   remove any selected source with its × button.
4. Describe the reader, purpose and format under **Document goal**, or use the source
   comparison goal to compare themes, differences and possible relationships.
5. **Create excerpt document** assembles a local source document with no AI request.
   **AI compose draft** sends only selected excerpts to the configured existing provider
   via runAI. Each returned section must have an exact quote from a selected source.
   Unknown source IDs, invented quotes, missing evidence and malformed JSON are rejected.
   Sources changed/deleted during drafting require re-searching; the previous draft survives.
6. Edit the Markdown body, inspect its source appendix, then **Export Markdown document**
   or **Save document as note**. The new note uses existing editing, sync and backup paths.
   Original notes are never rewritten. Draft body, goal and source snapshots are retained
   locally across panel closure/reload; save as a note for sync and backup coverage.

## Scope and limits

- This is a keyword-based retrieval and document workbench, not a new notes platform.
  Search scans candidates with Dexie cursors and retains the best 24 matches, avoiding
  the previous recent/indexed-candidate cutoff. AI chat's space context now uses the
  same retrieval and includes fragments with stable source keys.
- Excerpts show up to 1,600 characters near a match. They are partial source snapshots,
  not full-library context. Up to eight selected excerpts are sent for drafting.
- Ranking is text relevance, never a calibrated relationship probability.
  A verified quote proves the quoted text exists; it does not prove that an AI inference
  follows from it. Drafts explicitly require review and permit source removal/body edits.
- Source appendix records stable type/ID, original update time, original HTTP(S) source
  URL if available, and exact excerpt snapshot. Pasted URLs in fragments remain in the text.
- Existing 3D brain graph sampling/scoring remains unchanged. Relationships in this slice
  are evidence-backed, editable document comparisons; they do not create persistent graph edges.
- PDF imports still extract available text; no OCR was added. A pasted YouTube URL is
  source text/link, not a claim to understand a complete video.
- No schema migration, new service/account, credential change, private-note migration,
  production deployment, or merge is part of this change.

## Validation (Windows execution host)

- `npm run typecheck`: passed.
- `npm run build`: passed, including bundled Gemma patch verification. Existing
  attachments dynamic-import warning remains.
- `npm test`: frontend **42 files / 145 tests passed**; Electron **60 / 61 passed**.
  The unchanged `electron/key-vault.node.cjs:17` expects POSIX file mode `0600` and
  gets Windows mode `0666` (438 vs 384). The same isolated key-vault test fails on
  this host. This is recorded as an existing Windows limitation, not a green full suite.
- Five new tests cover 510 newer irrelevant candidates, old unindexed long-note tails,
  fragments, trash exclusion, bounded results, exact excerpts/full-width search,
  changed/deleted sources, valid provenance and invalid/missing AI evidence.
- `npm run qa:source-workbench`: real installed Chrome, isolated temporary profile,
  desktop 1440×1000 and Android UI at 390×844. Passed capture/paste → old long-note
  retrieval → source selection → excerpt document → mock AI comparison → edit →
  export payload → saved note, invalid quote rejection, original preservation,
  retained draft after unmount/remount, and no horizontal overflow. Zero real AI calls.
  Provider and native file-save bridge are mocked; this is browser acceptance, not
  physical-device, native save-dialog, packaging or live cross-device sync acceptance.
- Screenshots were visually inspected. Evidence lives under
  `qa-artifacts/source-workbench/` (ignored): report.json, desktop/mobile.png,
  generated Markdown examples, tests.log and build.log.
- No lint command/config exists in package.json. `git diff --check` and the React
  skill review were used in addition to TypeScript and tests.

## Reproduce browser QA without installing software

Use an already installed Chrome/Edge and **a dedicated temporary profile**. Run Vite
with `node node_modules/vite/bin/vite.js --host 127.0.0.1`, then launch the browser with
`--headless=new --no-first-run --disable-background-networking --remote-debugging-port=9237`
and `--user-data-dir=<dedicated temporary QA directory>`. Then run
`npm run qa:source-workbench`. `JENZO_CDP_PORT` and `CHENGJING_URL` can override the
local port/URL; non-loopback URLs are rejected.

The QA runner uses Node's built-in WebSocket/CDP and downloads no browser/packages.
It adds synthetic, per-run QA sources and saved documents through the actual database
and UI; it never clears pre-existing cards or fragments. Keep this profile separate
from daily use because fixture records intentionally remain for inspection.
