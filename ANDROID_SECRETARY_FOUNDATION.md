# Android private secretary v2 — draft, device validation pending

This branch stacks on draft PR2 (`f628962af44d6c32361559dab452222af63e718d`), retaining its reviewed capture/search/source-backed document flow and private-data boundary. Latest main was checked at `b1c9e88`. Neither draft is merged or deployed. Android adapters are implemented and compiled; real device acceptance is still pending.

## Delivered slice

The existing Kotlin/WebView app now exposes PR2's fixed private-vault bridge to the packaged HTTPS top-level document. Legacy notes, credentials (`chengjing-credentials-v1`), editing, sync and backups are untouched; no migration or private-data upload occurs. Quick private capture, searchable sources and editable/exportable documents use the existing React flow once the new vault is unlocked.

`SecretaryVault` writes only `filesDir/private-secretary-v2/android-secretary-v2.vault.json`, using a separate Android Keystore AES-256 key (`chengjing-private-secretary-v2`) and authenticated AES-GCM envelope. No raw key file, plaintext fallback or caller-supplied path exists. QA has a separate path-derived alias. UUID/version/protection/revision are authenticated; document size and record structure are validated. AtomicFile writes and revision compare-and-swap protect updates. Missing keys, corrupted ciphertext and unsupported backups fail closed while retaining the original. Unlock is explicit app-session access, without a biometric claim; moving to background, navigation and destruction lock the session. Late private replies/transcripts are discarded.

Encrypted backup/restore matches PR2's preview/cancel/confirm/rollback flow. Confirmation first creates an encrypted checkpoint, then updates the vault. Changes/locking invalidate previews. Android backups require the original app-installation Keystore key; they are not interchangeable with Windows DPAPI backups and cannot recover after uninstall/key loss. They contain no exported key.

The optional Android notification checkbox appears for a future, one-shot, in-app reminder when existing notification capability is available. Changing it invalidates the preview. Only explicit confirmation first creates the encrypted operation, then invokes native scheduling with its ID/fingerprint. Native code rechecks the persisted proposal, original fingerprint fields, task, valid zone/instant, five-minute consent window and current capability. It uses `setAndAllowWhileIdle` (inexact), immutable PendingIntent, non-exported receiver, and generic notification text. No private task body/title enters the OS notification. Native consent/outbox/tombstones remain encrypted and cannot be forged/removed through generic renderer commits. Completing/deleting/cancelling the task or changing its time cancels the native notification; reopening/editing/restoring never silently renews consent. A fresh proposal is needed to schedule again. Restore keeps cancellation tombstones and does not arm restored reminders. Native handoff failures retain the in-app reminder and a review state.

Notifications are best effort, with at most one durable delivery attempt. The file transaction and OS handoff are not atomic; a process interruption can leave a requested/review state or lose delivery. Force-stop/reboot/revocation/device power policy may prevent delivery. There is no boot receiver, repeating native schedule, exact-alarm permission or guarantee of exact/background/lock-screen delivery. The existing in-app reminder/catch-up path remains available.

Android voice uses `createOnDeviceSpeechRecognizer` on API 33+, checking installed language support before starting; only already-granted microphone permission is accepted. There is no permission dialog, model download or cloud-recognizer fallback. Unsupported/denied/unverifiable capability fails closed to typing/paste. Sessions cancel on stop, lock, background and destruction, including pending checks; late results are ignored. A transcript enters editable text and cannot create tasks/reminders without the existing user action/confirmation.

The manifest declares microphone/notification capability and the non-exported receiver, without exact-alarm or boot permissions. This task did not grant any permissions or install either app/test APK on a device.

## Verified evidence (2026-10-08)

| Check | Result / boundary |
| --- | --- |
| Full frontend tests | 46 files / 180 passed, including 8 new Android bridge mock tests |
| Node tests | 80 passed, 1 Windows POSIX-only skip (81 total) |
| Typecheck and React production build | Passed |
| Standalone JDK crypto/URI checks | 24 passed using production cipher/origin classes and synthetic keys/data; not Keystore proof |
| Android baseline | Debug APK and existing AndroidTest Kotlin compiled |
| Full packaged build | Latest React assets staged; debug APK assembled offline |
| Android lint | Passed, 38 warnings reported; no blanket warning cleanup or error suppression |
| Isolated Keystore instrumentation tests | Added and compiled; NOT executed or installed on a device |
| Native adapter responsive QA | 1440×1000 and 390×844 passed through production frontend adapter with mock native calls: capability refusal, consent ordering, destination-change preview invalidation, editable speech and late-result lock cleanup |
| Original source-document flow | Both sizes passed capture, long/old-note retrieval, source validation, edit/export/save and encrypted draft retention; zero real AI calls |

