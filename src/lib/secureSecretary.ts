export interface VaultData { version: 2; entries: Record<string, unknown> }
export interface VaultSnapshot { revision: number; data: VaultData }
export interface VaultStatus { state: "unsupported" | "locked" | "unlocked"; protection: string; formatVersion: number }
export interface RestorePreview { token: string; formatVersion: number; entries: number; expectedRevision: number; accountBound: boolean }
export interface SecretaryVaultBridge {
  status(): Promise<VaultStatus>; unlock(): Promise<VaultStatus>; lock(): Promise<VaultStatus>;
  read(): Promise<VaultSnapshot>; commit(request: { expectedRevision: number; data: VaultData }): Promise<{ revision: number }>;
  backup(): Promise<{ formatVersion: number; data: string }>;
  previewRestore(data: string): Promise<RestorePreview>; cancelRestore(token: string): Promise<{ cancelled: boolean }>;
  confirmRestore(token: string): Promise<{ restored: boolean; rollbackId: string }>;
  previewRollback(id: string): Promise<RestorePreview>;
  onState?(callback: (status: VaultStatus) => void): () => void;
}
let epoch = 0;
export const secureVaultEpoch = () => epoch;
const bridge = () => { const value = window.chengjing?.secretaryVault; if (!value) throw new Error("Secure secretary storage unsupported; sensitive persistence is disabled"); return value; };
export const vaultChanged = () => window.dispatchEvent(new Event("chengjing:secure-vault-changed"));
export async function secureVaultStatus(): Promise<VaultStatus> { return window.chengjing?.secretaryVault ? bridge().status() : { state: "unsupported", protection: "none", formatVersion: 2 }; }
export async function unlockSecureVault() { const status = await bridge().unlock(); epoch++; vaultChanged(); return status; }
export async function lockSecureVault() { epoch++; window.dispatchEvent(new Event("chengjing:secure-vault-locking")); try { return await bridge().lock(); } finally { vaultChanged(); } }
export function invalidateVaultSession() { epoch++; window.dispatchEvent(new Event("chengjing:secure-vault-locking")); vaultChanged(); }
export async function readSecureVault() { const version = epoch; const value = await bridge().read(); if (version !== epoch) throw new Error("vault-session-changed"); return value; }
export interface PersistenceGuard { revalidate(): Promise<void>; assertCurrent(): void }
export async function secureVaultTransaction<T>(change: (data: VaultData) => T, guard?: PersistenceGuard): Promise<T> {
  const version = epoch;
  for (let attempt = 0; attempt < 5; attempt++) {
    const snapshot = await readSecureVault();
    // Source-dependent operations validate after every awaited snapshot read,
    // including CAS retries. Existing synchronous vault mutations are unchanged.
    if (guard) { await guard.revalidate(); guard.assertCurrent(); }
    const previous = JSON.stringify(snapshot.data); const result = change(snapshot.data);
    if (version !== epoch) throw new Error("vault-session-changed");
    if (JSON.stringify(snapshot.data) === previous) return result;
    try { guard?.assertCurrent(); await bridge().commit({ expectedRevision: snapshot.revision, data: snapshot.data }); if (version !== epoch) throw new Error("vault-session-changed"); vaultChanged(); return result; }
    catch (error) { if (!(error instanceof Error) || !error.message.includes("vault-revision-conflict") || version !== epoch) throw error; }
  }
  throw new Error("vault-concurrent-change; retry explicitly");
}
export interface PrivateItem { id: string; kind: "note" | "task"; title: string; plainText: string; done: boolean; createdAt: number; updatedAt: number }
export async function savePrivateItem(kind: "note" | "task", text: string, id = crypto.randomUUID()) {
  if (!text.trim() || text.length > 128000 || !/^[\w-]{8,100}$/.test(id)) throw new Error("Invalid private item");
  return secureVaultTransaction(data => {
    const key = `secretary-item:${id}`; const prior = data.entries[key] as PrivateItem | undefined;
    if (prior) { if (prior.kind !== kind || prior.plainText !== text.trim()) throw new Error("Private item ID already used"); return prior; }
    const now = Date.now(); const item: PrivateItem = { id, kind, title: text.trim().split("\n")[0].slice(0, 100), plainText: text.trim(), done: false, createdAt: now, updatedAt: now };
    data.entries[key] = item; return item;
  });
}
export async function listPrivateItems() { return Object.entries((await readSecureVault()).data.entries).filter(([key]) => key.startsWith("secretary-item:")).map(([, value]) => value as PrivateItem); }
export const privateVaultBridge = bridge;
