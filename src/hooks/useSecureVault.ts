import { useEffect, useState } from "react";
import { invalidateVaultSession, readSecureVault, secureVaultStatus, type VaultData, type VaultStatus } from "../lib/secureSecretary";
export function useSecureVault() {
  const [status, setStatus] = useState<VaultStatus>({ state: "locked", protection: "checking", formatVersion: 2 });
  const [data, setData] = useState<VaultData>({ version: 2, entries: {} });
  useEffect(() => {
    let active = true; let generation = 0;
    const clear = () => { generation++; if (active) { setData({ version: 2, entries: {} }); setStatus(value => ({ ...value, state: "locked" })); } };
    const refresh = async () => {
      const current = ++generation;
      try {
        const next = await secureVaultStatus(); if (!active || current !== generation) return; setStatus(next);
        const snapshot = next.state === "unlocked" ? await readSecureVault() : null;
        if (active && current === generation) setData(snapshot?.data || { version: 2, entries: {} });
      } catch { if (active && current === generation) { setData({ version: 2, entries: {} }); setStatus({ state: "locked", protection: "unavailable-or-corrupt", formatVersion: 2 }); } }
    };
    void refresh(); window.addEventListener("chengjing:secure-vault-changed", refresh); window.addEventListener("chengjing:secure-vault-locking", clear);
    const unsubscribe = window.chengjing?.secretaryVault?.onState?.(() => invalidateVaultSession());
    return () => { active = false; generation++; unsubscribe?.(); window.removeEventListener("chengjing:secure-vault-changed", refresh); window.removeEventListener("chengjing:secure-vault-locking", clear); };
  }, []);
  return { status, data };
}
