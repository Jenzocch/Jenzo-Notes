import { useEffect, useRef, useState } from "react";
import { ImageIdeaCapture } from "./ImageIdeaCapture";
import type { CardRecord } from "../types";
import { cancelPlanning, confirmPlanning, createMockGoogleConnector, planningQuestions, proposePlanning, repreviewPlanning, syncPlanning, type GoogleConnectionState, type GooglePlanningDestination, type PlanningInput, type PlanningKind, type PlanningOperation, type PlanningProposal } from "../lib/googlePlanning";
import { useSecureVault } from "../hooks/useSecureVault";

const empty = (zone: string): PlanningInput => ({ kind: "task", title: "", details: "", wallTime: "", timeZone: zone, location: "", reminderMinutes: "20", dueDate: "", noDueDate: false, origin: "", transport: "", travelMinutes: "", preparationMinutes: "", trafficMinutes: "", destinations: ["google-tasks"] });

function instantLabel(value: number | undefined, zone: string) {
  if (value === undefined) return "";
  return new Intl.DateTimeFormat("zh-TW", { timeZone: zone, dateStyle: "full", timeStyle: "short" }).format(value);
}

export function GooglePlanningPanel({ capturedText, disabled }: { capturedText: string; disabled: boolean }) {
  const { status, data } = useSecureVault(); const unlocked = status.state === "unlocked";
  const [input, setInput] = useState(() => empty(Intl.DateTimeFormat().resolvedOptions().timeZone));
  const [proposal, setProposal] = useState<PlanningProposal | null>(null);
  const [operation, setOperation] = useState<PlanningOperation | null>(null);
  const [imageCard, setImageCard] = useState<CardRecord | null>(null);
  const [connection, setConnection] = useState<GoogleConnectionState>("not-connected");
  const [failure, setFailure] = useState<GooglePlanningDestination | "">("");
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const controller = useRef<AbortController | null>(null);
  const session = useRef(0); const unlockedRef = useRef(unlocked); const observedUnlock = useRef(unlocked);
  if (observedUnlock.current !== unlocked) { observedUnlock.current = unlocked; session.current++; controller.current?.abort(); controller.current = null; }
  unlockedRef.current = unlocked;
  const questions = planningQuestions(input);
  useEffect(() => { setProposal(null); }, [input]);
  useEffect(() => {
    controller.current?.abort(); controller.current = null;
    if (!unlocked) { setInput(empty(Intl.DateTimeFormat().resolvedOptions().timeZone)); setProposal(null); setOperation(null); setImageCard(null); setConnection("not-connected"); setFailure(""); setBusy(false); setMessage(""); }
  }, [unlocked]);
  useEffect(() => {
    if (!unlocked) { setOperation(null); return; }
    const saved = Object.entries(data.entries).filter(([key]) => key.startsWith("secretary-google-planning:")).map(([, value]) => value as PlanningOperation).sort((left, right) => right.createdAt - left.createdAt)[0];
    setOperation(saved || null);
  }, [data, unlocked]);
  useEffect(() => () => { session.current++; unlockedRef.current = false; controller.current?.abort(); }, []);
  const isCurrent = (token: number) => unlockedRef.current && session.current === token;
  function patch(value: Partial<PlanningInput>) { setInput(current => ({ ...current, ...value })); setMessage(""); }
  function changeKind(kind: PlanningKind) {
    setImageCard(null); setProposal(null); setMessage(""); setInput({ ...empty(input.timeZone), kind, title: input.title, details: input.details, destinations: kind === "task" ? ["google-tasks"] : ["google-calendar"], reminderMinutes: kind === "online-meeting" ? "20" : input.reminderMinutes });
  }
  async function act(action: (token: number) => Promise<void>) { if (busy || disabled || !unlockedRef.current) return; const token = session.current; setBusy(true); setMessage(""); try { await action(token); } catch (error) { if (isCurrent(token)) setMessage(error instanceof Error ? error.message : String(error)); } finally { if (isCurrent(token)) setBusy(false); } }
  if (!unlocked) return <details className="google-planning-panel"><summary>Google Calendar / Tasks 規劃草稿 · MOCK</summary><p>解鎖私人儲存後才能查看或編輯規劃草稿。</p></details>;
  return <details className="google-planning-panel">
    <summary>Google Calendar / Tasks 規劃草稿 · MOCK</summary>
    <p>先在加密 vault 補齊問題並預覽，再由你確認。不會自動把私人文字降級保存成一般 Notes 待辦。此版本沒有 OAuth、憑證或真實 Google 寫入；MOCK 狀態不代表已同步。Calendar 通知不是準時鬧鐘。</p>
    <div className="planning-grid">
      <label>類型<select name="planning-kind" value={input.kind} disabled={busy} onChange={event => changeKind(event.target.value as PlanningKind)}><option value="task">私人規劃待辦</option><option value="online-meeting">線上會議</option><option value="international-flight">國際航班行前規劃</option></select></label>
      <label>標題<input name="planning-title" value={input.title} disabled={busy} onChange={event => patch({ title: event.target.value })} /></label>
      <label>要保留的細節<textarea name="planning-details" rows={3} value={input.details} disabled={busy} onChange={event => patch({ details: event.target.value })} /></label>
      {!!capturedText.trim() && <button type="button" disabled={busy} onClick={() => patch({ title: input.title || capturedText.trim().split("\n")[0].slice(0, 500), details: input.details || capturedText.trim() })}>帶入上方裝置端語音／文字</button>}
      {input.kind === "task" ? <>
        <label>到期日（Google Tasks 只保存日期，不保存到期時間）<input name="planning-due-date" type="date" value={input.dueDate} disabled={busy || input.noDueDate} onChange={event => patch({ dueDate: event.target.value })} /></label>
        <label><input name="planning-no-due-date" type="checkbox" checked={input.noDueDate} disabled={busy} onChange={event => patch({ noDueDate: event.target.checked, dueDate: event.target.checked ? "" : input.dueDate })} />明確設為無到期日</label>
        <details><summary>直接拍照／選照片，連回此待辦（一般 Notes）</summary><p>照片、來源、OCR 與校正文字只保存在 Notes；Google Tasks 不支援由這個流程寫入附件，因此只送安全的 Notes 卡片參照，不送本機檔案路徑。</p><ImageIdeaCapture onSaved={card => { if (unlockedRef.current) { setImageCard(card); patch({ imageCardId: card.id }); } }} />{imageCard && <p>已連結：{imageCard.title} · {imageCard.id}</p>}</details>
      </> : <>
        <label>{input.kind === "international-flight" ? "航班起飛日期時間" : "會議開始日期時間"}<input type="datetime-local" value={input.wallTime} disabled={busy} onChange={event => patch({ wallTime: event.target.value })} /></label>
        <label>IANA 時區<input value={input.timeZone} disabled={busy} onChange={event => patch({ timeZone: event.target.value })} /></label>
        <label>{input.kind === "international-flight" ? "出發機場／航廈" : "會議連結／地點"}<input value={input.location} disabled={busy} onChange={event => patch({ location: event.target.value })} /></label>
        <label>Calendar 提前通知（分鐘）<input type="number" min="0" max="40320" value={input.reminderMinutes} disabled={busy} onChange={event => patch({ reminderMinutes: event.target.value })} /></label>
      </>}
      {input.kind === "international-flight" && <>
        <p>以下是你的行程規劃偏好，不是航空公司通則：目標在起飛前 3 小時抵達機場，再扣除交通、準備與壅塞緩衝。資料不完整就不猜。</p>
        <label>前往機場的出發地<input value={input.origin} disabled={busy} onChange={event => patch({ origin: event.target.value })} /></label>
        <label>交通方式<input value={input.transport} disabled={busy} onChange={event => patch({ transport: event.target.value })} /></label>
        <label>一般交通分鐘<input type="number" min="1" max="1440" value={input.travelMinutes} disabled={busy} onChange={event => patch({ travelMinutes: event.target.value })} /></label>
        <label>出門前準備分鐘<input type="number" min="0" max="1440" value={input.preparationMinutes} disabled={busy} onChange={event => patch({ preparationMinutes: event.target.value })} /></label>
        <label>交通／壅塞緩衝分鐘<input type="number" min="0" max="1440" value={input.trafficMinutes} disabled={busy} onChange={event => patch({ trafficMinutes: event.target.value })} /></label>
      </>}
      <fieldset><legend>目的地</legend>{(["google-calendar", "google-tasks"] as const).map(destination => <label key={destination}><input type="checkbox" disabled={busy || input.kind === "task" && destination === "google-calendar"} checked={input.destinations.includes(destination)} onChange={() => patch({ destinations: input.destinations.includes(destination) ? input.destinations.filter(value => value !== destination) : [...input.destinations, destination] })} />{destination === "google-calendar" ? "Google Calendar" : "Google Tasks"}</label>)}</fieldset>
    </div>
    {!!questions.length && <section className="secretary-proposal"><h3>需要追問，尚不能建立</h3><ul>{questions.map(question => <li key={question}>{question}</li>)}</ul></section>}
    <button type="button" disabled={busy || !!questions.length} onClick={() => void act(async token => { const result = await proposePlanning({ ...input, imageCardId: imageCard?.id }); if (isCurrent(token)) { setProposal(result); setMessage(""); } })}>預覽待確認草稿</button>
    {proposal && <section className="secretary-proposal"><h3>待你確認，尚未建立／同步</h3><p>{proposal.input.title}</p><p>{proposal.input.details}</p>{proposal.input.kind === "task" && <p>Google Tasks 到期日：{proposal.input.dueDate || "無到期日"}</p>}{proposal.startInstant !== undefined && <p>原始時間：{instantLabel(proposal.startInstant, proposal.input.timeZone)} · {proposal.input.timeZone}</p>}{proposal.airportArrivalInstant !== undefined && <p>目標抵達機場：{instantLabel(proposal.airportArrivalInstant, proposal.input.timeZone)}</p>}{proposal.leaveInstant !== undefined && <p>規劃開始準備／出發：{instantLabel(proposal.leaveInstant, proposal.input.timeZone)}（可能跨日，請核對）</p>}<p>目的地：{proposal.input.destinations.join(" / ")}</p><button type="button" disabled={busy} onClick={() => void act(async token => { const result = await confirmPlanning(proposal); if (isCurrent(token)) { setOperation(result); setProposal(null); setMessage("已保存加密本機規劃；沒有建立一般 Notes 待辦，Google 尚未同步。"); } })}>確認本機建立</button></section>}
    {operation && <section className="secretary-proposal"><h3>已確認的本機作業</h3><b>{operation.input.title}</b><p>{operation.status} · {Object.entries(operation.sync).map(([key, value]) => `${key}: ${value}`).join(" / ")}</p>{operation.status === "source-revoked" && <p>圖片來源同意已永久撤銷；即使檔案還原也不會自動恢復。必須重新預覽並確認，已成功目的地不會重送。</p>}<label>連線狀態（僅合成測試）<select name="planning-connection" value={connection} disabled={busy} onChange={event => setConnection(event.target.value as GoogleConnectionState)}><option value="not-connected">未連接</option><option value="connected">MOCK 已連接</option><option value="token-invalid">MOCK token 失效</option></select></label><label>模擬單一目的地失敗<select name="planning-failure" value={failure} disabled={busy} onChange={event => setFailure(event.target.value as GooglePlanningDestination | "")}><option value="">不失敗</option><option value="google-calendar">Calendar 失敗</option><option value="google-tasks">Tasks 失敗</option></select></label><div className="source-actions">{operation.status === "source-revoked" && <button type="button" disabled={busy} onClick={() => void act(async token => { const result = await repreviewPlanning(operation.id); if (isCurrent(token)) { setProposal(result); setMessage("請重新核對來源與 payload，再確認換發來源同意。"); } })}>重新預覽來源同意</button>}<button type="button" disabled={busy || operation.status === "cancelled" || operation.status === "source-revoked"} onClick={() => void act(async token => { const abort = new AbortController(); controller.current = abort; const result = await syncPlanning(operation.id, createMockGoogleConnector(connection, failure || undefined), abort.signal); if (isCurrent(token)) { setOperation(result); setMessage("MOCK 執行完成；沒有寫入 Google。"); controller.current = null; } })}>執行／重試 MOCK</button>{busy && controller.current && <button type="button" onClick={() => { controller.current?.abort(); controller.current = null; setMessage("已要求取消；真實連接器若已送出則不能假設遠端已撤回。"); }}>取消進行中操作</button>}<button type="button" disabled={busy || operation.status === "cancelled" || Object.values(operation.sync).includes("created")} onClick={() => void act(async token => { const result = await cancelPlanning(operation.id); if (isCurrent(token)) { setOperation(result); setMessage("已取消本機作業；未建立 Google 項目。"); } })}>取消未同步作業</button></div></section>}
    {message && <p role="status">{message}</p>}
  </details>;
}
