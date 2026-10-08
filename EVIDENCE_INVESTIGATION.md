# Cross-source evidence to action

Dependent on draft PR #3, base `b976dacf5e0585d7b88107cc774c20d601aab245`.
This slice extends the existing source workbench and relationship graph. It does
not add a service, migration, model, account or live integration.

## Try it

Open AI → source workbench → Cross-source investigation. Enter a question or
identifier, retrieve related passages, select sources, and build a local evidence
outline. This uses existing cards, quick fragments and unlocked private notes.
Retrieval examines full text, including old notes and long-note tails. It runs at
most two rounds with eight identifier expansions and twelve selected sources;
the displayed reason explains a match, not causality or exhaustive coverage.

Read a current original to locate each exact quotation. A reference records source
key, scope, privacy, revision, SHA256 and UTF-16 span. Edit interpretations, add
an inference/apparent conflict/missing-evidence item with selected original
passages, accept/reject relationship proposals, and edit task title, rationale and
supporting findings. Facts are original quotations; a suggested cause stays an
unverified inference. Conflicts need two different sources.

Save the investigation in the existing encrypted private vault, or explicitly
confirm an inert plaintext Markdown export. Preview and separately confirm a
private secretary task. Task input status and original references can be reviewed
in the secretary. These tasks do not schedule alarms. Accepted public-only
relationships may be explicitly added to the existing graph/legacy sync; their
context menu provides original-source evidence. Private inputs block public graph
publication, including private inputs that no finding quotes.

Source changes, deletion, changed scope/privacy, invalid quotes and vault lock
invalidate subsequent save/export/task/publication. Drafts retain their entire
input manifest even after citations are edited/removed. A task preview from a
previous vault session cannot be reused after lock and unlock. Existing confirmed
tasks remain editable/completable; their input status warns when evidence needs
review. Previously explicitly exported public snapshots are not retroactively
retracted from external recipients.

## Isolated FG-17 case

Open the explicitly labeled synthetic case for QC, approved SOP, maintenance,
raw-material ledger, complaint, meeting, old long archive and unapproved SOP draft.
The mock proposal demonstrates recorded facts, a possible factor, an apparent
QC/SOP conflict and a selected-scope certificate gap. SOP proposals are not
approvals, commercial discussion is not technical proof, and absent selected
evidence is not proof that a record does not exist elsewhere.

Synthetic sources, saved drafts and confirmed tasks live only in that repository's
memory. They never enter real notes, the vault, legacy sync or the public graph.
Closing/restarting the case discards it. Its private-source switch simulates
access; it is not OS authentication. Source-change/deletion controls demonstrate
invalidation. Mock composition is restricted to this isolated case. General local
notes use original-quote outlines and human classification; there is no production
AI analysis call or promise of automatic causal discovery.

## Validation and remaining boundaries

R10 adds a dispatch-time persistence guard. Every awaited vault snapshot read
(including a CAS retry) is followed by fresh source validation before constructing
the draft/task records. Source writes/deletions and vault lock revoke the pending
operation; a final synchronous assertion runs immediately before native commit.
Even a source edited then restored while preparation waits requires a fresh
preview. Failure revokes the task preview and creates neither task nor metadata.
All inputs are monitored, including unquoted private inputs. Private-vault writes
may conservatively cancel another pending private-source operation; explicitly
retry with a fresh preview. Existing confirmed tasks are not removed.

Export also revalidates after explicit consent and before file-save/download
dispatch. These guards do not provide a distributed transaction between IndexedDB
and native IO: a source changed after commit/file-save dispatch is not a rollback
of that already-dispatched operation. Native vault CAS/session checks still apply;
existing task evidence status exposes subsequent changes. Graph writes retain
their existing source re-read and public-scope checks inside the IndexedDB
transaction. No native permission or bridge/schema change is introduced.

`src/lib/investigation.test.ts` covers retrieval, full-text tails, both-end quotes,
forged/unselected citations, same-source conflicts, retained unquoted privacy,
manifest tampering, isolated persistence, changed/deleted/locked sources, task
deduplication, opaque previews, and lock/unlock session revocation.
`src/lib/investigationRaces.test.ts` covers the delayed-read deletion
counterexample, edited/restored sources, fragments, lock/unlock, final multi-source
checks, CAS retries, unquoted private input changes, draft persistence and export
consent races, alongside valid confirmation/deduplication. Component tests
cover visible invalidation and sandbox disposal. `scripts/qa-investigation.mjs`
uses synthetic fixtures and an installed isolated browser at desktop/mobile sizes;
it checks consent, inert export with provenance, evidence invalidation and existing
local encrypted-draft/private-task/public-graph persistence paths.

No new native Android proof: browser mock acceptance does not prove actual
Keystore, WebView lifecycle, device speech or notifications. The open release
gates in `SECRETARY_RELEASE_GATES.md` still apply. No merge, deployment, updater
identity switch, corporate ACL connector, new OAuth/account, real-data ingestion,
paid API, model download, cross-system execution or MCP enablement occurred.
The existing project has no frontend lint script; TypeScript, mock tests/build
and the React hooks/accessibility/cleanup review are the applicable checks.
