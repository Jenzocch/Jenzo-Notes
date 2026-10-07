// Synthetic-only migration harness. Not registered in IPC, preload or app startup.
// Real legacy migration remains an explicitly reviewed future operation.
const { createHash } = require("node:crypto");
const { validateData } = require("./secretary-vault.cjs");
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function convertSyntheticLegacy(source) {
  if (source?.format !== "chengjing-secretary-legacy" || source.version !== 1 || source.synthetic !== true || !Array.isArray(source.items) || !Array.isArray(source.operations) || source.items.length > 2000 || source.operations.length > 1000) throw new Error("migration-only-supports-explicit-synthetic-v1");
  const entries = {};
  for (const item of source.items) {
    if (!item || !/^[\w-]{8,100}$/.test(item.id) || !["note", "task"].includes(item.kind) || typeof item.title !== "string" || typeof item.plainText !== "string" || item.plainText.length > 128000 || !Number.isFinite(item.createdAt) || !Number.isFinite(item.updatedAt)) throw new Error("migration-invalid-item");
    const key = `secretary-item:${item.id}`; if (entries[key]) throw new Error("migration-duplicate-id"); entries[key] = { ...structuredClone(item), done: item.done === true };
  }
  for (const operation of source.operations) {
    if (!operation || !/^[\w-]{8,100}$/.test(operation.id)) throw new Error("migration-invalid-operation");
    // Retain original evidence but never reactivate old consent or alarm state.
    const key = `secretary-legacy-operation:${operation.id}`; if (entries[key]) throw new Error("migration-duplicate-id");
    entries[key] = { original: structuredClone(operation), status: "needs-manual-reconfirmation" };
  }
  if (source.draft !== undefined) {
    if (source.draft?.version !== 1 || typeof source.draft.goal !== "string" || typeof source.draft.draft !== "string" || !Array.isArray(source.draft.sources) || source.draft.sources.length > 8) throw new Error("migration-invalid-draft");
    entries["source-draft-v2"] = { ...structuredClone(source.draft), version: 2 };
  }
  return validateData({ version: 2, entries });
}
async function previewSyntheticMigration(vault, source) {
  const data = convertSyntheticLegacy(source); const current = await vault.read();
  for (const key of Object.keys(data.entries)) if (Object.hasOwn(current.data.entries, key)) throw new Error("migration-target-collision");
  return { fromVersion: 1, toVersion: 2, sourceDigest: digest(source), expectedRevision: current.revision, issuedAt: Date.now(), expiresAt: Date.now() + 300000, itemCount: source.items.length, operationCount: source.operations.length, requiresManualReminderReconfirmation: true, cancelled: false };
}
function cancelSyntheticMigration(preview) { preview.cancelled = true; }
async function confirmSyntheticMigration(vault, preview, source, confirmed) {
  if (!confirmed || preview.cancelled || Date.now() > preview.expiresAt || preview.sourceDigest !== digest(source)) throw new Error("migration-requires-fresh-explicit-confirmation");
  const converted = convertSyntheticLegacy(source); const current = await vault.read();
  if (current.revision !== preview.expectedRevision) throw new Error("migration-target-changed");
  for (const key of Object.keys(converted.entries)) if (Object.hasOwn(current.data.entries, key)) throw new Error("migration-target-collision");
  if (Object.hasOwn(current.data.entries, "migration-source-v1")) throw new Error("migration-already-recorded");
  const data = validateData({ version: 2, entries: { ...current.data.entries, ...converted.entries, "migration-source-v1": { source: structuredClone(source), sourceDigest: preview.sourceDigest } } });
  const checkpoint = await vault.checkpoint(); // Failure must stop before any mutation.
  await vault.commit({ expectedRevision: current.revision, data }); preview.cancelled = true;
  return { ...checkpoint, sourceDigest: preview.sourceDigest, originalSourceRetained: true };
}
module.exports = { previewSyntheticMigration, cancelSyntheticMigration, confirmSyntheticMigration };
