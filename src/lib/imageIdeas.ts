import { createCard, db } from "../db";
import type { CardRecord } from "../types";
import { persistAttachment, portableAttachmentBlob, removeStoredAttachment } from "./attachments";
import { requirePublicRecord } from "./privateOutbound";
import { blobToDataUrl, dataUrlToBlob } from "./utils";

export const imageIdeaKey = "jenzo.imageIdea.v1";
export const imageHistoryKey = "jenzo.imageIdea.history.v1";
export interface ImageIdea {
  version: 1; attachmentId: string; sha256: string; capturedAt: number;
  sourceUrl: string; sourceDate: string; annotation: string;
  rawText: string; correctedText: string; reviewed: boolean; engine: string; language: string;
}
export async function imageDigest(blob: Blob) {
  const hash = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
export function readImageIdea(card: CardRecord): ImageIdea | null {
  if (!(imageIdeaKey in card.properties)) return null;
  try {
    const value = JSON.parse(String(card.properties[imageIdeaKey])) as ImageIdea;
    if (value.version !== 1 || !/^[a-f0-9]{64}$/.test(value.sha256) || !Number.isSafeInteger(value.capturedAt) || typeof value.reviewed !== "boolean" || [value.attachmentId, value.sourceUrl, value.sourceDate, value.annotation, value.rawText, value.correctedText, value.engine, value.language].some(item => typeof item !== "string")) throw new Error();
    return value;
  } catch { throw new Error("image-source-metadata-invalid"); }
}
export function imageIdeaText(idea: ImageIdea, includeUnreviewed = true) {
  return ["Image collection / 圖片收藏", `Captured / 收藏時間: ${new Date(idea.capturedAt).toISOString()}`,
    `Original image SHA256: ${idea.sha256}`, `Source URL / 來源: ${idea.sourceUrl || "unspecified / 未提供"}`,
    `Source date (user supplied) / 來源日期（使用者提供）: ${idea.sourceDate || "unknown / 未知"}`,
    `User annotation (not independently verified) / 收藏原因（使用者註記，非獨立驗證）:\n${idea.annotation}`,
    idea.reviewed ? `Transcription checked by user against image (not verification of the claim) / 已對照原圖校正文字，非事實認證:\n${idea.correctedText}`
      : includeUnreviewed ? `Unreviewed OCR / 未校正辨識文字，不可作為已驗證引文:\n${idea.correctedText}` : "Unreviewed OCR excluded from evidence / 未校正文字不納入證據",
    "Image appearance/meaning has not been inferred / 尚未進行圖片視覺含義推論"].join("\n\n");
}
const html = (text: string) => `<p>${text.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!).replace(/\n/g, "<br>")}</p>`;
function validateDetails(idea: ImageIdea) {
  if (idea.sourceUrl) { const url = new URL(idea.sourceUrl); if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("image-source-url-invalid"); }
  if (idea.sourceDate && (!/^\d{4}-\d{2}-\d{2}$/.test(idea.sourceDate) || !Number.isFinite(Date.parse(idea.sourceDate)) || new Date(idea.sourceDate).toISOString().slice(0, 10) !== idea.sourceDate)) throw new Error("image-source-date-invalid");
  if (idea.reviewed && !idea.correctedText.trim()) throw new Error("image-reviewed-text-empty");
  if (idea.annotation.length > 8000 || idea.rawText.length > 100000 || idea.correctedText.length > 100000) throw new Error("image-text-too-large");
}
/** OCR receives only this explicitly selected image; no provider or network fallback. */
export async function recognizeImage(blob: Blob, language: string, signal?: AbortSignal) {
  if (signal?.aborted) throw new Error("image-canceled");
  if (!window.chengjing?.attachments?.recognizeImage) throw new Error("ocr-unavailable-use-manual-transcription");
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(blob.type) || blob.size > 10 * 1024 * 1024) throw new Error("image-format-or-size-invalid");
  const data = await blobToDataUrl(blob);
  if (signal?.aborted) throw new Error("image-canceled");
  const result = await window.chengjing.attachments.recognizeImage({ data: data.slice(data.indexOf(",") + 1), mime: blob.type, language });
  if (signal?.aborted) throw new Error("image-canceled");
  if (result.engine !== "windows-local-ocr" || typeof result.text !== "string" || result.text.length > 100000 || result.language !== language) throw new Error("ocr-invalid-result");
  return result;
}
/** Android WebView has no HTML file chooser. Reuse its existing document picker.
 * That picker creates an unreferenced local copy; queue only that owned UUID
 * copy for existing deferred cleanup, never delete the user's source file. */
