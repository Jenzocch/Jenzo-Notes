// Test-only native boundary double; never imported by production components.
import type { SecretaryVaultBridge, VaultData } from "./secureSecretary";
export function mockSecretaryVault() {
  let data: VaultData = { version: 2, entries: {} }; let revision = 0; let unlocked = false;
  const requireUnlocked = () => { if (!unlocked) throw new Error("vault-locked"); };
  const bridge: SecretaryVaultBridge = {
    status: async () => ({ state: unlocked ? "unlocked" : "locked", protection: "MOCK-OS-PROTECTION", formatVersion: 2 }),
    unlock: async () => { unlocked = true; return bridge.status(); }, lock: async () => { unlocked = false; return bridge.status(); },
    read: async () => { requireUnlocked(); return structuredClone({ revision, data }); },
    commit: async request => { requireUnlocked(); if (request.expectedRevision !== revision) throw new Error("vault-revision-conflict"); data = structuredClone(request.data); return { revision: ++revision }; },
    backup: async () => { throw new Error("Use native vault tests for encryption/backup"); }, previewRestore: async () => { throw new Error("Use native tests"); }, cancelRestore: async () => ({ cancelled: true }), confirmRestore: async () => { throw new Error("Use native tests"); }, previewRollback: async () => { throw new Error("Use native tests"); },
  };
  return bridge;
}
