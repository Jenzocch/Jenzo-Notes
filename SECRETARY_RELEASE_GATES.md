# Secretary release gates and integration decisions

This is a design/acceptance record, not a claim of implemented or device-verified features. Existing encrypted notes, sync, editing and backups remain authoritative. No installed application or private data is modified by this record.

## Punctual audible Android alarms — blocking

The current `setAndAllowWhileIdle` notification is inexact and cannot satisfy punctual ringing (including a fifteen-minute delay). Two official routes are available:

1. Native alarm clock: explicitly confirmed persisted proposal, `AlarmManager.setAlarmClock`, fresh `canScheduleExactAlarms` check immediately before handoff, and separately reviewed audible playback/notification lifecycle. Exact scheduling alone does not play sound. Missing/revoked permission must produce an unavailable/review state, never silent inexact fallback or an “alarm scheduled” claim. No automatic permission grant. Review current platform/Play eligibility before requesting special access; do not assume broad `USE_EXACT_ALARM` eligibility.
2. System Clock handoff: foreground `AlarmClock.ACTION_SET_ALARM` with visible confirmation (`EXTRA_SKIP_UI=false`) and a generic label. This accepts hour/minute and optional weekdays; it is not a general arbitrary-date task API. “Opened Clock for confirmation” is distinct from verified scheduling/delivery. A missing compatible handler fails visibly. It does not supply an app-owned cancellation/receipt protocol.

Official references: [AlarmManager](https://developer.android.com/reference/android/app/AlarmManager), [AlarmClock intents](https://developer.android.com/reference/android/provider/AlarmClock). Native alarm-clock scheduling can trigger in Doze; the application remains responsible for sound and user-facing behavior. Permission revocation deletes exact alarms and requires reconciliation, not a success badge retained indefinitely.

Before release, an authorized physical device/emulator must verify measured ringing latency on the lock screen and in Doze, process death, reboot reconstruction from encrypted confirmed state, permission revocation, timezone/DST changes, completing/deleting/cancelling a task, time edits, duplicate suppression, snooze/repetition limits and stopping sound. Define acceptable latency before acceptance. Force-stop and OS restrictions must remain explicit limitations. No device installation, permission grant or boot/alarm service change is authorized by this document.

The reference screenshot informs compact capture with advanced controls: remember/event/reminder/location, date/time, optional calendar, recurrence, lead time, sound/banner, bounded overdue repeats and completion stopping them. It does not authorize copying its UI or its quotas. Calendar, location and exact alarms require separate capability/permission decisions. Text and editable speech converge on the same proposal and explicit confirmation; no “scheduled” state before persistence and native success.

## Private outbound policy — blocking until separately implemented/reviewed

Private-vault sources and documents derived from them must be denied by default for remote AI, MCP, sync and sharing, independently of the cloud budget switch. Default cloud AI remains paused. A manually confirmed plaintext file export is a one-time disclosure to the selected destination (possibly a cloud-backed folder); it cannot permanently authorize remote use. Source provenance must survive editing and draft persistence. Negative tests must cover mixed private/public sources and attempted policy bypasses.

## Updater and application identity — blocking formal packaging

Current Electron updater defaults still point at Coyoter/chengjing-notes. Desktop and Android still use `tw.techtarian.chengjing`. A formal Jenzo package must first use a separately reviewed identity, own release feed and isolated data directory/Keystore namespace; disable inherited updating until that feed is controlled. Test side-by-side installation and upstream update refusal with synthetic data. Any migration must be opt-in, backed up and reversible; do not overwrite the real installed app or silently relocate notes. This proposal changes no identifiers/feed or installed data.

The code descends from upstream v0.10.0 commit `14d53d84d9dd833ab70d1e628b64498ee9e5f526`. Preserve Coyoter copyright and [LICENSE.md](LICENSE.md), plus third-party notices. The ChengJing Free Use No Resale license permits covered free/internal uses but restricts paid resale; describe it as source-available, not unrestricted open source.

## dot integration — inventory/design only

Use existing local MCP capabilities as a starting point: scoped read-only search and original-source retrieval, proposals first, narrowly confirmed writes later. Keep it disabled while authorization is designed. Do not create a token, listen on a port, open a tunnel or grant data access. Cloud dot cannot directly access an arbitrary localhost endpoint; there is no verified embeddable dot SDK in this implementation.

An eventual authorized connector or desktop task route must let the user select a non-private note scope, return minimal cited excerpts with stable identifiers, and enforce private-source refusal locally. Returned notes leave the local machine for cloud dot; consent must name that destination. Apply read/write scopes, revocation and audit metadata without logging note bodies. Writes require a displayed patch, expected revision and user confirmation; suggestions cannot fabricate source facts. Existing MCP support does not establish that these scope/consent gates are complete.

Obsidian interoperability is currently generic Markdown import/export, not a live vault integration: no preserved vault path/link graph or safe two-way writeback. A future read-only selected-file index should retain relative path/hash/cited ranges with the original file authoritative. Export new files explicitly; do not add competing automatic writeback/sync loops.
