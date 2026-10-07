import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { createCard, db } from "../db";
import { useI18n } from "../hooks/useI18n";
import { renderSafeMarkdown } from "../lib/safeMarkdown";
import { literalMarkdown } from "../lib/sourceWorkbench";
import { acknowledgeReminder, cancelLocalReminder, confirmReminder, importSelectedMockSources, listReminders, mockSources, parseReminder, simulateDestination, type Destination, type ReminderProposal, type Repeat } from "../lib/secretary";
import { startLocalSpeech, type LocalRecognitionConstructor } from "../lib/localSpeech";
import { reserveMockCost } from "../lib/secretaryBudget";

export function SecretaryPanel() {
  const { language } = useI18n(); const zh = language.startsWith("zh");
  const [text, setText] = useState(""); const [wall, setWall] = useState("");
  const [zone, setZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [repeat, setRepeat] = useState<Repeat>("once"); const [occurrence, setOccurrence] = useState("");
  const [destinations, setDestinations] = useState<Destination[]>(["local"]);
  const [proposal, setProposal] = useState<ReminderProposal | null>(null);
  const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false); const [selected, setSelected] = useState<string[]>([]);
  const [mockPermission, setMockPermission] = useState(false);
  const importId = useRef(crypto.randomUUID()); const budgetId = useRef(crypto.randomUUID());
  const lock = useRef(false); const stopSpeech = useRef<(() => void) | null>(null); const speechController = useRef<AbortController | null>(null);
  const operations = useLiveQuery(listReminders, [], []);
  useEffect(() => { setProposal(null); }, [text, wall, zone, repeat, occurrence, destinations]);
  useEffect(() => () => { speechController.current?.abort(); stopSpeech.current?.(); }, []);
  async function act(action: () => Promise<void>) {
    if (lock.current) return; lock.current = true; setBusy(true); setMessage("");
    try { await action(); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { lock.current = false; setBusy(false); }
  }
  async function voice() {
    if (speechController.current) { speechController.current.abort(); stopSpeech.current?.(); speechController.current = null; setListening(false); return; }
    const controller = new AbortController(); speechController.current = controller; setListening(true); setMessage("");
    try {
      const Constructor = (window as unknown as { SpeechRecognition?: LocalRecognitionConstructor }).SpeechRecognition;
      stopSpeech.current = await startLocalSpeech(Constructor, language, transcript => { if (!controller.signal.aborted) setText(value => `${value}${value ? "\n" : ""}${transcript}`); }, () => { speechController.current = null; setListening(false); }, error => setMessage(error), controller.signal);
    } catch (error) { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : String(error)); speechController.current = null; setListening(false); }
  }
  function propose() {
    try { setProposal(parseReminder(text, wall || text.match(/\d{4}-\d\d-\d\d[ T]\d\d:\d\d/)?.[0].replace(" ", "T") || "", zone, repeat, destinations, occurrence ? Number(occurrence) : undefined)); setMessage(""); }
    catch (error) { setProposal(null); setMessage(error instanceof Error ? error.message : String(error)); }
  }
  return <details className="source-workbench secretary-panel" open>
    <summary>{zh ? "隨身秘書 · 本機優先" : "Local secretary"}</summary>
    <p>{zh ? "文字、貼上或點擊語音，先留下，再確認動作。提醒僅在 App 開啟時提示，關閉後重新開啟會補列逾期；尚未提供鎖屏鬧鈴。" : "Type, paste or click for voice, then confirm actions. In-app reminders run while the app is open and catch up on reopening; lock-screen alarms are not implemented."}</p>
    <label>{zh ? "秘書輸入" : "Secretary input"}<textarea rows={3} value={text} onChange={event => setText(event.target.value)} disabled={busy} /></label>
    <div className="source-actions"><button type="button" disabled={busy} onClick={() => void voice()}>{listening ? zh ? "停止語音" : "Stop voice" : zh ? "裝置端語音" : "On-device voice"}</button><button disabled={busy || !text.trim()} onClick={() => void act(async () => { const now = Date.now(); await db.tasks.add({ id: crypto.randomUUID(), title: text.trim(), done: false, createdAt: now, updatedAt: now }); setText(""); setMessage(zh ? "已存待辦" : "Task saved"); })}>{zh ? "存為待辦" : "Save task"}</button><button disabled={busy || !text.trim()} onClick={() => void act(async () => { await createCard({ title: text.trim().split("\n")[0].slice(0, 100), plainText: text.trim(), contentHtml: renderSafeMarkdown(literalMarkdown(text.trim())), kind: "note", state: "active" }); setText(""); setMessage(zh ? "已存筆記" : "Note saved"); })}>{zh ? "存為筆記" : "Save note"}</button></div>
    <p>{zh ? "語音只用已可用的裝置端辨識；不下載語言包、不切換雲端。權限拒絕時仍可打字。" : "Voice requires available on-device recognition. No language-pack download or cloud fallback; typing remains available if permission is denied."}</p>
    <label>{zh ? "日期時間" : "Date and time"}<input type="datetime-local" value={wall} disabled={busy} onChange={event => setWall(event.target.value)} /></label>
    <label>{zh ? "IANA 時區" : "IANA time zone"}<input value={zone} disabled={busy} onChange={event => setZone(event.target.value)} /></label>
    <label>{zh ? "重複" : "Repeat"}<select value={repeat} disabled={busy} onChange={event => setRepeat(event.target.value as Repeat)}><option value="once">{zh ? "一次" : "Once"}</option><option value="daily">{zh ? "每天" : "Daily"}</option><option value="weekly">{zh ? "每週" : "Weekly"}</option></select></label>
    <label>{zh ? "DST 重複時刻" : "DST overlapping time"}<select value={occurrence} disabled={busy} onChange={event => setOccurrence(event.target.value)}><option value="">{zh ? "遇到重複先詢問" : "Ask if ambiguous"}</option><option value="0">{zh ? "較早一次" : "Earlier occurrence"}</option><option value="1">{zh ? "較晚一次" : "Later occurrence"}</option></select></label>
    <fieldset><legend>{zh ? "目的地" : "Destinations"}</legend>{(["local", "calendar-mock", "clock-mock"] as Destination[]).map(destination => <label key={destination}><input type="checkbox" checked={destinations.includes(destination)} disabled={busy} onChange={() => setDestinations(items => items.includes(destination) ? items.filter(item => item !== destination) : [...items, destination])} />{destination === "local" ? zh ? "本機提醒" : "In-app reminder" : destination === "calendar-mock" ? "Google Calendar · MOCK" : "Android Clock · MOCK"}</label>)}</fieldset>
    <button disabled={busy || !text.trim()} onClick={propose}>{zh ? "解析提醒提案" : "Preview reminder proposal"}</button>
    {proposal && <section className="secretary-proposal"><h3>{zh ? "待同意，尚未建立" : "Awaiting consent; not created"}</h3><p>{proposal.title}</p><p>{proposal.wallTime} · {proposal.timeZone} · {proposal.repeat}</p><p>UTC: {new Date(proposal.instant).toISOString()} · {proposal.destinations.join(" / ")}</p>{proposal.instant <= Date.now() && <p>{zh ? "此時間已過，確認後會列為逾期。" : "This time is past; confirmation will show it as overdue."}</p>}<button disabled={busy} onClick={() => void act(async () => { await confirmReminder(proposal); window.dispatchEvent(new Event("chengjing:reminders-changed")); setProposal(null); setMessage(zh ? "已建立本機操作；mock 目的地須分別模擬，沒有真實雲端或時鐘動作。" : "Local operation created. Mock destinations must be simulated separately; no real cloud or clock action occurred."); })}>{zh ? "同意建立" : "Confirm creation"}</button></section>}
    <p>{zh ? "時鐘 mock 不接受任意日期的一次鬧鐘；重複鬧鐘只標示待時鐘確認，不代表已建立。Calendar 狀態獨立保存，成功項不重做。" : "Clock mock rejects arbitrary-date one-shot alarms; recurring alarms remain awaiting clock confirmation, not verified creation. Calendar status is independent; successful destinations are not repeated."}</p>
    <label><input type="checkbox" checked={mockPermission} onChange={event => setMockPermission(event.target.checked)} />{zh ? "模擬允許連接器（未申請真實權限）" : "Simulate connector permission (no real permission request)"}</label>
    <div className="secretary-operations">{operations.map(operation => <article key={operation.id}><b>{operation.title}</b><p>{operation.wallTime} · {operation.timeZone} · {operation.status}</p><small>Operation: {operation.id}</small><p>{Object.entries(operation.destinationsState).map(([destination, state]) => `${destination}: ${state}`).join(" / ")}</p>{operation.status === "due" && <button disabled={busy} onClick={() => void act(async () => { await acknowledgeReminder(operation.id); })}>{zh ? "已看到" : "Acknowledge"}</button>}{operation.destinations.filter(destination => destination !== "local").map(destination => <button disabled={busy} key={destination} onClick={() => void act(async () => { const state = await simulateDestination(operation.id, destination as "calendar-mock" | "clock-mock", mockPermission); setMessage(state); })}>{zh ? "模擬／重試" : "Simulate/retry"} {destination}</button>)}</article>)}</div>
    <details><summary>{zh ? "取消本機提醒" : "Cancel an in-app reminder"}</summary>{operations.filter(operation => operation.destinations.includes("local") && !["done", "cancelled"].includes(operation.status)).map(operation => <button disabled={busy} key={operation.id} onClick={() => void act(async () => { await cancelLocalReminder(operation.id); window.dispatchEvent(new Event("chengjing:reminders-changed")); })}>{zh ? "取消" : "Cancel"}: {operation.title}</button>)}</details>
    <details><summary>{zh ? "選定雲端來源 · MOCK" : "Selected cloud sources · MOCK"}</summary><p>{zh ? "只有合成示例，沒有 OAuth 或網路讀取。未選取的來源不匯入。" : "Synthetic examples only: no OAuth or network reads. Unselected sources are not imported."}</p>{mockSources.map(source => <label key={source.id}><input type="checkbox" checked={selected.includes(source.id)} onChange={() => { importId.current = crypto.randomUUID(); setSelected(items => items.includes(source.id) ? items.filter(item => item !== source.id) : [...items, source.id]); }} />{source.provider}: {source.title}<small>{source.scope}</small></label>)}<button disabled={busy || !selected.length} onClick={() => void act(async () => { await importSelectedMockSources(selected, mockPermission, importId.current); setMessage(zh ? "已匯入所選 mock 來源" : "Selected mock sources imported"); })}>{zh ? "匯入所選 mock" : "Import selected mocks"}</button></details>
    <details><summary>{zh ? "API 預算 · MOCK" : "API budget · MOCK"}</summary><p>{zh ? "NT$100／月僅為規劃目標。正式雲端 AI 已暫停，等待共用帳本及可信費率。此模擬不是每装置額度或供應商帳單硬封頂。" : "NT$100/month is a planning target. Cloud AI is paused pending a shared coordinator and verified pricing. This mock is neither a per-device allowance nor a provider billing cap."}</p><p>Mock: input 2000 + output max 1000, retries 1, USD/M 1/2, USD/TWD 35, buffer 1.3.</p><button disabled={busy} onClick={() => void act(async () => { const amount = await reserveMockCost(budgetId.current, { inputTokens: 2000, maxOutputTokens: 1000, retries: 1, inputUsdPerMillion: 1, outputUsdPerMillion: 2, usdToTwd: 35, buffer: 1.3 }); setMessage(`MOCK reserved NT$${amount.toFixed(4)}; same operation is deduplicated.`); })}>{zh ? "模擬原子預留" : "Simulate atomic reservation"}</button></details>
    {message && <p role="status">{message}</p>}
  </details>;
}
