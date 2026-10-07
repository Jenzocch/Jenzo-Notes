import { useRef, useState } from "react";
import { useSecureVault } from "../hooks/useSecureVault";
import { useI18n } from "../hooks/useI18n";
import { invalidateVaultSession, lockSecureVault, privateVaultBridge, unlockSecureVault, type RestorePreview } from "../lib/secureSecretary";
export function SecureVaultControls() {
  const { status } = useSecureVault(); const { language } = useI18n(); const zh = language.startsWith("zh");
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [preview, setPreview] = useState<RestorePreview | null>(null); const [rollback, setRollback] = useState("");
  const operationLock = useRef(false);
  async function act(action: () => Promise<void>) { if (operationLock.current) return; operationLock.current = true; setBusy(true); setMessage(""); try { await action(); } catch (error) { setMessage(error instanceof Error ? error.message : "Vault operation failed"); } finally { operationLock.current = false; setBusy(false); } }
  return <section className="secure-vault-controls" aria-label={zh ? "私人加密儲存" : "Private encrypted storage"}>
    <p>{zh ? `新秘書資料／草稿：${status.state}` : `New secretary data / drafts: ${status.state}`}</p>
    <p>{zh ? "此切片只支援 Windows OS 保護金鑰。瀏覽器／Android／其他環境停用敏感持久化，不退回明文。舊筆記未遷移。" : "This slice supports Windows OS-protected keys only. Browser, Android and other unsupported environments disable sensitive persistence; no plaintext fallback. Existing notes are not migrated."}</p>
    {status.state === "locked" && <button disabled={busy} onClick={() => void act(async () => { await unlockSecureVault(); })}>{zh ? "解鎖私人儲存" : "Unlock private storage"}</button>}
    {status.state === "unlocked" && <><button disabled={busy} onClick={() => void act(async () => { await lockSecureVault(); setPreview(null); })}>{zh ? "鎖定私人儲存" : "Lock private storage"}</button>
      <details><summary>{zh ? "加密備份／復原" : "Encrypted backup / restore"}</summary><p>{zh ? "備份綁定 Windows 使用者的 OS 金鑰，不能保證跨裝置或 OS 金鑰遺失後復原。復原先預覽，確認前不改資料；確認時先留加密回復點。" : "Backups are bound to this Windows user's OS keys, not portable recovery or protection from OS-key loss. Preview and cancel change nothing; confirmation first saves an encrypted rollback checkpoint."}</p>
        <button disabled={busy} onClick={() => void act(async () => { const backup = await privateVaultBridge().backup(); if (!window.chengjing?.files?.save) throw new Error("Native file export unavailable"); const result = await window.chengjing.files.save({ title: "Save encrypted secretary backup", defaultPath: "secretary-v2-encrypted.json", filters: [{ name: "Encrypted vault", extensions: ["json"] }], data: backup.data }); setMessage(result.canceled ? "Backup export cancelled" : "Encrypted backup exported"); })}>{zh ? "匯出加密備份" : "Export encrypted backup"}</button>
        <label>{zh ? "選擇加密備份以預覽" : "Select encrypted backup for preview"}<input type="file" accept=".json" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void act(async () => { if (file.size > 4 * 1024 * 1024) throw new Error("Vault size limit"); if (preview) await privateVaultBridge().cancelRestore(preview.token); setPreview(null); setPreview(await privateVaultBridge().previewRestore(await file.text())); }); }} /></label>
        {preview && <div><p>{zh ? `復原版本 ${preview.formatVersion}，${preview.entries} 個項目；將取代目前私人 vault。` : `Restore format ${preview.formatVersion}, ${preview.entries} entries; replaces the current private vault.`}</p><button disabled={busy} onClick={() => void act(async () => { await privateVaultBridge().cancelRestore(preview.token); setPreview(null); })}>{zh ? "取消復原" : "Cancel restore"}</button><button disabled={busy} onClick={() => void act(async () => { const result = await privateVaultBridge().confirmRestore(preview.token); setRollback(result.rollbackId); setPreview(null); invalidateVaultSession(); setMessage("Restore complete; encrypted rollback checkpoint retained"); })}>{zh ? "確認復原" : "Confirm restore"}</button></div>}
        {rollback && <button disabled={busy} onClick={() => void act(async () => { setPreview(await privateVaultBridge().previewRollback(rollback)); })}>{zh ? "預覽回復點" : "Preview rollback checkpoint"}</button>}
      </details></>}
    {message && <p role="status">{message}</p>}
  </section>;
}
