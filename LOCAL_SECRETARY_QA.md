# Local secretary MVP: implementation and acceptance

## Baseline and scope

This independent branch starts at `b1c9e88`, the main merge of phase-one source workbench PR #1 (`b21009e`). PR #1 was already merged when this work began; this task did not merge it. No open competing PR or public Claude review was found at inspection. No claim of a Claude review is made.

The existing source workbench connects quick capture, retrieval across notes and fragments, verified source excerpts, editable document output, Markdown export and saving back to notes. This increment repairs same-tick double submission and preserves quoted Markdown/HTML as literal text. The UI distinguishes quotes validated during generation from subsequently edited drafts. Associations remain evidence candidates, not probabilities or established facts.

The new secretary is accessible from Today, mobile capture and Tasks. It saves typed/pasted text as ordinary notes or tasks, previews a reminder with wall time, IANA zone, resolved instant, recurrence and selected destinations, then creates it only after confirmation. Durable operation IDs deduplicate retries. The in-app banner catches up after reopening. Daily/weekly recurrence follows local wall time; DST gaps/overlaps require review. Cancellation affects the in-app reminder and retains the original task and operation record.

No schema version change, destructive migration, private-note upload, new account, OAuth flow, production deployment or merge is included. Existing notes, editing, sync and backups remain in place. Reminder operations and the mock ledger use existing backed-up preferences; operation state is not part of incremental cross-device sync. Ordinary created tasks use the existing task sync path. Multi-device reminder delivery is not claimed.

## Explicit boundaries

- Voice begins only after a click and requires an already available on-device recognition implementation/language pack. No pack installation or cloud fallback is attempted. Stop, component teardown, unavailable capability and revoked permission are covered with fakes. No native Android speech adapter or real-device microphone acceptance is included.
- Reminders are in-app only, with checks on startup, focus and periodically while open. Background/lock-screen notifications and native alarms are not implemented.
- Drive/Notion fixtures are synthetic and imported only when selected with simulated permission. There is no network transport or actual permission grant.
- Calendar/Clock mocks persist independent outcomes. Successful destinations are not recreated on retry. Clock rejects arbitrary-date one-shot scheduling; recurring clock requests stay awaiting confirmation, never verified-created. Calendar results are independent. Real Android intents, alarm verification and Calendar writes remain unimplemented.
- NT$100/month is a planning target. The atomic local **mock** ledger reserves input + maximum output + retries + FX and a minimum 1.3 buffer; unknown prices, malformed ledgers and overcommit fail closed. It is neither an account-wide coordinator nor a provider billing hard cap, and does not allocate NT$100 to each device.
- Production cloud generation is deliberately paused at renderer, Electron IPC and Android AI entry points until trustworthy pricing and a shared budget coordinator are configured. Existing provider implementation/settings are retained; local Gemma remains available. Connection tests that generate paid tokens are also gated. There is no production/test bypass. The provider retry regression test stubs this gate only within the test process.

## Verification

- `npm run typecheck`: passed.
- Frontend: `npx --no-install vitest run src --environment jsdom --maxWorkers=4`: 43 files, 162 tests passed. Tests cover consent-before-write, concurrent deduplication, operation/payload binding, offline/reopen catch-up, cancellation, weekly alignment, DST boundaries, mock permission/retry/partial success, source selection, atomic budget and voice lifecycle.
- `npm run build`: passed, including existing Gemma bundle verification. Existing dynamic-import/chunk warnings remain.
- `node --test electron/cloud-budget.node.cjs`: passed. Verifies the native cloud gate and its placement before credential/network work.
- Full `npm test` before the final additional malformed-ledger regression: frontend 160 tests passed; Electron 61/62 passed. The unchanged `electron/key-vault.node.cjs:17` expects POSIX mode `0600`, while this Windows environment reports `0666`. The full suite is therefore **not** reported green.
- No lint script is defined. `git diff --check` and Node syntax checks passed.
- `npm run qa:source-workbench` and `npm run qa:secretary`: passed in installed headless Chrome at desktop 1440x1000 and mobile 390x844, with zero runtime errors, real AI calls or real microphone calls. Source workbench covered old/long-note retrieval, validated mock document, cloud fail-closed behavior, manual edit, export, save and retained draft. Secretary covered safe literal note creation, double-click deduplication, mocked local voice, consent, overdue acknowledgement, restart persistence, selected mock import, partial-success retry and atomic reservation.
- Offline QA disables network after application assets are loaded, then exercises local mutations. Network is restored before the development-server page reload. This demonstrates local actions offline, not a packaged-app cold-start or service-worker offline claim.

Browser fixtures live only in a dedicated temporary Chrome profile and use unique synthetic identifiers; scripts do not clear or read a real user's notebook. Artifacts are ignored under `qa-artifacts/secretary/` and `qa-artifacts/source-workbench/`: JSON reports, desktop/mobile screenshots, test/build logs and the exported synthetic Markdown document. Both scripts share `scripts/qa-browser.mjs`, defaulting to loopback Vite port 5173 and a dedicated Chrome CDP port 9237. No browser or runtime was downloaded. Native Android build, packaged Electron, real phone/desktop permissions, lock-screen delivery and external services were not tested because the required native environment/approvals are absent.

## Storage/security assessment and next approval gates

Existing browser IndexedDB notes/preferences and localStorage document drafts are not encrypted at rest. Existing Electron vaults encrypt with a master-key file adjacent to the vault; this is not equivalent to OS-keystore protection. Android SecureStore uses AndroidKeyStore. This branch does not read credentials, migrate private data or claim production-ready encryption. Before enabling new real credentials or changing storage, review OS-protected keys, key lifecycle, versioned opt-in migration and backup/restore compatibility using synthetic data.

Real integrations need explicit approval for the account, destination, exact requested scope and device permission. A real cloud budget also needs a trusted account-wide reservation coordinator and verified provider rates. These are deliberate remaining gates; mocks and in-app delivery must not be represented as completed production connectors or native alarms. PDF text import is not OCR; a YouTube link card is not full-video understanding.