export async function chooseAndroidImage(signal?: AbortSignal): Promise<File | null> {
  if (window.chengjing?.platform !== "android" || !window.chengjing.files?.open || signal?.aborted) throw new Error("image-picker-unavailable-or-canceled");
  const result = await window.chengjing.files.open({ multiple: false, metadataOnly: false, filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }] });
  try {
    if (result.canceled || signal?.aborted || !result.files[0]) return null;
    const picked = result.files[0];
    const mime = /\.png$/i.test(picked.name) ? "image/png" : /\.jpe?g$/i.test(picked.name) ? "image/jpeg" : /\.webp$/i.test(picked.name) ? "image/webp" : "";
    if (!mime || !picked.data || picked.data.length > 14 * 1024 * 1024) throw new Error("image-format-or-size-invalid");
    const blob = dataUrlToBlob(`data:${mime};base64,${picked.data}`);
    if (blob.size > 10 * 1024 * 1024) throw new Error("image-format-or-size-invalid");
    return new File([blob], picked.name, { type: mime });
  } finally {
    for (const file of result.files) if (/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(file.path)) await window.chengjing?.attachments?.remove?.(file.path).catch(() => {});
  }
}
let captureQueue: Promise<unknown> = Promise.resolve();
export function collectImage(name: string, blob: Blob, details: Omit<ImageIdea, "version" | "attachmentId" | "sha256" | "capturedAt">, signal?: AbortSignal): Promise<{ card: CardRecord; duplicate: boolean }> {
  const operation = captureQueue.catch(() => {}).then(async () => {
    if (signal?.aborted) throw new Error("image-canceled");
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(blob.type) || !blob.size || blob.size > 10 * 1024 * 1024) throw new Error("image-format-or-size-invalid");
    const sha256 = await imageDigest(blob);
    const existing = await db.cards.where("kind").equals("image").filter(card => card.state !== "trash" && card.properties[imageIdeaKey] != null).toArray();
    for (const card of existing) {
      const idea = readImageIdea(card);
      if (idea?.sha256 === sha256) { requirePublicRecord("share", card); if (signal?.aborted) throw new Error("image-canceled"); await verifiedImageEvidence(card); return { card, duplicate: true }; }
    }
    const idea: ImageIdea = { ...details, version: 1, attachmentId: "", sha256, capturedAt: Date.now() };
    validateDetails(idea);
    if (signal?.aborted) throw new Error("image-canceled");
    const attachment = await persistAttachment(name, blob, blob.type);
    try {
      if (signal?.aborted) throw new Error("image-canceled");
      idea.attachmentId = attachment.id;
      const plainText = imageIdeaText(idea);
      const card = await db.transaction("rw", db.cards, async () => {
        if (signal?.aborted) throw new Error("image-canceled");
        const saved = await createCard({ title: name, kind: "image", color: "amber", plainText, contentHtml: html(plainText), sourceUrl: idea.sourceUrl || undefined, attachmentIds: [attachment.id], properties: { [imageIdeaKey]: JSON.stringify(idea) } });
        if (signal?.aborted) throw new Error("image-canceled");
        return saved;
      });
      return { card, duplicate: false };
    } catch (error) { await removeStoredAttachment(attachment).catch(() => {}); throw error; }
  });
  captureQueue = operation;
  return operation;
}
export async function reviseImage(card: CardRecord, details: Pick<ImageIdea, "annotation" | "sourceUrl" | "sourceDate" | "correctedText" | "reviewed">, signal?: AbortSignal) {
  requirePublicRecord("share", card);
  const original = readImageIdea(card);
  if (!original) throw new Error("image-source-missing");
  await verifiedImageEvidence(card);
  if (signal?.aborted) throw new Error("image-canceled");
  const idea = { ...original, ...details }; validateDetails(idea);
  return db.transaction("rw", db.cards, db.attachments, async () => {
    const current = await db.cards.get(card.id);
    if (!current || current.state === "trash" || current.updatedAt !== card.updatedAt || current.plainText !== card.plainText || current.properties[imageIdeaKey] !== card.properties[imageIdeaKey]) throw new Error("image-source-changed");
    requirePublicRecord("share", current);
    if (!await db.attachments.get(idea.attachmentId)) throw new Error("image-original-missing");
    const plainText = imageIdeaText(idea);
    const historyKey = imageHistoryKey;
    const history = JSON.parse(String(current.properties[historyKey] || "[]")) as unknown[];
    if (!Array.isArray(history) || history.length >= 100) throw new Error("image-history-limit-export-before-continuing");
    history.push({ updatedAt: current.updatedAt, idea: original });
    if (signal?.aborted) throw new Error("image-canceled");
    await db.cards.update(card.id, { plainText, contentHtml: html(plainText), sourceUrl: idea.sourceUrl || undefined, updatedAt: Math.max(Date.now(), current.updatedAt + 1), properties: { ...current.properties, [imageIdeaKey]: JSON.stringify(idea), [historyKey]: JSON.stringify(history) } });
    if (signal?.aborted) throw new Error("image-canceled");
  });
}
export function imageRevisionHistory(card: CardRecord): Array<{ updatedAt: number; idea: ImageIdea }> {
  requirePublicRecord("share", card);
  const history = JSON.parse(String(card.properties[imageHistoryKey] || "[]"));
  if (!Array.isArray(history) || history.length > 100) throw new Error("image-history-invalid");
  return history.map(value => {
    const idea = readImageIdea({ ...card, properties: { [imageIdeaKey]: JSON.stringify(value?.idea) } });
    if (!idea || !Number.isSafeInteger(value?.updatedAt)) throw new Error("image-history-invalid");
    return { updatedAt: value.updatedAt, idea };
  });
}
/** Search can find uncertain OCR; evidence only cites the checked transcription.
 * Changed/detached originals and generic rich-editor edits revoke the source. */
export async function verifiedImageEvidence(card: CardRecord): Promise<string> {
  const idea = readImageIdea(card);
  if (!idea) return card.plainText;
  if (!card.attachmentIds.includes(idea.attachmentId) || card.plainText !== imageIdeaText(idea)) throw new Error("image-source-changed");
  const attachment = await db.attachments.get(idea.attachmentId);
  if (!attachment || await imageDigest(await portableAttachmentBlob(attachment)) !== idea.sha256) throw new Error("image-original-missing-or-changed");
  return imageIdeaText(idea, false);
}
