import { useEffect, useRef, useState } from "react";
import type { CardRecord } from "../types";
import { chooseAndroidImage, collectImage, imageRevisionHistory, readImageIdea, recognizeImage, reviseImage } from "../lib/imageIdeas";
import { useI18n } from "../hooks/useI18n";
import { requirePublicRecord } from "../lib/privateOutbound";
import { db } from "../db";
import { portableAttachmentBlob } from "../lib/attachments";

export function ImageIdeaCapture({ card, onSaved }: { card?: CardRecord; onSaved?: (card: CardRecord) => void }) {
  const { language: appLanguage } = useI18n(); const zh = appLanguage.startsWith("zh");
  const [file, setFile] = useState<File | null>(null); const [preview, setPreview] = useState("");
  const [annotation, setAnnotation] = useState(""); const [sourceUrl, setSourceUrl] = useState(""); const [sourceDate, setSourceDate] = useState("");
  const [rawText, setRawText] = useState(""); const [text, setText] = useState(""); const [reviewed, setReviewed] = useState(false);
  const [language, setLanguage] = useState("zh-Hant-TW"); const [languages, setLanguages] = useState<string[]>([]); const [engine, setEngine] = useState("manual");
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [ready, setReady] = useState(!card);
  const [ordinaryConfirmed, setOrdinaryConfirmed] = useState(false);
  const operation = useRef<AbortController | null>(null); const active = useRef(true); const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => { active.current = true; let mounted = true;
    void window.chengjing?.attachments?.ocrStatus?.().then(status => { if (mounted) { setLanguages(status.languages); setLanguage(status.languages.includes("zh-Hant-TW") ? "zh-Hant-TW" : status.languages[0] || ""); } }).catch(() => { if (mounted) setLanguages([]); });
    return () => { mounted = false; active.current = false; operation.current?.abort(); };
  }, []);
  useEffect(() => { if (!card) return;
    try { requirePublicRecord("share", card); const idea = readImageIdea(card); setReady(Boolean(idea)); if (idea) { setAnnotation(idea.annotation); setSourceUrl(idea.sourceUrl); setSourceDate(idea.sourceDate); setRawText(idea.rawText); setText(idea.correctedText); setReviewed(idea.reviewed); setEngine(idea.engine); } }
    catch (error) { setReady(false); setAnnotation(""); setSourceUrl(""); setSourceDate(""); setRawText(""); setText(""); setReviewed(false); setMessage(String(error)); }
  }, [card?.id, card?.updatedAt]);
  useEffect(() => { if (!file) { setPreview(""); return; } const url = URL.createObjectURL(file); setPreview(url); return () => URL.revokeObjectURL(url); }, [file]);
  useEffect(() => { if (!card) return; let mounted = true; let url = "";
    try { requirePublicRecord("share", card); const idea = readImageIdea(card); if (idea) void db.attachments.get(idea.attachmentId).then(async attachment => { if (!attachment) throw new Error("image-original-missing"); const blob = await portableAttachmentBlob(attachment); if (mounted) { url = URL.createObjectURL(blob); setPreview(url); } }).catch(error => { if (mounted) { setPreview(""); setMessage(String(error)); } }); }
    catch { setPreview(""); }
    return () => { mounted = false; if (url) URL.revokeObjectURL(url); };
  }, [card?.id, card?.updatedAt]);
  function cancel() { operation.current?.abort(); setBusy(false); setMessage(zh ? "已取消；辨識結果不會寫入" : "Cancelled; recognition result will not be saved"); }
  async function chooseNative() {
    if (busy || !ordinaryConfirmed) return; const controller = new AbortController(); operation.current = controller; setBusy(true);
    try { const selected = await chooseAndroidImage(controller.signal); if (active.current && !controller.signal.aborted && selected) { setFile(selected); setRawText(""); setText(""); setReviewed(false); setEngine("manual"); setMessage(""); } }
    catch (error) { if (active.current && !controller.signal.aborted) setMessage(String(error)); }
    finally { if (active.current && operation.current === controller && !controller.signal.aborted) setBusy(false); }
  }
  async function run(ocr: boolean) {
    if (busy || !card && !ordinaryConfirmed) return; const controller = new AbortController(); operation.current = controller; setBusy(true); setMessage("");
    try {
      if (ocr && file) { const result = await recognizeImage(file, language, controller.signal); if (active.current && !controller.signal.aborted) { setRawText(result.text); setText(result.text); setEngine(result.engine); setReviewed(false); setMessage(result.text.trim() ? (zh ? "請對照原圖校正；這不是事實認證。" : "Check transcription against the image; claims are not verified.") : (zh ? "未辨識到文字，可手動輸入；圖片仍可收藏。" : "No text detected. Keep the image or transcribe manually.")); } }
      else if (card) { await reviseImage(card, { annotation, sourceUrl, sourceDate, correctedText: text, reviewed }, controller.signal); if (active.current && !controller.signal.aborted) setMessage(zh ? "已保存校正版本，舊引用須重新取得" : "Revision saved; retrieve old citations again"); }
      else if (file) { const result = await collectImage(file.name, file, { annotation, sourceUrl, sourceDate, rawText, correctedText: text, reviewed, engine, language: engine === "manual" ? "" : language }, controller.signal); if (active.current && !controller.signal.aborted) { setMessage(result.duplicate ? (zh ? "相同原圖已存在；未覆寫既有註記" : "Existing image found; original annotation kept") : (zh ? "已收藏，可用筆記搜尋與來源關聯找回" : "Saved; find through note search and cited relationships")); onSaved?.(result.card); } }
    } catch (error) { if (active.current && !controller.signal.aborted) setMessage(String(error)); }
    finally { if (operation.current === controller && !controller.signal.aborted && active.current) setBusy(false); }
  }
  let history: ReturnType<typeof imageRevisionHistory> = [];
  if (card) { try { requirePublicRecord("share", card); history = imageRevisionHistory(card); } catch { return <section className="image-idea-capture"><p role="alert">{zh ? "此來源不適用一般圖片收藏，無法顯示或校正。" : "This source cannot be shown or revised in ordinary image collection."}</p></section>; } }
  return <section className="image-idea-capture" aria-label={zh ? "圖片與想法收藏" : "Image and idea collection"}>
    <h3>{zh ? "圖片也是想法" : "Images are ideas too"}</h3>
    <p>{zh ? "保存原圖、來源與收藏原因。本機辨識不會呼叫 AI 或上傳；一般筆記沿用既有同步／備份設定。此入口不收私密圖片。" : "Keep the original, source and reason. OCR stays on this device without AI calls/uploads. Ordinary notes retain existing sync/backup settings. Do not collect private images here."}</p>
    {!card && <label className="image-review-check"><input type="checkbox" checked={ordinaryConfirmed} disabled={busy} onChange={event => setOrdinaryConfirmed(event.target.checked)} />{zh ? "這不是私密圖片；我要保存到一般筆記，沿用既有同步設定" : "This is not a private image; save to ordinary notes with existing sync settings"}</label>}
    {!card && window.chengjing?.platform === "android" && <button type="button" disabled={busy || !ordinaryConfirmed} onClick={() => void chooseNative()}>{zh ? "從手機選擇圖片" : "Choose image on phone"}</button>}
    {!card && window.chengjing?.platform !== "android" && <label>{zh ? "選擇圖片（PNG／JPG／WebP，最多 10 MB）" : "Choose image (PNG/JPG/WebP, up to 10 MB)"}<input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={event => { operation.current?.abort(); setFile(event.target.files?.[0] || null); setRawText(""); setText(""); setReviewed(false); setEngine("manual"); setMessage(""); }} /></label>}
    <p>{zh ? "閱讀與收藏註記使用繁體中文；印尼文原文保持原樣。OCR 只取出文字，不會翻譯或理解內容。中文查詢目前是字面搜尋，沒有跨語意檢索；可在收藏原因加入繁中關鍵字，協助找回原文。請保留人名、產品名、數字與單位，不用猜測改寫。" : "OCR extracts original text; it does not translate or understand Indonesian. Search is literal, not cross-language semantic retrieval. Add your own reading-language keywords to the annotation; preserve names, products, numbers and units."}</p>
    {preview && <img src={preview} alt={zh ? "選取的原圖預覽" : "Selected original image"} />}
    <label>{zh ? "為什麼收藏？／想到什麼？（你的註記）" : "Why save this? / Your idea (annotation)"}<textarea rows={3} maxLength={8000} disabled={busy || !ready} value={annotation} onChange={event => setAnnotation(event.target.value)} /></label>
    <label>{zh ? "來源網址（可留空，不會自動讀取）" : "Source URL (optional; never fetched automatically)"}<input type="url" disabled={busy || !ready} value={sourceUrl} onChange={event => setSourceUrl(event.target.value)} /></label>
    <label>{zh ? "原始來源日期（未知就留空）" : "Source date (leave unknown blank)"}<input type="date" disabled={busy || !ready} value={sourceDate} onChange={event => setSourceDate(event.target.value)} /></label>
    {!card && <><label>{zh ? "本機已安裝辨識語言" : "Installed local recognition language"}<select value={language} disabled={busy || !languages.length} onChange={event => setLanguage(event.target.value)}>{languages.length ? languages.map(item => <option key={item} value={item}>{zh ? ({ "zh-Hant-TW": "繁體中文", "zh-Hans-CN": "簡體中文", "en-US": "英文／拉丁字母（非印尼文語意理解）" } as Record<string, string>)[item] || item : item}</option>) : <option value="">{zh ? "未提供本機辨識" : "Unavailable"}</option>}</select></label><button type="button" disabled={busy || !ordinaryConfirmed || !file || !languages.includes(language)} onClick={() => void run(true)}>{zh ? "本機辨識文字" : "Recognize text locally"}</button><p>{languages.length ? (zh ? "僅列出本機已裝語言；印尼文無專用支援時請手動校正。" : "Only installed languages are listed. Indonesian without a dedicated pack requires manual correction.") : (zh ? "此裝置沒有本機 OCR；可收藏原圖、手動輸入，不會改用雲端。" : "Local OCR unavailable; keep images and transcribe manually, without cloud fallback.")}</p></>}
    <label>{zh ? "原文辨識／校正（保留印尼文，不是翻譯）" : "Image text (editable; image-only ideas are welcome)"}<textarea rows={5} maxLength={100000} disabled={busy || !ready} value={text} onChange={event => { setText(event.target.value); setReviewed(false); }} /></label>
    {rawText && <details><summary>{zh ? "原始 OCR 結果（保留）" : "Original OCR output (retained)"}</summary><pre>{rawText}</pre></details>}
    {!!history.length && <details><summary>{zh ? "先前的校正與收藏理由" : "Earlier corrections and collection reasons"} ({history.length})</summary>{history.map((revision, index) => <article key={index}><p>{new Date(revision.updatedAt).toISOString()} · {revision.idea.reviewed ? "已校正原文" : "未校正原文"}</p><p>{revision.idea.annotation}</p><p>{revision.idea.sourceUrl} · {revision.idea.sourceDate || (zh ? "未知" : "unknown")}</p><pre>{revision.idea.correctedText}</pre></article>)}</details>}
    <label className="image-review-check"><input type="checkbox" checked={reviewed} disabled={busy || !ready || !text.trim()} onChange={event => setReviewed(event.target.checked)} />{zh ? "我已對照原圖校正文字（不是認證原圖主張）" : "I checked transcription against the image (not verifying its claims)"}</label>
    <p>{zh ? "未校正文字可搜尋，但不當作引用／整理／關聯的證據。圖片含義尚未由視覺模型理解。" : "Unreviewed text is searchable but excluded from cited documents and relationships. No visual interpretation is claimed."}</p>
    <div className="source-actions"><button type="button" disabled={busy || !ready || (!card && (!file || !ordinaryConfirmed))} onClick={() => void run(false)}>{zh ? card ? "保存校正版本" : "收藏圖片與想法" : card ? "Save revision" : "Collect image and idea"}</button>{busy && <button type="button" onClick={cancel}>{zh ? "取消" : "Cancel"}</button>}{!card && file && !busy && <button type="button" onClick={() => { setFile(null); setText(""); setRawText(""); setReviewed(false); if (fileInput.current) fileInput.current.value = ""; }}>{zh ? "清除選取" : "Clear selection"}</button>}</div>
    {message && <p role="status">{message}</p>}
  </section>;
}
