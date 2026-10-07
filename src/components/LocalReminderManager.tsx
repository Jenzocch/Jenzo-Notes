import { useEffect, useState } from "react";
import { useI18n } from "../hooks/useI18n";
import { acknowledgeReminder, checkDueReminders, type ReminderOperation } from "../lib/secretary";

export function LocalReminderManager() {
  const { language } = useI18n(); const zh = language.startsWith("zh");
  const [due, setDue] = useState<ReminderOperation[]>([]); const [error, setError] = useState("");
  useEffect(() => {
    let active = true; let busy = false;
    const check = async () => { if (busy || !active) return; busy = true; try { const items = await checkDueReminders(); if (active) setDue(items); } catch (error) { if (active) setError(String(error)); } finally { busy = false; } };
    void check(); const interval = setInterval(() => void check(), 15000);
    const resume = () => void check(); window.addEventListener("focus", resume); document.addEventListener("visibilitychange", resume);
    window.addEventListener("chengjing:reminders-changed", resume);
    return () => { active = false; clearInterval(interval); window.removeEventListener("focus", resume); document.removeEventListener("visibilitychange", resume); window.removeEventListener("chengjing:reminders-changed", resume); };
  }, []);
  if (!due.length && !error) return null;
  return <aside className="local-reminder-banner" aria-label={zh ? "本機提醒" : "Local reminders"} role="status">{due.map(operation => <div key={operation.id}><b>{operation.title}</b><small>{operation.wallTime} · {operation.timeZone}</small><button onClick={() => void acknowledgeReminder(operation.id).then(() => { setDue(items => items.filter(item => item.id !== operation.id)); }).catch(error => setError(String(error)))}>{zh ? "已看到" : "Acknowledge"}</button></div>)}{error && <p>{error}</p>}</aside>;
}
