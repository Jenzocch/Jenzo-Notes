import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { useI18n } from "../hooks/useI18n";
import { useSecureVault } from "../hooks/useSecureVault";
import { secureVaultEpoch } from "../lib/secureSecretary";
import { checkEvidence, FG17EvidenceRepository, localEvidenceRepository, retrieveInvestigation, type EvidenceState, type InvestigationHit } from "../lib/investigationEvidence";
import { compileInvestigation, confirmInvestigationTask, exportInvestigation, fg17MockProposal, findingLabels, investigationPrivate, loadInvestigation, localEvidenceOutline, previewInvestigationTask, publishInvestigationRelation, saveInvestigation, validateInvestigation, type FindingKind, type Investigation, type InvestigationTaskPreview } from "../lib/investigation";
import { EvidenceReferences } from "./EvidenceReferences";

const labelsZh: Record<FindingKind, string> = { fact: "資料記載（引用原文）", inference: "推測 · 未證實", conflict: "可能矛盾 · 核對情境", gap: "缺少證據 · 僅限所選範圍" };
export function EvidenceInvestigation() {
  const { language } = useI18n(); const zh = language.startsWith("zh"); const vault = useSecureVault();
  const [sample, setSample] = useState<FG17EvidenceRepository | null>(null); const [sampleVersion, setSampleVersion] = useState(0); const [samplePrivate, setSamplePrivate] = useState(false);
  const repository = sample || localEvidenceRepository;
  const [question, setQuestion] = useState(""); const [hits, setHits] = useState<InvestigationHit[]>([]); const [selected, setSelected] = useState<string[]>([]);
  const [artifact, setArtifact] = useState<Investigation | null>(null); const [states, setStates] = useState<Record<string, EvidenceState>>({});
  const [preview, setPreview] = useState<InvestigationTaskPreview | null>(null); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const [manualKind, setManualKind] = useState<FindingKind>("inference"); const [manualText, setManualText] = useState(""); const [leftKey, setLeftKey] = useState(""); const [rightKey, setRightKey] = useState("");
  const [checked, setChecked] = useState(false); const [checkVersion, setCheckVersion] = useState(0); const operation = useRef(false); const generation = useRef(0);
  const sourceKeys = useMemo(() => artifact?.inputSources.map(source => source.key) || [], [artifact]);
  const watched = useLiveQuery(async () => sample ? [] : Promise.all(sourceKeys.map(key => key.startsWith("card:") ? db.cards.get(key.slice(5)) : key.startsWith("fragment:") ? db.fragments.get(key.slice(9)) : Promise.resolve(null))), [sample, sourceKeys.join("|")]);
  const valid = checked && !!artifact && Object.values(states).length > 0 && Object.values(states).every(state => state === "valid");
  const savedIds = sample ? [...sample.drafts.keys()] : Object.keys(vault.data.entries).filter(key => key.startsWith("secretary-investigation:")).map(key => key.slice("secretary-investigation:".length));
  function reset() { generation.current++; operation.current = false; setBusy(false); setHits([]); setSelected([]); setArtifact(null); setPreview(null); setStates({}); setChecked(false); setMessage(""); setManualText(""); setLeftKey(""); setRightKey(""); }
  useEffect(() => {
    const lock = () => { if (!sample) { reset(); setQuestion(""); } };
    window.addEventListener("chengjing:secure-vault-locking", lock);
    return () => { generation.current++; window.removeEventListener("chengjing:secure-vault-locking", lock); };
  }, [sample]);
  useEffect(() => {
    if (!artifact) return;
    let active = true; const current = generation.current; const epoch = secureVaultEpoch(); setChecked(false); setPreview(null);
    void validateInvestigation(artifact, repository).then(next => { if (active && current === generation.current && epoch === secureVaultEpoch()) { setStates(next); setChecked(true); } }).catch(error => { if (active && current === generation.current) { setStates({ invalid: "invalid" }); setMessage(String(error)); setChecked(true); } });
    return () => { active = false; };
  }, [artifact, repository, watched, sampleVersion, checkVersion, vault.data]);
  async function act(action: (current: () => boolean) => Promise<void>) {
    if (operation.current) return; operation.current = true; setBusy(true); setMessage("");
    const currentGeneration = generation.current; const epoch = secureVaultEpoch(); const current = () => generation.current === currentGeneration && (sample || epoch === secureVaultEpoch());
    try { await action(() => !!current()); } catch (error) { if (current()) setMessage(error instanceof Error ? error.message : String(error)); }
    finally { if (current()) { operation.current = false; setBusy(false); } }
  }
  function startSample() { reset(); setSample(new FG17EvidenceRepository()); setSamplePrivate(false); setSampleVersion(0); setQuestion("Why did FG-17 get complaints, and what should we verify next?"); }
  async function search() { await act(async current => { const results = await retrieveInvestigation(repository, question, language); if (current()) { setHits(results); setSelected(results.map(hit => hit.source.key)); } }); }
  async function build(mock: boolean) {
    await act(async current => {
      if (mock && !sample) throw new Error("Mock proposal is restricted to the isolated synthetic case");
      const chosen = hits.filter(hit => selected.includes(hit.source.key));
      for (const hit of chosen) if (await checkEvidence(hit.evidence, repository) !== "valid") throw new Error("Selected source changed; search again");
      const proposal = mock ? fg17MockProposal() : localEvidenceOutline(chosen.map(hit => hit.source), question);
      const result = await compileInvestigation(proposal, chosen.map(hit => hit.source.key), question, repository);
      if (current()) { setArtifact(result); setPreview(null); setMessage(mock ? "MOCK proposal: verify interpretations; no AI call" : "Local original-quote outline; no AI call"); }
    });
  }
  function edit(update: (artifact: Investigation) => Investigation) { if (artifact) { setArtifact(update(artifact)); setPreview(null); } }
  function addFinding() {
    if (!artifact || !valid || !manualText.trim()) return;
    const keys = [leftKey, rightKey].filter(Boolean);
    const evidence = hits.filter(hit => keys.includes(hit.source.key) && artifact.inputSources.some(source => source.key === hit.source.key)).map(hit => hit.evidence);
    if (manualKind !== "gap" && !evidence.length || manualKind === "conflict" && evidence.length < 2) { setMessage("Select original evidence; conflicts require two different sources"); return; }
    edit(previous => ({ ...previous, findings: [...previous.findings, { id: crypto.randomUUID(), kind: manualKind, text: manualKind === "fact" ? evidence.map(ref => ref.quote).join("\n") : manualText.trim(), evidence }] })); setManualText("");
  }
  async function publish(id: string) {
    if (!artifact || !window.confirm(zh ? "將這條公開來源關係寫入既有關係圖？關係圖屬既有同步範圍。這是人工採納的解讀，不代表因果已證實。" : "Add this public-source relationship to the existing graph? Graph records belong to legacy sync. This adopts an interpretation; it does not prove causality.")) return;
    await act(async current => { await publishInvestigationRelation(artifact, id, repository); if (current()) setMessage("Public relationship saved in existing graph"); });
  }
  return <details className="source-workbench evidence-investigation">
    <summary>{zh ? "跨資料查證 · 證據到改善方案" : "Cross-source investigation · Evidence to action"}</summary>
    <p>{sample ? zh ? "FG-17 合成隔離案例：資料、草稿與待辦只在記憶體，不加入你的筆記。關閉案例即捨棄。" : "Isolated synthetic FG-17 case: sources, drafts and tasks stay in memory and never enter your notes. Closing the case discards them." : zh ? "使用既有本機全文與來源；私密來源需解鎖。只產生查證提案，不呼叫 AI 或連接外部系統。" : "Use existing local sources; private sources require unlock. Evidence proposals only: no AI call or external system connection."}</p>
    <div className="source-actions"><button type="button" disabled={busy} onClick={startSample}>{zh ? "開啟隔離 FG-17 案例" : "Open isolated FG-17 case"}</button>{sample && <button type="button" disabled={busy} onClick={() => { reset(); setSample(null); setQuestion(""); }}>{zh ? "關閉案例 · 回本機來源" : "Close case · Use local sources"}</button>}</div>
    {sample && <label><input type="checkbox" checked={samplePrivate} disabled={busy} onChange={event => { const allow = event.target.checked; reset(); sample.setPrivateAccess(allow); setSamplePrivate(allow); setSampleVersion(sample.version); }} />{zh ? "開啟合成私密來源（僅記憶體；不是 OS 解鎖）" : "Allow synthetic private source (memory only; not OS unlock)"}</label>}
    <form onSubmit={event => { event.preventDefault(); void search(); }}><label>{zh ? "要查證的問題／批次／設備" : "Question / batch / equipment"}<textarea className="investigation-question" rows={2} maxLength={2000} disabled={busy} value={question} onChange={event => setQuestion(event.target.value)} /></label><button disabled={busy || !question.trim()}>{zh ? "檢索相關片段" : "Retrieve related passages"}</button></form>
    <p>{zh ? "最多兩輪、12 個來源；關鍵字或共用識別碼說明檢索理由，不等於因果或完整資料覆蓋。" : "At most two rounds / 12 sources. Keywords and shared identifiers explain retrieval, not causality or complete coverage."}</p>
    <div className="source-results investigation-results">{hits.map(hit => <article key={hit.source.key}><label><input type="checkbox" checked={selected.includes(hit.source.key)} disabled={busy} onChange={() => setSelected(previous => previous.includes(hit.source.key) ? previous.filter(key => key !== hit.source.key) : [...previous, hit.source.key])} /><b>{hit.source.title}</b></label><small>{hit.reason} · {hit.source.privacy}</small><EvidenceReferences evidence={[hit.evidence]} repository={repository} refreshKey={sampleVersion} /></article>)}</div>
    <div className="source-actions"><button type="button" disabled={busy || !selected.length} onClick={() => void build(false)}>{zh ? "建立本機證據大綱" : "Build local evidence outline"}</button>{sample && <button type="button" disabled={busy || !selected.length} onClick={() => void build(true)}>{zh ? "檢視 FG-17 mock 判讀提案" : "Review FG-17 mock proposal"}</button>}</div>
    {artifact && <section className="investigation-brief">
      <details><summary>Add an evidence-backed interpretation</summary><label>Classification<select value={manualKind} onChange={event => setManualKind(event.target.value as FindingKind)}>{Object.entries(findingLabels).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></label><label>Interpretation<textarea maxLength={4000} value={manualText} onChange={event => setManualText(event.target.value)} /></label>{[[leftKey, setLeftKey], [rightKey, setRightKey]].map(([key, setter], index) => <label key={index}>Original source {index + 1}<select value={key as string} onChange={event => (setter as (value: string) => void)(event.target.value)}><option value="">No source</option>{hits.filter(hit => artifact.inputSources.some(source => source.key === hit.source.key)).map(hit => <option key={hit.source.key} value={hit.source.key}>{hit.source.title}</option>)}</select></label>)}<button type="button" disabled={busy || !valid || artifact.findings.length >= 24} onClick={addFinding}>Add interpretation with selected quotations</button></details>
      <h3>{artifact.question}</h3><p>{investigationPrivate(artifact) ? zh ? "含私密輸入：編輯或移除引用不會解除私密範圍；不能寫入公開關係圖。" : "Includes private input: edits/removing citations do not declassify it; public graph publication is blocked." : zh ? "所選輸入皆為公開本機來源。" : "Selected inputs are public local sources."}</p>
      <button type="button" disabled={busy} onClick={() => setCheckVersion(value => value + 1)}>{zh ? "重新核對來源" : "Recheck sources"}</button>
      <ul className="investigation-source-status">{artifact.inputSources.map(source => <li key={source.key} data-source-state={states[source.key] || "checking"}>{source.title}: {states[source.key] || "checking"}</li>)}</ul>
      {!valid && <p role="alert">{zh ? "來源校驗中或已失效／刪除／鎖定。請重新檢索；儲存、匯出與待辦確認已暫停。" : "Sources are checking, changed, deleted or locked. Search again; save, export and task confirmation are paused."}</p>}
      {artifact.findings.map(finding => <article className="investigation-finding" data-finding-kind={finding.kind} key={finding.id}><h4>{zh ? labelsZh[finding.kind] : findingLabels[finding.kind]}</h4>{finding.kind !== "fact" && <label>{zh ? "人工可修正的判讀" : "Editable interpretation"}<textarea disabled={busy} rows={3} maxLength={4000} value={finding.text} onChange={event => edit(previous => ({ ...previous, findings: previous.findings.map(item => item.id === finding.id ? { ...item, text: event.target.value } : item) }))} /></label>}<EvidenceReferences evidence={finding.evidence} repository={repository} refreshKey={sampleVersion + checkVersion} /></article>)}
      <h4>{zh ? "雙端證據的關係提案" : "Relationship proposals with both-end evidence"}</h4>
      {artifact.relations.map(relation => <article className="investigation-relation" key={relation.id}><p>{relation.kind} · {relation.decision}</p><label>{zh ? "關聯理由（仍是解讀）" : "Relationship reason (interpretation)"}<textarea rows={2} maxLength={700} disabled={busy} value={relation.reason} onChange={event => edit(previous => ({ ...previous, relations: previous.relations.map(item => item.id === relation.id ? { ...item, reason: event.target.value, decision: "proposed" } : item) }))} /></label><EvidenceReferences evidence={relation.evidence} repository={repository} refreshKey={sampleVersion + checkVersion} /><button type="button" disabled={busy || !valid} onClick={() => edit(previous => ({ ...previous, relations: previous.relations.map(item => item.id === relation.id ? { ...item, decision: "accepted" } : item) }))}>{zh ? "採納這項解讀" : "Accept interpretation"}</button><button type="button" disabled={busy} onClick={() => edit(previous => ({ ...previous, relations: previous.relations.map(item => item.id === relation.id ? { ...item, decision: "rejected" } : item) }))}>{zh ? "拒絕" : "Reject"}</button>{!sample && <button type="button" disabled={busy || !valid || investigationPrivate(artifact) || relation.decision !== "accepted"} onClick={() => void publish(relation.id)}>{zh ? "寫入公開關係圖" : "Save public relationship to graph"}</button>}</article>)}
      <h4>{zh ? "改善方案與待辦提案" : "Improvement and task proposals"}</h4>
      {artifact.actions.map(action => <article key={action.id}><label>Task title<input maxLength={200} disabled={busy} value={action.title} onChange={event => edit(previous => ({ ...previous, actions: previous.actions.map(item => item.id === action.id ? { ...item, title: event.target.value } : item) }))} /></label><label>Improvement rationale<textarea rows={2} maxLength={1000} disabled={busy} value={action.rationale} onChange={event => edit(previous => ({ ...previous, actions: previous.actions.map(item => item.id === action.id ? { ...item, rationale: event.target.value } : item) }))} /></label><label>Supporting findings<select multiple value={action.findingIds} disabled={busy} onChange={event => { const findingIds = Array.from(event.target.selectedOptions, option => option.value); edit(previous => ({ ...previous, actions: previous.actions.map(item => item.id === action.id ? { ...item, findingIds } : item) })); }}>{artifact.findings.map(finding => <option key={finding.id} value={finding.id}>{finding.kind}: {finding.text.slice(0, 100)}</option>)}</select></label><button type="button" disabled={busy || !valid || !sample && vault.status.state !== "unlocked"} onClick={() => void act(async current => { const next = await previewInvestigationTask(artifact, action.id, repository); if (current()) setPreview(next); })}>{zh ? "預覽帶來源待辦" : "Preview cited task"}</button></article>)}
      <label>{zh ? "補充／改善文件（人工內容不代表已驗證結論）" : "Document notes (manual text is not a verified conclusion)"}<textarea className="investigation-notes" rows={4} maxLength={32000} disabled={busy} value={artifact.notes} onChange={event => edit(previous => ({ ...previous, notes: event.target.value }))} /></label>
      <div className="source-actions"><button type="button" disabled={busy || !valid || !sample && vault.status.state !== "unlocked"} onClick={() => void act(async current => { await saveInvestigation(artifact, repository); if (current()) { setSampleVersion(sample?.version || sampleVersion + 1); setMessage(sample ? "Sample draft saved in memory" : "Investigation saved encrypted"); } })}>{sample ? zh ? "儲存案例草稿（記憶體）" : "Save sample draft (memory)" : zh ? "儲存加密查證文件" : "Save encrypted investigation"}</button><button type="button" disabled={busy || !valid} onClick={() => void act(async current => { const result = await exportInvestigation(artifact, repository, language); if (current()) setMessage(result?.canceled ? "Export cancelled" : "Plaintext export completed after confirmation"); })}>{zh ? "確認後匯出明文文件" : "Export plaintext after confirmation"}</button></div>
    </section>}
    {preview && <section className="investigation-task-preview"><h4>{zh ? "確認待辦預覽" : "Confirm task preview"}</h4><pre>{preview.text}</pre><p>{sample ? zh ? "僅建立案例待辦，不寫入你的筆記或秘書。" : "Creates a case task only; nothing enters your notes or secretary." : zh ? "將建立私密秘書待辦並保存來源；不設定鬧鐘。" : "Creates a private secretary task with sources; no alarm is scheduled."}</p><button type="button" disabled={busy || !valid} onClick={() => void act(async current => { const task = await confirmInvestigationTask(preview); if (current()) { setPreview(null); setMessage(`Cited task confirmed: ${task.title}`); setSampleVersion(sample?.version || sampleVersion + 1); } })}>{zh ? "確認建立這項待辦" : "Confirm this cited task"}</button><button type="button" disabled={busy} onClick={() => setPreview(null)}>{zh ? "取消預覽" : "Cancel preview"}</button></section>}
    {!!savedIds.length && <details><summary>{zh ? "已儲存查證文件" : "Saved investigations"}</summary>{savedIds.map(id => <button type="button" key={id} disabled={busy} onClick={() => void act(async current => { const saved = await loadInvestigation(id, repository); if (current()) { setArtifact(saved); setQuestion(saved.question); setPreview(null); } })}>{zh ? "載入" : "Load"}: {id.slice(0, 8)}</button>)}</details>}
    {sample && <><p>{zh ? "案例待辦數量" : "Sample task count"}: {sample.tasks.size}</p><details><summary>{zh ? "合成失效情境測試" : "Synthetic invalidation checks"}</summary><button type="button" disabled={busy} onClick={() => { sample.edit("sample:qc", "QC report: FG-17 source changed. New reading requires review."); setSampleVersion(sample.version); }}>{zh ? "模擬 QC 來源改變" : "Simulate QC source change"}</button><button type="button" disabled={busy} onClick={() => { sample.delete("sample:sop"); setSampleVersion(sample.version); }}>{zh ? "模擬 SOP 來源刪除" : "Simulate SOP source deletion"}</button></details></>}
    {message && <p role="status">{message}</p>}
  </details>;
}
