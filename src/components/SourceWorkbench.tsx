import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { readImageIdea } from "../lib/imageIdeas";
import { db } from "../db";
import { useI18n } from "../hooks/useI18n";
import { useAppStore } from "../store";
import { runAI } from "../lib/ai";
import { useSecureVault } from "../hooks/useSecureVault";
import { SecureVaultControls } from "./SecureVaultControls";
import { EvidenceInvestigation } from "./EvidenceInvestigation";
import { listPrivateItems, readSecureVault, savePrivateItem, secureVaultEpoch, secureVaultTransaction } from "../lib/secureSecretary";
import { documentPrompt, excerptDocument, exportSourceDocument, noteSourceOperation, parseSourcedDocument, searchNoteSources, sourceAppendix, sourceContext, sourcesStillCurrent, type NoteSource } from "../lib/sourceWorkbench";

export function SourceWorkbench() {
  const { language } = useI18n();
  const zh = language.startsWith("zh");
  const { status: vaultStatus, data: vaultData } = useSecureVault();
  const [capture, setCapture] = useState("");
  const [query, setQuery] = useState("");
  const [goal, setGoal] = useState("");
  const [results, setResults] = useState<NoteSource[]>([]);
  const [selected, setSelected] = useState<NoteSource[]>([]);
  const [documentSources, setDocumentSources] = useState<NoteSource[]>([]);
  const [draft, setDraft] = useState("");
  const [original, setOriginal] = useState<{ title: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sourcesValid, setSourcesValid] = useState(false);
  const watchedSources = useLiveQuery(async () => {
    const records = await Promise.all(documentSources.map(source => source.type === "card" ? db.cards.get(source.id) : source.type === "fragment" ? db.fragments.get(source.id) : null));
    const ids = records.flatMap(record => { if (!record || !("properties" in record)) return []; try { const image = readImageIdea(record); return image ? [image.attachmentId] : []; } catch { return []; } });
    return { records, attachments: await Promise.all(ids.map(id => db.attachments.get(id))) };
  }, [documentSources.map(source => source.key).join("|")]);
  const searchVersion = useRef(0);
  const operationBusy = useRef(false);
  const generation = useRef(0);
  const unlocked = vaultStatus.state === "unlocked";
  const session = () => { const current = generation.current; const epoch = secureVaultEpoch(); return () => current === generation.current && epoch === secureVaultEpoch(); };
  const finalText = draft + sourceAppendix(documentSources, language);
  useEffect(() => { let active = true; setSourcesValid(false); void sourcesStillCurrent(documentSources).then(valid => { if (active) setSourcesValid(valid); }).catch(() => { if (active) setSourcesValid(false); }); return () => { active = false; }; }, [documentSources, watchedSources, vaultStatus.state, vaultData]);
  useEffect(() => {
    const invalidate = () => { generation.current++; searchVersion.current++; operationBusy.current = false; setBusy(false); };
    window.addEventListener("chengjing:secure-vault-locking", invalidate);
    return () => { generation.current++; window.removeEventListener("chengjing:secure-vault-locking", invalidate); };
  }, []);
  useEffect(() => {
    let active = true;
    const current = session();
    if (vaultStatus.state !== "unlocked") { setCapture(""); setQuery(""); setGoal(""); setDraft(""); setDocumentSources([]); setSelected([]); setResults([]); setOriginal(null); setError(""); }
    else void readSecureVault().then(snapshot => {
      const saved = snapshot.data.entries["source-draft-v2"] as { version: number; draft: string; goal: string; sources: NoteSource[] } | undefined;
      if (active && current() && saved?.version === 2 && typeof saved.draft === "string" && typeof saved.goal === "string" && Array.isArray(saved.sources) && saved.sources.length <= 8) { setGoal(saved.goal); setDraft(saved.draft); setDocumentSources(saved.sources); }
    }).catch(() => { if (active && current()) setError("Encrypted draft unavailable; original data retained"); });
    return () => { active = false; };
  }, [vaultStatus.state]);
  async function saveEncryptedDraft() {
    if (operationBusy.current || vaultStatus.state !== "unlocked") return; operationBusy.current = true; setBusy(true);
    const current = session();
    const guard = noteSourceOperation(documentSources);
    try { await guard.revalidate(); await secureVaultTransaction(data => { data.entries["source-draft-v2"] = { version: 2, goal, draft, sources: documentSources }; }, guard); if (current()) setError("Encrypted draft saved"); }
    catch (error) { if (current()) setError(error instanceof Error ? error.message : "Encrypted draft save failed"); }
    finally { guard.dispose(); if (current()) { operationBusy.current = false; setBusy(false); } }
  }

  async function captureThought() {
    if (operationBusy.current || busy || !capture.trim() || vaultStatus.state !== "unlocked") return;
    operationBusy.current = true;
    const current = session();
    setBusy(true); setError("");
    try {
      const text = capture.trim(); const item = await savePrivateItem("note", text);
      if (!current()) return;
      const source: NoteSource = { key: `private:${item.id}`, id: item.id, type: "private", title: item.title, excerpt: text.slice(0, 1600), updatedAt: item.updatedAt, matched: [] };
      setCapture(""); setResults(items => [source, ...items].slice(0, 24));
      setSelected(items => items.length < 8 ? [...items, source] : items);
    } catch (exception) { if (current()) setError(String(exception)); }
    finally { if (current()) { operationBusy.current = false; setBusy(false); } }
  }

  async function search() {
    if (operationBusy.current) return;
    operationBusy.current = true;
    const version = ++searchVersion.current;
    const current = session();
    setBusy(true); setError("");
    try { const items = await searchNoteSources(query, language); if (current() && version === searchVersion.current) setResults(items); }
    catch (exception) { if (current()) setError(String(exception)); }
    finally { if (current() && version === searchVersion.current) { operationBusy.current = false; setBusy(false); } }
  }

  function toggle(source: NoteSource) {
    setSelected(items => items.some(item => item.key === source.key) ? items.filter(item => item.key !== source.key) : items.length < 8 ? [...items, source] : items);
  }

  async function compose(ai: boolean) {
    if (!unlocked || operationBusy.current || busy || !goal.trim() || !selected.length) return;
    operationBusy.current = true;
    const current = session();
    setBusy(true); setError("");
    try {
      if (!await sourcesStillCurrent(selected)) throw new Error(zh ? "來源已變更或刪除，請重新搜尋與選取。" : "Sources changed or were deleted. Search and select them again.");
      if (!current()) return;
      let text = excerptDocument(goal.trim(), selected, language);
      if (ai) {
        const state = useAppStore.getState();
        const result = await runAI({ engine: state.aiEngine, sources: selected, model: state.aiEngine === "custom-provider" ? state.customProviderModel : state.customModel.trim() || state.openRouterModel, prompt: documentPrompt(goal.trim(), language), context: sourceContext(selected, state.aiEngine), temperature: 0.1 });
        if (!current()) return;
        text = parseSourcedDocument(result.text, selected).text;
        if (!await sourcesStillCurrent(selected)) throw new Error(zh ? "整理期間來源已變更，請重新搜尋。" : "Sources changed while composing. Search again.");
      }
      if (current()) { setDraft(text); setDocumentSources([...selected]); }
    } catch (exception) { if (current()) setError((zh ? "未產生新文件：" : "No new document: ") + (exception instanceof Error ? exception.message : String(exception))); }
    finally { if (current()) { operationBusy.current = false; setBusy(false); } }
  }

  async function save(exportFile: boolean) {
    if (!unlocked || !draft.trim() || busy || operationBusy.current) return;
    operationBusy.current = true;
    const current = session();
    const guard = noteSourceOperation(documentSources);
    setBusy(true); setError("");
    try {
      await guard.revalidate();
      if (exportFile) await exportSourceDocument(finalText, language, guard);
      else {
        await savePrivateItem("note", finalText, crypto.randomUUID(), guard);
        if (!current()) return;
        setError(zh ? "已存為私人加密筆記；不納入舊明文同步／備份。" : "Saved in private encrypted vault; outside legacy sync/plaintext backups.");
      }
    } catch (exception) { if (current()) setError(String(exception)); }
    finally { guard.dispose(); if (current()) { operationBusy.current = false; setBusy(false); } }
  }

  async function openSource(source: NoteSource) {
    if (source.type === "private" && !unlocked) return;
    const current = session();
    try {
      const record = source.type === "private" ? (await listPrivateItems()).find(item => item.id === source.id) : source.type === "card" ? await db.cards.get(source.id) : await db.fragments.get(source.id);
      if (!current()) return;
      if (!record || ("state" in record && record.state === "trash")) throw new Error(zh ? "來源已刪除。" : "Source was deleted.");
      setOriginal({ title: source.title, text: "plainText" in record ? record.plainText : record.text });
    } catch (exception) { if (current()) setError(String(exception)); }
  }

  return <details className="source-workbench">
    <summary>{zh ? "來源工作台 · 搜尋到文件" : "Source workbench · Search to document"}</summary>
    <SecureVaultControls />
    <EvidenceInvestigation />
    <p>{zh ? "草稿只在記憶體；請明確儲存加密草稿。導出是防止 HTML／遠端圖片啟動的純文字 Markdown。舊資料不會自動遷移。" : "Drafts stay in memory until explicitly saved encrypted. Export is inert text Markdown, with no active HTML or remote images. Old data is not automatically migrated."}</p>
    <button disabled={busy || !sourcesValid || vaultStatus.state !== "unlocked" || !draft.trim()} onClick={() => void saveEncryptedDraft()}>{zh ? "儲存加密草稿" : "Save encrypted draft"}</button>
    <fieldset disabled={busy || vaultStatus.state !== "unlocked"}>
    <p>{zh ? "先用關鍵字搜尋全部卡片與片語，再選取來源。只整理你選取的片段；可移除來源或修正文稿。" : "Search all cards and thoughts by keyword, then select sources. Only selected excerpts are used; remove sources or edit the draft."}</p>
    <label>{zh ? "快速加入想法或貼資料" : "Capture an idea or paste material"}<textarea rows={2} value={capture} disabled={busy} onChange={event => setCapture(event.target.value)} /></label><button type="button" disabled={busy || !capture.trim()} onClick={() => void captureThought()}>{zh ? "留下並選取" : "Capture and select"}</button>
    </fieldset>
    <form onSubmit={event => { event.preventDefault(); void search(); }}>
      <label>{zh ? "來源關鍵字" : "Source keywords"}<input value={query} disabled={busy} onChange={event => setQuery(event.target.value)} /></label>
      <button disabled={busy || !query.trim()}>{zh ? "搜尋來源" : "Search sources"}</button>
    </form>
    <p>{zh ? "最多顯示 24 筆命中；以文字匹配排序，並非關聯機率。每筆展示命中附近最多 1600 字，並非全文。" : "Up to 24 keyword matches; ranking is not a relationship probability. Each excerpt shows up to 1600 characters near a match, not the full note."}</p>
    <div className="source-results">{results.filter(source => unlocked || source.type !== "private").map(source => <article key={source.key}>
      <label><input type="checkbox" checked={selected.some(item => item.key === source.key)} disabled={busy || (selected.length >= 8 && !selected.some(item => item.key === source.key))} onChange={() => toggle(source)} /><b>{source.title}</b></label>
      <small>{source.type} · {source.matched.join(" / ")}</small><p>{source.excerpt}</p>
      <button type="button" onClick={() => void openSource(source)}>{zh ? "查看原文" : "Read original"}</button>
    </article>)}</div>
    {unlocked && original && <section className="source-original" aria-label={zh ? "原文" : "Original text"}><b>{original.title}</b><pre>{original.text}</pre><button type="button" onClick={() => setOriginal(null)}>{zh ? "關閉原文" : "Close original"}</button></section>}
    <div className="source-selection">{(unlocked ? selected : []).map(source => <button type="button" disabled={busy} key={source.key} onClick={() => toggle(source)} aria-label={`${zh ? "移除來源" : "Remove source"}: ${source.title}`}>{source.title} ×</button>)}</div>
    <label>{zh ? "文件目標（讀者、用途、格式）" : "Document goal (audience, purpose, format)"}<textarea rows={2} value={goal} disabled={busy} onChange={event => setGoal(event.target.value)} /></label>
    <button type="button" disabled={busy} onClick={() => setGoal(zh ? "對照所選來源，整理共同點、差異與可能關聯。每項關聯列出雙方原文證據，區分推論與事實，並指出仍需核對的問題。" : "Compare selected sources: shared themes, differences and possible relationships. Quote both sides for each relationship, distinguish inference from recorded facts, and list questions to verify.")}>{zh ? "使用來源關聯目標" : "Use source comparison goal"}</button>
    <p>{zh ? `已選 ${selected.length}/8 筆。AI 整理會把這些片段送至你目前設定的 provider；原文不會修改。` : `${selected.length}/8 selected. AI compose sends these excerpts to your configured provider; originals remain intact.`}</p>
    <div className="source-actions"><button type="button" disabled={!unlocked || busy || !selected.length || !goal.trim()} onClick={() => void compose(false)}>{zh ? "建立摘錄文件" : "Create excerpt document"}</button><button type="button" disabled={!unlocked || busy || !selected.length || !goal.trim()} onClick={() => void compose(true)}>{busy ? zh ? "處理中…" : "Working…" : zh ? "AI 整理草稿" : "AI compose draft"}</button></div>
    {unlocked && draft && <><p>{zh ? "請核對草稿與附錄：AI 產生時會驗證逐字引用，手動修改不會重新驗證；引用存在不代表推論成立。離開前可另存為筆記。" : "Review draft and appendix: AI quotes are checked at generation; manual edits are not revalidated. A quote does not prove an inference. Save as a note before leaving."}</p><label>{zh ? "可編輯文件" : "Editable document"}<textarea className="source-document" rows={12} value={draft} disabled={busy} onChange={event => setDraft(event.target.value)} /></label><details><summary>{zh ? "附錄來源" : "Source appendix"}</summary><pre>{sourceAppendix(documentSources, language)}</pre></details><div className="source-actions"><button type="button" disabled={busy || !sourcesValid || !draft.trim()} onClick={() => void save(false)}>{zh ? "另存為筆記" : "Save document as note"}</button><button type="button" disabled={busy || !sourcesValid || !draft.trim()} onClick={() => void save(true)}>{zh ? "導出 Markdown 文件" : "Export Markdown document"}</button></div></>}
    {!!draft && !sourcesValid && <p role="alert">{zh ? "引用來源檢查中或已變更／刪除。已保留草稿；保存與匯出暫停，請重新搜尋、選取來源並建立文件。" : "Sources are checking, changed or deleted. Draft retained; save/export paused. Search and compose again."}</p>}
    {error && <p role="status">{error}</p>}
  </details>;
}
