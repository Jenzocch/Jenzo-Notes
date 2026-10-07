const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const LIMIT = 2 * 1024 * 1024;
const FORMAT = "chengjing-secretary-vault";

function validateData(data) {
  if (!data || data.version !== 2 || !data.entries || Array.isArray(data.entries) || typeof data.entries !== "object" || Object.keys(data.entries).length > 4096) throw new Error("vault-invalid-data");
  for (const key of Object.keys(data.entries)) if (!/^(secretary-[\w:-]{1,150}|source-draft-v2|migration-source-v1)$/.test(key)) throw new Error("vault-invalid-entry");
  const validDate = value => Number.isFinite(value) && Number.isFinite(new Date(value).getTime());
  for (const [key, value] of Object.entries(data.entries)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("vault-invalid-record");
    if (key.startsWith("secretary-item:")) {
      if (typeof value.id !== "string" || key !== `secretary-item:${value.id}` || !["note", "task"].includes(value.kind) || typeof value.title !== "string" || value.title.length > 2000 || typeof value.plainText !== "string" || value.plainText.length > 128000 || typeof value.done !== "boolean" || !validDate(value.createdAt) || !validDate(value.updatedAt) || (value.dueAt !== undefined && !validDate(value.dueAt))) throw new Error("vault-invalid-private-item");
    } else if (key.startsWith("secretary-operation:")) {
      if (typeof value.id !== "string" || key !== `secretary-operation:${value.id}` || typeof value.taskId !== "string" || typeof value.title !== "string" || value.title.length > 2000 || typeof value.proposalFingerprint !== "string" || !["scheduled", "due", "done", "needs-review", "cancelled"].includes(value.status) || !["once", "daily", "weekly"].includes(value.repeat) || !validDate(value.nextDueAt) || typeof value.wallTime !== "string" || typeof value.timeZone !== "string" || !Array.isArray(value.destinations) || !value.destinationsState || typeof value.destinationsState !== "object") throw new Error("vault-invalid-reminder");
      try { new Intl.DateTimeFormat("en", { timeZone: value.timeZone }).format(value.nextDueAt); } catch { throw new Error("vault-invalid-reminder-zone"); }
    } else if (key === "source-draft-v2") {
      if (value.version !== 2 || typeof value.goal !== "string" || typeof value.draft !== "string" || !Array.isArray(value.sources) || value.sources.length > 8 || value.sources.some(source => !source || !["card", "fragment", "private"].includes(source.type) || typeof source.key !== "string" || typeof source.id !== "string" || typeof source.title !== "string" || typeof source.excerpt !== "string" || !validDate(source.updatedAt))) throw new Error("vault-invalid-draft");
    }
  }
  const encoded = JSON.stringify(data);
  if (Buffer.byteLength(encoded) > LIMIT) throw new Error("vault-size-limit");
  return JSON.parse(encoded);
}
function createWindowsKeyAdapter(safeStorage, platform = process.platform) {
  const available = () => { try { return platform === "win32" && typeof safeStorage?.encryptString === "function" && typeof safeStorage?.decryptString === "function" && safeStorage.isEncryptionAvailable?.() === true; } catch { return false; } };
  const requireAvailable = () => { if (!available()) throw new Error("vault-os-protection-unavailable"); };
  return {
    available,
    wrap(key) { requireAvailable(); const result = safeStorage.encryptString(key.toString("hex")); if (!Buffer.isBuffer(result) || !result.length || result.equals(Buffer.from(key.toString("hex")))) throw new Error("vault-key-wrap-failed"); return result; },
    unwrap(wrapped) { requireAvailable(); const text = safeStorage.decryptString(wrapped); if (!/^[a-f0-9]{64}$/.test(text)) throw new Error("vault-key-invalid"); return Buffer.from(text, "hex"); },
  };
}
function bytes(value, size) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error("vault-invalid-envelope");
  const result = Buffer.from(value, "base64");
  if (!result.length || (size && result.length !== size) || result.toString("base64") !== value) throw new Error("vault-invalid-envelope");
  return result;
}
function parseEnvelope(raw) {
  if (typeof raw !== "string" || Buffer.byteLength(raw) > LIMIT * 2) throw new Error("vault-invalid-envelope");
  const value = JSON.parse(raw);
  if (value.format !== FORMAT || value.version !== 2 || value.protection !== "windows-dpapi" || !/^[a-f0-9-]{36}$/.test(value.id) || !Number.isSafeInteger(value.revision) || value.revision < 0) throw new Error("vault-unsupported-envelope");
  bytes(value.wrappedKey); bytes(value.iv, 12); bytes(value.tag, 16); bytes(value.ciphertext);
  return value;
}
const aad = envelope => Buffer.from(JSON.stringify([FORMAT, 2, envelope.protection, envelope.id, envelope.revision, envelope.wrappedKey]));
function seal(key, wrappedKey, id, revision, data) {
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error("vault-revision-exhausted");
  const iv = crypto.randomBytes(12);
  const envelope = { format: FORMAT, version: 2, protection: "windows-dpapi", id, revision, wrappedKey: wrappedKey.toString("base64"), iv: iv.toString("base64") };
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv); cipher.setAAD(aad(envelope));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(validateData(data))), cipher.final()]);
  return JSON.stringify({ ...envelope, tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") });
}
function open(adapter, raw) {
  const envelope = parseEnvelope(raw); const key = adapter.unwrap(bytes(envelope.wrappedKey));
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, bytes(envelope.iv, 12)); decipher.setAAD(aad(envelope)); decipher.setAuthTag(bytes(envelope.tag, 16));
    const data = validateData(JSON.parse(Buffer.concat([decipher.update(bytes(envelope.ciphertext)), decipher.final()]).toString("utf8")));
    return { envelope, key, data };
  } catch { key.fill(0); throw new Error("vault-unreadable-original-retained"); }
}
async function atomicWrite(destination, data) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fs.open(temporary, "wx", 0o600); await handle.writeFile(data); await handle.sync(); await handle.close(); handle = null;
    await fs.rename(temporary, destination);
  } catch (error) { await handle?.close().catch(() => {}); await fs.rm(temporary, { force: true }).catch(() => {}); throw error; }
}

