import { useEffect, useRef, useState } from "react";
import { useI18n } from "../hooks/useI18n";
import { useSecureVault } from "../hooks/useSecureVault";
import { savePrivateItem, type PrivateItem } from "../lib/secureSecretary";
import { acknowledgeReminder, cancelLocalReminder, confirmReminder, importSelectedMockSources, mockSources, mutateReminderTask, parseReminder, reminderDisplayTime, simulateDestination, wallTimeCandidates, type Destination, type ReminderOperation, type ReminderProposal, type Repeat } from "../lib/secretary";
import { startLocalSpeech, type LocalRecognitionConstructor } from "../lib/localSpeech";
import { reserveMockCost } from "../lib/secretaryBudget";
import { SecureVaultControls } from "./SecureVaultControls";

function PrivateTaskEditor({ item, operation, disabled, act }: { item: PrivateItem; operation?: ReminderOperation; disabled: boolean; act: (action: () => Promise<void>) => Promise<void> }) {
  const [title, setTitle] = useState(item.title); const [wall, setWall] = useState(operation ? reminderDisplayTime(operation) : "");
  useEffect(() => { setTitle(item.title); setWall(operation ? reminderDisplayTime(operation) : ""); }, [item.title, operation?.nextDueAt]);
  return <article><b>{item.title}</b><p>{operation ? `${reminderDisplayTime(operation)} · ${operation.timeZone}` : "Private task"} · {item.done ? "done" : "open"}</p>
    <button disabled={disabled} onClick={() => void act(async () => { await mutateReminderTask(item.id, { done: !item.done }); })}>{item.done ? "Reopen task (reminder stays cancelled)" : "Complete private task"}</button>
    <button disabled={disabled} onClick={() => void act(async () => { await mutateReminderTask(item.id, { delete: true }); })}>Delete private task</button>
    <details><summary>Edit private task</summary><label>Title<input value={title} onChange={event => setTitle(event.target.value)} /></label>{operation && <label>Date and time · {operation.timeZone}<input type="datetime-local" value={wall} onChange={event => setWall(event.target.value)} /></label>}
      <button disabled={disabled} onClick={() => void act(async () => { let dueAt: number | undefined; if (operation) { const candidates = wallTimeCandidates(wall, operation.timeZone); if (candidates.length !== 1) throw new Error("Choose an unambiguous local time"); dueAt = candidates[0]; } await mutateReminderTask(item.id, { title, dueAt }); })}>Save private task changes</button>
    </details>
  </article>;
}
export function SecretaryPanel() {
  const { language } = useI18n(); const zh = language.startsWith("zh");
  const { status: vaultStatus, data } = useSecureVault(); const unlocked = vaultStatus.state === "unlocked";
  const [text, setText] = useState(""); const [wall, setWall] = useState(""); const [zone, setZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [repeat, setRepeat] = useState<Repeat>("once"); const [occurrence, setOccurrence] = useState(""); const [destinations, setDestinations] = useState<Destination[]>(["local"]);
  const [proposal, setProposal] = useState<ReminderProposal | null>(null); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false); const [selected, setSelected] = useState<string[]>([]); const [mockPermission, setMockPermission] = useState(false);
  const importId = useRef(crypto.randomUUID()); const budgetId = useRef(crypto.randomUUID()); const lock = useRef(false);
  const stopSpeech = useRef<(() => void) | null>(null); const speechController = useRef<AbortController | null>(null);
  const operations = Object.entries(data.entries).filter(([key]) => key.startsWith("secretary-operation:")).map(([, value]) => value as ReminderOperation);
  const privateItems = Object.entries(data.entries).filter(([key]) => key.startsWith("secretary-item:")).map(([, value]) => value as PrivateItem);
  useEffect(() => { setProposal(null); }, [text, wall, zone, repeat, occurrence, destinations]);
  useEffect(() => () => { speechController.current?.abort(); stopSpeech.current?.(); }, []);
  useEffect(() => { if (!unlocked) { speechController.current?.abort(); stopSpeech.current?.(); speechController.current = null; setListening(false); setText(""); setWall(""); setProposal(null); setMessage(""); } }, [unlocked]);
  async function act(action: () => Promise<void>) {
    if (lock.current || !unlocked) return; lock.current = true; setBusy(true); setMessage("");
    try { await action(); } catch (error) { setMessage(error instanceof Error ? error.message : "Local operation failed"); }
    finally { lock.current = false; setBusy(false); }
  }
  async function voice() {
    if (!unlocked) return;
    if (speechController.current) { speechController.current.abort(); stopSpeech.current?.(); speechController.current = null; setListening(false); return; }
    const controller = new AbortController(); speechController.current = controller; setListening(true); setMessage("");
    try {
      const Constructor = (window as unknown as { SpeechRecognition?: LocalRecognitionConstructor }).SpeechRecognition;
      stopSpeech.current = await startLocalSpeech(Constructor, language, transcript => { if (!controller.signal.aborted) setText(value => `${value}${value ? "\n" : ""}${transcript}`); }, () => { speechController.current = null; setListening(false); }, error => setMessage(error), controller.signal);
    } catch (error) { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "Speech unavailable"); speechController.current = null; setListening(false); }
  }
  function propose() {
    try { setProposal(parseReminder(text, wall || text.match(/\d{4}-\d\d-\d\d[ T]\d\d:\d\d/)?.[0].replace(" ", "T") || "", zone, repeat, destinations, occurrence ? Number(occurrence) : undefined)); setMessage(""); }
    catch (error) { setProposal(null); setMessage(error instanceof Error ? error.message : "Invalid proposal"); }
  }
  return <details className="source-workbench secretary-panel" open>
    <summary>{zh ? "隨身秘書 · 私人本機切片" : "Local secretary · private slice"}</summary>
    <p>{zh ? "提醒只在 App 開著時提示、重開補提示，沒有背景／鎖屏鬧鐘。私人項目留在加密 vault，不進舊筆記同步或明文備份。" : "Reminders run while open and catch up on reopening; no background/lock-screen alarm. Private items stay in the encrypted vault, outside legacy note sync and plaintext backups."}</p>
    <SecureVaultControls />
    <fieldset className="secretary-sensitive" disabled={busy || !unlocked}>
      <label>{zh ? "秘書輸入" : "Secretary input"}<textarea rows={3} value={text} onChange={event => setText(event.target.value)} /></label>
      <div className="source-actions"><button type="button" onClick={() => void voice()}>{listening ? zh ? "停止語音" : "Stop voice" : zh ? "裝置端語音" : "On-device voice"}</button><button disabled={!text.trim()} onClick={() => void act(async () => { await savePrivateItem("task", text); setText(""); setMessage("Private task saved"); })}>{zh ? "儲存私人待辦" : "Save task"}</button><button disabled={!text.trim()} onClick={() => void act(async () => { await savePrivateItem("note", text); setText(""); setMessage("Private note saved"); })}>{zh ? "儲存私人筆記" : "Save note"}</button></div>
      <p>{zh ? "語音只用已可用的裝置端辨識；不下載語言包、不轉雲端。權限拒絕仍可打字。" : "Voice uses an already available on-device recognizer only; no language-pack download or cloud fallback."}</p>
      <label>{zh ? "日期時間" : "Date and time"}<input type="datetime-local" value={wall} onChange={event => setWall(event.target.value)} /></label>
      <label>{zh ? "IANA 時區" : "IANA time zone"}<input value={zone} onChange={event => setZone(event.target.value)} /></label>
      <label>{zh ? "重複" : "Repeat"}<select value={repeat} onChange={event => setRepeat(event.target.value as Repeat)}><option value="once">{zh ? "一次" : "Once"}</option><option value="daily">{zh ? "每日" : "Daily"}</option><option value="weekly">{zh ? "每週" : "Weekly"}</option></select></label>
      <label>{zh ? "DST 重複時刻" : "DST overlapping time"}<select value={occurrence} onChange={event => setOccurrence(event.target.value)}><option value="">{zh ? "遇到重複時先問" : "Ask if ambiguous"}</option><option value="0">{zh ? "較早一次" : "Earlier occurrence"}</option><option value="1">{zh ? "較晚一次" : "Later occurrence"}</option></select></label>
      <fieldset><legend>{zh ? "目的地" : "Destinations"}</legend>{(["local", "calendar-mock", "clock-mock"] as Destination[]).map(destination => <label key={destination}><input type="checkbox" checked={destinations.includes(destination)} onChange={() => setDestinations(items => items.includes(destination) ? items.filter(item => item !== destination) : [...items, destination])} />{destination === "local" ? zh ? "本機提醒" : "In-app reminder" : destination === "calendar-mock" ? "Google Calendar · MOCK" : "Android Clock · MOCK"}</label>)}</fieldset>
      <button disabled={!text.trim()} onClick={propose}>{zh ? "解析提醒提案" : "Preview reminder proposal"}</button>
      {proposal && <section className="secretary-proposal"><h3>{zh ? "待同意，尚未建立" : "Awaiting consent; not created"}</h3><p>{proposal.title}</p><p>{proposal.wallTime} · {proposal.timeZone} · {proposal.repeat}</p><p>UTC: {new Date(proposal.instant).toISOString()} · {proposal.destinations.join(" / ")}</p><p>{zh ? "提案有效五分鐘；時間跨過目標時必須重新預覽。" : "Proposal expires in five minutes; crossing the target time requires a fresh preview."}</p>{proposal.overdueAtIssue && <p>{zh ? "此時間已過，確認會立即補提示。" : "This time is past; confirmation will immediately catch up."}</p>}<button onClick={() => void act(async () => { await confirmReminder(proposal, { acknowledgeOverdue: proposal.overdueAtIssue }); window.dispatchEvent(new Event("chengjing:reminders-changed")); setProposal(null); setMessage("Encrypted local operation created; no real calendar/clock action."); })}>{proposal.overdueAtIssue ? zh ? "確認建立已過期提醒，立即補提示" : "Confirm overdue reminder and immediate catch-up" : zh ? "同意建立" : "Confirm creation"}</button></section>}
      <p>{zh ? "Clock mock 拒絕任意日期單次鬧鐘；重複鬧鐘仍待確認。Calendar 狀態獨立，成功不重送。" : "Clock mock rejects arbitrary-date one-shot alarms; recurring alarms await confirmation. Calendar states are independent and successful destinations are not repeated."}</p>
      <label><input type="checkbox" checked={mockPermission} onChange={event => setMockPermission(event.target.checked)} />{zh ? "模擬准許連接器（無真實權限請求）" : "Simulate connector permission (no real permission request)"}</label>
      <div className="secretary-operations">{operations.map(operation => <article key={operation.id}><b>{operation.title}</b><p>{reminderDisplayTime(operation)} · {operation.timeZone} · {operation.status}</p><small>Operation: {operation.id}</small><p>{Object.entries(operation.destinationsState).map(([destination, state]) => `${destination}: ${state}`).join(" / ")}</p>{operation.status === "due" && <button onClick={() => void act(async () => { await acknowledgeReminder(operation.id); window.dispatchEvent(new Event("chengjing:reminders-changed")); })}>{zh ? "已看到" : "Acknowledge"}</button>}{operation.destinations.filter(destination => destination !== "local").map(destination => <button key={destination} onClick={() => void act(async () => { setMessage(await simulateDestination(operation.id, destination as "calendar-mock" | "clock-mock", mockPermission)); })}>{zh ? "模擬／重試" : "Simulate/retry"} {destination}</button>)}</article>)}</div>
      <details><summary>{zh ? "取消本機提醒" : "Cancel an in-app reminder"}</summary>{operations.filter(operation => operation.destinations.includes("local") && !["done", "cancelled"].includes(operation.status)).map(operation => <button key={operation.id} onClick={() => void act(async () => { await cancelLocalReminder(operation.id); window.dispatchEvent(new Event("chengjing:reminders-changed")); })}>{zh ? "取消" : "Cancel"}: {operation.title}</button>)}</details>
      <details><summary>{zh ? "私人筆記／待辦" : "Private notes / tasks"}</summary>{privateItems.map(item => item.kind === "task" ? <PrivateTaskEditor key={item.id} item={item} operation={operations.find(operation => operation.taskId === item.id)} disabled={busy} act={act} /> : <article key={item.id}><b>{item.title}</b><pre>{item.plainText}</pre></article>)}</details>
      <details><summary>{zh ? "選定雲端來源 · MOCK" : "Selected cloud sources · MOCK"}</summary><p>{zh ? "只有合成示例，沒有 OAuth／網路讀取；只匯入已選來源。" : "Synthetic examples only: no OAuth/network reads; only selected sources are imported."}</p>{mockSources.map(source => <label key={source.id}><input type="checkbox" checked={selected.includes(source.id)} onChange={() => { importId.current = crypto.randomUUID(); setSelected(items => items.includes(source.id) ? items.filter(item => item !== source.id) : [...items, source.id]); }} />{source.provider}: {source.title}<small>{source.scope}</small></label>)}<button disabled={!selected.length} onClick={() => void act(async () => { await importSelectedMockSources(selected, mockPermission, importId.current); setMessage("Selected mock sources imported"); })}>{zh ? "匯入所選 mock" : "Import selected mocks"}</button></details>
      <details><summary>{zh ? "API 預算 · MOCK" : "API budget · MOCK"}</summary><p>{zh ? "NT$100／月為規劃目標。正式雲端 AI 暫停，等待共享帳本及可信費率；不是帳務硬上限，也不是每台裝置配額。" : "NT$100/month is a planning target. Cloud AI is paused pending a shared coordinator and verified pricing; this is neither a provider billing cap nor a per-device allowance."}</p><p>Mock: input 2000 + output max 1000, retries 1, USD/M 1/2, USD/TWD 35, buffer 1.3.</p><button onClick={() => void act(async () => { const amount = await reserveMockCost(budgetId.current, { inputTokens: 2000, maxOutputTokens: 1000, retries: 1, inputUsdPerMillion: 1, outputUsdPerMillion: 2, usdToTwd: 35, buffer: 1.3 }); setMessage(`MOCK reserved NT$${amount.toFixed(4)}; same operation is deduplicated.`); })}>{zh ? "模擬原子預留" : "Simulate atomic reservation"}</button></details>
    </fieldset>
    {message && <p role="status">{message}</p>}
  </details>;
}
