// Synthetic responsive-browser boundary double. NOT Windows DPAPI; native proof
// is scripts/qa-os-vault.cjs. No production component imports this module.
function installFixture() {
  const storage = "__jenzo_synthetic_encrypted_vault_qa";
  let unlocked = false; let current = null; let queue = Promise.resolve();
  const serial = action => { const result = queue.then(action); queue = result.catch(() => {}); return result; };
  const key = crypto.subtle.importKey("raw", new Uint8Array(32).fill(123), "AES-GCM", false, ["encrypt", "decrypt"]); // public fixture key
  const requireOpen = () => { if (!unlocked) throw new Error("vault-locked"); };
  const status = async () => ({ state: unlocked ? "unlocked" : "locked", protection: "MOCK-OS-BOUNDARY", formatVersion: 2 });
  window.__qaPrivateVaultBridge = {
    status,
    unlock: () => serial(async () => {
      const raw = localStorage.getItem(storage);
      if (raw) { const envelope = JSON.parse(raw); const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(envelope.iv) }, await key, new Uint8Array(envelope.ciphertext)); current = JSON.parse(new TextDecoder().decode(decrypted)); }
      else current = { revision: 0, data: { version: 2, entries: {} } };
      unlocked = true; return status();
    }),
    lock: () => serial(async () => { unlocked = false; current = null; return status(); }),
    read: () => serial(async () => { requireOpen(); return structuredClone(current); }),
    commit: request => serial(async () => {
      requireOpen(); if (request.expectedRevision !== current.revision) throw new Error("vault-revision-conflict");
      const next = { revision: current.revision + 1, data: structuredClone(request.data) }; const iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key, new TextEncoder().encode(JSON.stringify(next)));
      localStorage.setItem(storage, JSON.stringify({ iv: [...iv], ciphertext: [...new Uint8Array(ciphertext)] })); current = next; return { revision: current.revision };
    }),
    backup: async () => { throw new Error("Backups tested at real native boundary, not browser fixture"); },
  };
}
export const qaPrivateVaultSource = `(${installFixture.toString()})()`;