function createSecretaryVault(directory, adapter) {
  const file = path.join(directory, "secretary-v2.vault.json");
  let session = null; let queue = Promise.resolve(); const previews = new Map();
  const serial = operation => { const result = queue.then(operation); queue = result.catch(() => {}); return result; };
  const status = () => { const supported = adapter.available(); if (!supported) { session?.key.fill(0); session = null; previews.clear(); } return { state: !supported ? "unsupported" : session ? "unlocked" : "locked", protection: "windows-dpapi+aes-256-gcm", formatVersion: 2 }; };
  const requireSession = () => { if (status().state === "unsupported") throw new Error("vault-os-protection-unavailable"); if (!session) throw new Error("vault-locked"); return session; };
  const snapshot = () => { const current = requireSession(); return { revision: current.envelope.revision, data: structuredClone(current.data) }; };
  const lockNow = () => { session?.key.fill(0); session = null; previews.clear(); return status(); };
  return {
    status,
    lock: () => serial(lockNow),
    unlock: () => serial(async () => {
      if (!adapter.available()) throw new Error("vault-os-protection-unavailable");
      if (session) return status();
      let raw;
      try { raw = await fs.readFile(file, "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; }
      if (raw !== undefined) session = open(adapter, raw);
      else {
        const key = crypto.randomBytes(32);
        try {
          const wrappedKey = adapter.wrap(key); const data = { version: 2, entries: {} };
          raw = seal(key, wrappedKey, crypto.randomUUID(), 0, data); await atomicWrite(file, raw);
          session = { key, data, envelope: parseEnvelope(raw) };
        } catch (error) { key.fill(0); throw error; }
      }
      return status();
    }),
    read: () => serial(snapshot),
    commit: request => serial(async () => {
      const current = requireSession();
      if (!request || request.expectedRevision !== current.envelope.revision) throw new Error("vault-revision-conflict");
      const data = validateData(request.data); const revision = current.envelope.revision + 1;
      const raw = seal(current.key, bytes(current.envelope.wrappedKey), current.envelope.id, revision, data);
      await atomicWrite(file, raw); current.data = data; current.envelope = parseEnvelope(raw);
      previews.clear(); return { revision };
    }),
    backup: () => serial(async () => { requireSession(); const raw = await fs.readFile(file, "utf8"); parseEnvelope(raw); return { formatVersion: 2, data: raw }; }),
    checkpoint: () => serial(async () => { requireSession(); const raw = await fs.readFile(file, "utf8"); parseEnvelope(raw); const rollbackId = crypto.randomUUID(); await atomicWrite(path.join(directory, `rollback-${rollbackId}.vault.json`), raw); return { rollbackId }; }),
    previewRestore: raw => serial(() => {
      const current = requireSession(); const incoming = open(adapter, raw); incoming.key.fill(0);
      const token = crypto.randomUUID(); previews.set(token, { data: incoming.data, revision: current.envelope.revision });
      return { token, formatVersion: 2, entries: Object.keys(incoming.data.entries).length, expectedRevision: current.envelope.revision, accountBound: true };
    }),
    cancelRestore: token => serial(() => { previews.delete(token); return { cancelled: true }; }),
    confirmRestore: token => serial(async () => {
      const current = requireSession(); const preview = previews.get(token);
      if (!preview || preview.revision !== current.envelope.revision) throw new Error("vault-restore-preview-expired");
      const previous = await fs.readFile(file, "utf8");
      const rollbackId = crypto.randomUUID(); const rollback = path.join(directory, `rollback-${rollbackId}.vault.json`);
      await atomicWrite(rollback, previous); // Encrypted safety checkpoint must succeed before replacing anything.
      const raw = seal(current.key, bytes(current.envelope.wrappedKey), current.envelope.id, current.envelope.revision + 1, preview.data);
      await atomicWrite(file, raw); current.data = preview.data; current.envelope = parseEnvelope(raw); previews.clear();
      return { restored: true, rollbackId };
    }),
    previewRollback: id => serial(async () => {
      const current = requireSession(); if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("vault-invalid-rollback");
      const incoming = open(adapter, await fs.readFile(path.join(directory, `rollback-${id}.vault.json`), "utf8")); incoming.key.fill(0);
      const token = crypto.randomUUID(); previews.set(token, { data: incoming.data, revision: current.envelope.revision });
      return { token, formatVersion: 2, entries: Object.keys(incoming.data.entries).length, expectedRevision: current.envelope.revision, accountBound: true };
    }),
  };
}
module.exports = { createWindowsKeyAdapter, createSecretaryVault, validateData };
