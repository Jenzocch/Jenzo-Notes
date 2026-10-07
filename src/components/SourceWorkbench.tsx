import { useEffect, useRef, useState } from "react";
import { createCard, db } from "../db";
import { useI18n } from "../hooks/useI18n";
import { useAppStore } from "../store";
import { runAI } from "../lib/ai";
import { renderSafeMarkdown } from "../lib/safeMarkdown";
import { documentPrompt, excerptDocument, exportSourceDocument, parseSourcedDocument, searchNoteSources, sourceAppendix, sourceContext, sourcesStillCurrent, type NoteSource } from "../lib/sourceWorkbench";

export function SourceWorkbench() {
  const { language } = useI18n();
  const zh = language.startsWith("zh");
  const [saved] = useState(() => {
    try {
      const value = JSON.parse(localStorage.getItem("chengjing-source-draft-v1") || "null");
      if (value?.version === 1 && typeof value.draft === "string" && typeof value.goal === "string" && Array.isArray(value.sources) && value.sources.length <= 8 && value.sources.every((source: NoteSource) => typeof source.key === "string" && typeof source.title === "string" && typeof source.excerpt === "string" && Number.isFinite(source.updatedAt))) return value as { draft: string; goal: string; sources: NoteSource[] };
    } catch { /* A corrupt local draft must not prevent opening the workspace. */ }
    return { draft: "", goal: "", sources: [] as NoteSource[] };
  });
  const [capture, setCapture] = useState("");
  const [query, setQuery] = useState("");
  const [goal, setGoal] = useState(saved.goal);
  const [results, setResults] = useState<NoteSource[]>([]);
  const [selected, setSelected] = useState<NoteSource[]>([]);
  const [documentSources, setDocumentSources] = useState<NoteSource[]>(saved.sources);
  const [draft, setDraft] = useState(saved.draft);
  const [original, setOriginal] = useState<{ title: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const searchVersion = useRef(0);
  const finalText = draft + sourceAppendix(documentSources, language);
  useEffect(() => {
    try { localStorage.setItem("chengjing-source-draft-v1", JSON.stringify({ version: 1, goal, draft, sources: documentSources })); }
    catch { setError(zh ? "無法保留本機草稿，請另存為筆記。" : "Unable to retain local draft. Save as a note."); }
  }, [draft, documentSources, goal, zh]);

  async function captureThought() {
    if (busy || !capture.trim()) return;
    setBusy(true); setError("");
    try {
      const now = Date.now(); const text = capture.trim(); const id = crypto.randomUUID();
      await db.fragments.add({ id, text, tagIds: [], pinned: false, createdAt: now, updatedAt: now });
      const source: NoteSource = { key: `fragment:${id}`, id, type: "fragment", title: text.split("\n")[0].slice(0, 80), excerpt: text.slice(0, 1600), updatedAt: now, matched: [] };
      setCapture(""); setResults(items => [source, ...items].slice(0, 24));
      setSelected(items => items.length < 8 ? [...items, source] : items);
    } catch (exception) { setError(String(exception)); }
    finally { setBusy(false); }
  }

  async function search() {
    const version = ++searchVersion.current;
    setBusy(true); setError("");
    try { const items = await searchNoteSources(query, language); if (version === searchVersion.current) setResults(items); }
    catch (exception) { setError(String(exception)); }
    finally { if (version === searchVersion.current) setBusy(false); }
  }

  function toggle(source: NoteSource) {
    setSelected(items => items.some(item => item.key === source.key) ? items.filter(item => item.key !== source.key) : items.length < 8 ? [...items, source] : items);
  }

  async function compose(ai: boolean) {
    if (busy || !goal.trim() || !selected.length) return;
    setBusy(true); setError("");
    try {
      if (!await sourcesStillCurrent(selected)) throw new Error(zh ? "來源已變更或刪除，請重新搜尋與選取。" : "Sources changed or were deleted. Search and select them again.");
      let text = excerptDocument(goal.trim(), selected, language);
      if (ai) {
        const state = useAppStore.getState();
        const result = await runAI({ engine: state.aiEngine, model: state.aiEngine === "custom-provider" ? state.customProviderModel : state.customModel.trim() || state.openRouterModel, prompt: documentPrompt(goal.trim(), language), context: sourceContext(selected), temperature: 0.1 });
        text = parseSourcedDocument(result.text, selected).text;
        if (!await sourcesStillCurrent(selected)) throw new Error(zh ? "整理期間來源已變更，請重新搜尋。" : "Sources changed while composing. Search again.");
      }
      setDraft(text); setDocumentSources([...selected]);
    } catch (exception) { setError((zh ? "未產生新文件：" : "No new document: ") + (exception instanceof Error ? exception.message : String(exception))); }
    finally { setBusy(false); }
  }

  async function save(exportFile: boolean) {
    if (!draft.trim() || busy) return;
    setBusy(true); setError("");
    try {
      if (exportFile) await exportSourceDocument(finalText);
      else {
        await createCard({ title: draft.match(/^#\s+(.+)/m)?.[1] || goal || "Notes document", kind: "note", state: "active", contentHtml: renderSafeMarkdown(finalText), plainText: finalText, properties: { sourceKeys: documentSources.map(source => source.key) } });
        setError(zh ? "已另存為筆記，納入既有同步與備份。" : "Saved as a new note, included in existing sync and backups.");
      }
    } catch (exception) { setError(String(exception)); }
    finally { setBusy(false); }
  }

  async function openSource(source: NoteSource) {
    try {
      const record = source.type === "card" ? await db.cards.get(source.id) : await db.fragments.get(source.id);
      if (!record || ("state" in record && record.state === "trash")) throw new Error(zh ? "來源已刪除。" : "Source was deleted.");
      setOriginal({ title: source.title, text: "plainText" in record ? record.plainText : record.text });
    } catch (exception) { setError(String(exception)); }
  }

  return <details className="source-workbench">
    <summary>{zh ? "來源工作台 · 搜尋到文件" : "Source workbench · Search to document"}</summary>
    <p>{zh ? "先用關鍵字搜尋全部卡片與片語，再選取來源。只整理你選取的片段；可移除來源或修正文稿。" : "Search all cards and thoughts by keyword, then select sources. Only selected excerpts are used; remove sources or edit the draft."}</p>
    <label>{zh ? "快速加入想法或貼資料" : "Capture an idea or paste material"}<textarea rows={2} value={capture} disabled={busy} onChange={event => setCapture(event.target.value)} /></label><button type="button" disabled={busy || !capture.trim()} onClick={() => void captureThought()}>{zh ? "留下並選取" : "Capture and select"}</button>
    <form onSubmit={event => { event.preventDefault(); void search(); }}>
      <label>{zh ? "來源關鍵字" : "Source keywords"}<input value={query} disabled={busy} onChange={event => setQuery(event.target.value)} /></label>
      <button disabled={busy || !query.trim()}>{zh ? "搜尋來源" : "Search sources"}</button>
    </form>
    <p>{zh ? "最多顯示 24 筆命中；以文字匹配排序，並非關聯機率。每筆展示命中附近最多 1600 字，並非全文。" : "Up to 24 keyword matches; ranking is not a relationship probability. Each excerpt shows up to 1600 characters near a match, not the full note."}</p>
    <div className="source-results">{results.map(source => <article key={source.key}>
      <label><input type="checkbox" checked={selected.some(item => item.key === source.key)} disabled={busy || (selected.length >= 8 && !selected.some(item => item.key === source.key))} onChange={() => toggle(source)} /><b>{source.title}</b></label>
      <small>{source.type} · {source.matched.join(" / ")}</small><p>{source.excerpt}</p>
      <button type="button" onClick={() => void openSource(source)}>{zh ? "查看原文" : "Read original"}</button>
    </article>)}</div>
    {original && <section className="source-original" aria-label={zh ? "原文" : "Original text"}><b>{original.title}</b><pre>{original.text}</pre><button type="button" onClick={() => setOriginal(null)}>{zh ? "關閉原文" : "Close original"}</button></section>}
    <div className="source-selection">{selected.map(source => <button type="button" disabled={busy} key={source.key} onClick={() => toggle(source)} aria-label={`${zh ? "移除來源" : "Remove source"}: ${source.title}`}>{source.title} ×</button>)}</div>
    <label>{zh ? "文件目標（讀者、用途、格式）" : "Document goal (audience, purpose, format)"}<textarea rows={2} value={goal} disabled={busy} onChange={event => setGoal(event.target.value)} /></label>
    <button type="button" disabled={busy} onClick={() => setGoal(zh ? "對照所選來源，整理共同點、差異與可能關聯。每項關聯列出雙方原文證據，區分推論與事實，並指出仍需核對的問題。" : "Compare selected sources: shared themes, differences and possible relationships. Quote both sides for each relationship, distinguish inference from recorded facts, and list questions to verify.")}>{zh ? "使用來源關聯目標" : "Use source comparison goal"}</button>
    <p>{zh ? `已選 ${selected.length}/8 筆。AI 整理會把這些片段送至你目前設定的 provider；原文不會修改。` : `${selected.length}/8 selected. AI compose sends these excerpts to your configured provider; originals remain intact.`}</p>
    <div className="source-actions"><button type="button" disabled={busy || !selected.length || !goal.trim()} onClick={() => void compose(false)}>{zh ? "建立摘錄文件" : "Create excerpt document"}</button><button type="button" disabled={busy || !selected.length || !goal.trim()} onClick={() => void compose(true)}>{busy ? zh ? "處理中…" : "Working…" : zh ? "AI 整理草稿" : "AI compose draft"}</button></div>
    {draft && <><p>{zh ? "草稿待人工核對：引用文字已驗證對應片段，但不代表 AI 推論已被證實。離開面板前請另存為筆記。" : "Review this draft: quote text is verified against excerpts, but AI inferences are not proven. Save as a note before leaving the panel."}</p><label>{zh ? "可編輯文件" : "Editable document"}<textarea className="source-document" rows={12} value={draft} disabled={busy} onChange={event => setDraft(event.target.value)} /></label><details><summary>{zh ? "附錄來源" : "Source appendix"}</summary><pre>{sourceAppendix(documentSources, language)}</pre></details><div className="source-actions"><button type="button" disabled={busy || !draft.trim()} onClick={() => void save(false)}>{zh ? "另存為筆記" : "Save document as note"}</button><button type="button" disabled={busy || !draft.trim()} onClick={() => void save(true)}>{zh ? "導出 Markdown 文件" : "Export Markdown document"}</button></div></>}
    {error && <p role="status">{error}</p>}
  </details>;
}