Ignored evidence is under `qa-artifacts/security/android-*.log`, `qa-artifacts/android-native-browser/` and `qa-artifacts/source-workbench-android-head/`. The local deliverable is `android/app/build/outputs/apk/debug/app-debug.apk`, not a production-signed release or device acceptance. Instrumentation covers synthetic restart/lock/CAS, restore conflicts/checkpoints/rollback, ciphertext tamper/key loss, renderer consent forgery rejection and disabled QA notifications. Actual Android Keystore behavior, lifecycle IPC, language-service behavior, background/force-stop/reboot/cancel delivery still require separately authorized device or emulator execution.

## Approved local toolchain

Portable tools live outside Git in sibling `android-tools/`, with process-local environment and caches; no global PATH/registry change or existing session replacement:

- Microsoft OpenJDK 17.0.20.1 x64: official ZIP SHA-256 `3d9006956fc8af5601cd24ffc4f468bef48279c7ebd8171b9bdf90d0aabfbf1f`.
- Gradle 8.14.3: binary ZIP SHA-256 `bd71102213493060956ec229d946beee57158dbd89d0e62b91bca0fa2c5f3531`. Existing wrapper JAR and distribution are checksum-pinned.
- Android command-line tools 22.0: SHA-256 `90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a`.
- `platforms;android-36` revision 2 and `build-tools;36.0.0` installed and verified; the project explicitly pins Build Tools 36.0.0 instead of downloading AGP's default 35.0.0.

The user separately accepted the web download agreement dated 2026-04-28 and the actual standard `android-sdk-license` dated 2019-01-16. Only the matching displayed standard package agreement was accepted once for the two approved packages. No accept-all command, preview license, fabricated hash, platform-tools, adb or emulator installation occurred. Package license UTF-8 SHA-256: `1f8729233617b193fd619213792ae16a41b95d2bbbf525dfe66998252ba68b16`. Actual source: [Google SDK package repository](https://dl.google.com/android/repository/repository2-3.xml); [web agreement](https://developer.android.com/studio/terms). Local source/checksum/acceptance records are in `android-tools/`.

Build dependency preparation used only the existing project's official Google/Maven/Gradle repositories in the task-local cache. Subsequent builds disable SDK auto-download and run offline with a single-use Gradle process. An initial restricted-daemon socket denial was handled by a fresh process in the already approved execution context; no firewall/ACL/system-security changes were made. The Windows build helper now resolves npm's installed JS entrypoint and stages generated assets using Node (no rsync). Browser QA uses an isolated synthetic profile outside Vite's watched checkout; only owned QA processes are closed.

To reproduce with an already installed/cached toolchain: dot-source `../android-tools/env.ps1`, run `node scripts/android-build.mjs`, then Gradle `:app:compileDebugAndroidTestKotlin :app:lintDebug --offline --no-daemon -Pandroid.builder.sdkDownload=false`. Run `node scripts/qa-android-secretary-host.mjs` for synthetic JVM checks. Device tests are not part of these commands.

Official API references: [Keystore](https://developer.android.com/privacy-and-security/keystore), [SpeechRecognizer](https://developer.android.com/reference/android/speech/SpeechRecognizer), [inexact alarms](https://developer.android.com/develop/background-work/services/alarms/schedule). Existing GitHub Windows/Linux mock CI validates tests/types/React build, not Android/device behavior. Native-window Electron IPC also remains independently unverified after the earlier reviewer GPU fixture failure; this Android change does not close that gate.

No private notes, credentials, accounts, paid API, OAuth, phone install, permission grant, legacy migration, merge or deployment was performed. Real device acceptance and cross-device recovery/shared budget coordination remain outside this draft's completed validation.