import "fake-indexeddb/auto";
import { Blob as NodeBlob } from "node:buffer";
import { webcrypto } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "../db";
import { chooseAndroidImage, collectImage, imageIdeaKey, readImageIdea, recognizeImage, reviseImage, verifiedImageEvidence } from "./imageIdeas";
import { checkEvidence, localEvidenceRepository, referenceQuote } from "./investigationEvidence";
import { compileInvestigation, confirmInvestigationTask, exportInvestigation, localEvidenceOutline, previewInvestigationTask, publishInvestigationRelation, renderInvestigation } from "./investigation";
import { lockSecureVault, readSecureVault, unlockSecureVault } from "./secureSecretary";
import { mockSecretaryVault } from "./secureSecretary.fixture";
import { searchNoteSources, sourcesStillCurrent } from "./sourceWorkbench";
vi.mock("./utils", async importOriginal => ({ ...await importOriginal<typeof import("./utils")>(), blobToDataUrl: vi.fn(async () => "data:image/png;base64,c3ludGhldGlj") }));
beforeAll(() => { Object.defineProperty(globalThis.crypto, "subtle", { configurable: true, value: webcrypto.subtle }); });
afterEach(async () => { vi.restoreAllMocks(); if (window.chengjing?.secretaryVault) await lockSecureVault(); window.chengjing = undefined; await db.cards.clear(); await db.attachments.clear(); await db.brainEdges.clear(); });
const image = (content = "synthetic-image") => new NodeBlob([content], { type: "image/png" }) as unknown as Blob;
const details = (text = "ZT-82 印尼文截圖 Jadwal rapat hari Jumat") => ({ annotation: "ZT-82 討論沙發設計，這是我的想法", sourceUrl: "https://example.invalid/synthetic", sourceDate: "", rawText: text, correctedText: text, reviewed: false, engine: "manual", language: "" });
describe("image collection to searchable, checked source", () => {
  it("keeps Indonesian names/products/numbers/units verbatim, generates zh-TW explanations and requires Chinese annotations for literal Chinese lookup", async () => {
    const original = "Sari menjadwalkan rapat hari Jumat. Produk Jenzo-82: 12 kg, 0.5%.";
    const { card } = await collectImage("id-source.png", image(), { ...details(original), annotation: "", reviewed: true });
    expect(await searchNoteSources("週五排程", "zh-TW", 24, false)).toHaveLength(0); // No cross-language semantic retrieval.
    await reviseImage(card, { annotation: "週五排程（使用者繁中註記，並非自動翻譯）", sourceUrl: "", sourceDate: "", correctedText: original, reviewed: true });
    expect((await searchNoteSources("週五排程", "zh-TW", 24, false))[0].key).toBe(`card:${card.id}`);
    const source = (await localEvidenceRepository.resolve(`card:${card.id}`))!;
    const proposal = localEvidenceOutline([source], "Jenzo-82", "zh-TW");
    expect(proposal.actions[0].title).toBe("核對原文與缺少的紀錄");
    const artifact = await compileInvestigation(proposal, [source.key], "週五排程", localEvidenceRepository);
    const document = renderInvestigation(artifact, "zh-TW");
    expect(document).toContain(original); expect(document).toContain("原文紀錄（引用不等於事實認證）"); expect(document).toContain("沒有自動翻譯");
    expect(readImageIdea((await db.cards.get(card.id))!)?.rawText).toBe(original);
    const remote = vi.spyOn(globalThis, "fetch");
    await previewInvestigationTask(artifact, artifact.actions[0].id, localEvidenceRepository, "zh-TW"); expect(remote).not.toHaveBeenCalled();
  });
  it("reuses Android picker and queues only its temporary UUID copy, never a source path", async () => {
    const remove = vi.fn(async () => ({ removed: true }));
    const open = vi.fn(async () => ({ canceled: false, files: [{ name: "synthetic.png", path: "a1234567-1234-1234-1234-123456789abc", data: "c3ludGhldGlj" }] }));
    window.chengjing = { platform: "android", files: { open }, attachments: { remove } } as unknown as NonNullable<Window["chengjing"]>;
    const file = await chooseAndroidImage(); expect(file?.type).toBe("image/png"); expect(remove).toHaveBeenCalledWith("a1234567-1234-1234-1234-123456789abc");
    open.mockResolvedValueOnce({ canceled: false, files: [{ name: "synthetic.png", path: "/user/original.png", data: "c3ludGhldGlj" }] });
    await chooseAndroidImage(); expect(remove).toHaveBeenCalledTimes(1); expect(await db.cards.count()).toBe(0);
  });
  it("cancelled Android picker writes no records or late selection", async () => {
    const controller = new AbortController();
    window.chengjing = { platform: "android", files: { open: vi.fn(async () => { controller.abort(); return { canceled: false, files: [{ name: "a.png", path: "/original.png", data: "c3ludGhldGlj" }] }; }) } } as unknown as NonNullable<Window["chengjing"]>;
    expect(await chooseAndroidImage(controller.signal)).toBeNull(); expect(await db.cards.count()).toBe(0); expect(await db.attachments.count()).toBe(0);
  });
  it("deleting and restoring an original during pending vault read revokes a task before native commit", async () => {
    const { card } = await collectImage("race.png", image(), { ...details(), reviewed: true });
    const bridge = mockSecretaryVault(); window.chengjing = { secretaryVault: bridge } as NonNullable<Window["chengjing"]>; await unlockSecureVault();
    const source = (await localEvidenceRepository.resolve(`card:${card.id}`))!;
    const artifact = await compileInvestigation(localEvidenceOutline([source], "ZT-82"), [source.key], "ZT-82", localEvidenceRepository);
    const preview = await previewInvestigationTask(artifact, artifact.actions[0].id, localEvidenceRepository);
    let release!: () => void; let entered!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; }); const entry = new Promise<void>(resolve => { entered = resolve; });
    const originalRead = bridge.read; vi.spyOn(bridge, "read").mockImplementationOnce(async () => { entered(); await wait; return originalRead(); });
    const commit = vi.spyOn(bridge, "commit"); const pending = confirmInvestigationTask(preview); const failure = expect(pending).rejects.toThrow("sources-invalidated");
    await entry; const attachment = (await db.attachments.get(readImageIdea(card)!.attachmentId))!;
    await db.attachments.delete(attachment.id); await db.attachments.put(attachment); release(); await failure;
    expect(commit).not.toHaveBeenCalled(); expect((await readSecureVault()).data.entries[`secretary-item:${preview.id}`]).toBeUndefined();
  });
  it("retains original/source/date/annotation and finds Chinese/Indonesian unreviewed text without citing it", async () => {
    const { card } = await collectImage("synthetic.png", image(), details());
    expect(await db.attachments.count()).toBe(1);
    expect(readImageIdea(card)?.sourceDate).toBe("");
    const hit = (await searchNoteSources("Jadwal", "en", 24, false))[0];
    expect(hit.key).toBe(`card:${card.id}`); expect(hit.excerpt).not.toContain("Jadwal rapat");
    expect(await sourcesStillCurrent([hit])).toBe(true);
    const source = (await localEvidenceRepository.resolve(hit.key))!;
    await expect(referenceQuote(source, "Jadwal rapat hari Jumat")).rejects.toThrow("not-original");
    expect(source.text).toContain("未校正文字不納入證據");
  });
  it("correction retains raw OCR/history, enables literal citations and revokes prior revision", async () => {
    const { card } = await collectImage("zh.png", image(), details("會議時間周五下午三點，待確認"));
    const oldSource = (await localEvidenceRepository.resolve(`card:${card.id}`))!;
    const oldRef = await referenceQuote(oldSource, "ZT-82 討論沙發設計，這是我的想法");
    await reviseImage(card, { annotation: "ZT-82 討論沙發設計，這是我的想法", sourceUrl: "", sourceDate: "2026-10-08", correctedText: "會議時間週五下午三點，待確認", reviewed: true });
    const current = (await db.cards.get(card.id))!;
    expect(readImageIdea(current)?.rawText).toContain("周五");
    expect(JSON.parse(String(current.properties["jenzo.imageIdea.history.v1"]))[0].idea.reviewed).toBe(false);
    expect(await checkEvidence(oldRef, localEvidenceRepository)).toBe("changed");
    const source = (await localEvidenceRepository.resolve(`card:${card.id}`))!;
    expect(await checkEvidence(await referenceQuote(source, "會議時間週五下午三點，待確認"), localEvidenceRepository)).toBe("valid");
  });
  it("serializes duplicate capture without overwriting annotations", async () => {
    const [a, b] = await Promise.all([collectImage("a.png", image(), details()), collectImage("b.png", image(), { ...details(), annotation: "do not overwrite" })]);
    expect(a.duplicate).toBe(false); expect(b.duplicate).toBe(true); expect(b.card.id).toBe(a.card.id);
    expect(await db.cards.count()).toBe(1); expect(await db.attachments.count()).toBe(1);
    expect(readImageIdea(b.card)?.annotation).not.toBe("do not overwrite");
  });
  it("source deletion, replacement and generic editor changes invalidate image authority", async () => {
    const { card } = await collectImage("a.png", image(), details()); const idea = readImageIdea(card)!;
    const source = (await localEvidenceRepository.resolve(`card:${card.id}`))!; const ref = await referenceQuote(source, idea.annotation);
    await db.attachments.update(idea.attachmentId, { blob: image("replacement") });
    expect(await checkEvidence(ref, localEvidenceRepository)).toBe("invalid");
    await db.attachments.delete(idea.attachmentId);
    await expect(verifiedImageEvidence(card)).rejects.toThrow("missing-or-changed");
    await db.cards.update(card.id, { plainText: "replacement rich-editor body" });
    await expect(localEvidenceRepository.resolve(`card:${card.id}`)).rejects.toThrow("source-changed");
  });
  it("private retained provenance cannot be revised or deduplicated into public collection", async () => {
    const { card } = await collectImage("a.png", image(), details());
    const privateCard = { ...card, secretaryProvenance: { version: 1, sources: [{ key: "private:synthetic", private: true }] } };
    await db.cards.put(privateCard);
    expect(await searchNoteSources("ZT-82", "en", 24, false)).toHaveLength(0);
    await expect(reviseImage(privateCard, { annotation: "leak", sourceUrl: "", sourceDate: "", correctedText: "", reviewed: false })).rejects.toThrow("private-outbound-denied");
    await expect(collectImage("b.png", image(), details())).rejects.toThrow("private-outbound-denied");
    expect(await db.cards.count()).toBe(1);
  });
  it("cancel before/during OCR drops its late result and invokes no AI/fetch", async () => {
    const controller = new AbortController(); const remote = vi.spyOn(globalThis, "fetch");
    let finish!: (value: { text: string; language: string; engine: string }) => void;
    const ocr = vi.fn(() => new Promise<{ text: string; language: string; engine: string }>(resolve => { finish = resolve; }));
    window.chengjing = { attachments: { recognizeImage: ocr } } as unknown as NonNullable<Window["chengjing"]>;
    const result = recognizeImage(image(), "zh-Hant-TW", controller.signal); await vi.waitFor(() => expect(ocr).toHaveBeenCalledOnce());
    controller.abort(); finish({ text: "not persisted", language: "zh-Hant-TW", engine: "windows-local-ocr" });
    await expect(result).rejects.toThrow("canceled"); expect(remote).not.toHaveBeenCalled(); expect(await db.cards.count()).toBe(0);
    await expect(collectImage("cancel.png", image(), details(), controller.signal)).rejects.toThrow("canceled");
  });
  it("empty/low-quality output stays unreviewed and unsupported engine never falls back to cloud", async () => {
    const remote = vi.spyOn(globalThis, "fetch");
    await expect(recognizeImage(image(), "id-ID")).rejects.toThrow("unavailable");
    const { card } = await collectImage("blur.png", image(), details(""));
    expect(readImageIdea(card)?.reviewed).toBe(false); expect(await verifiedImageEvidence(card)).not.toContain("已對照原圖校正文字"); expect(remote).not.toHaveBeenCalled();
  });
  it("checked image relationships use existing accepted/manual edge path and preserve citations", async () => {
    const a = (await collectImage("a.png", image("a"), { ...details("ZT-82 會議確認收集素材"), reviewed: true })).card;
    const b = (await collectImage("b.png", image("b"), { ...details("ZT-82 Jadwal rapat masih perlu konfirmasi"), reviewed: true })).card;
    const sources = await Promise.all([a, b].map(card => localEvidenceRepository.resolve(`card:${card.id}`)));
    const artifact = await compileInvestigation(localEvidenceOutline(sources.filter(item => item != null), "ZT-82"), sources.map(item => item!.key), "ZT-82", localEvidenceRepository);
    expect(artifact.relations.length).toBeGreaterThan(0);
    await expect(publishInvestigationRelation(artifact, artifact.relations[0].id, localEvidenceRepository)).rejects.toThrow("acceptance-required");
    artifact.relations[0].decision = "accepted";
    await publishInvestigationRelation(artifact, artifact.relations[0].id, localEvidenceRepository);
    expect((await db.brainEdges.get(artifact.relations[0].id))?.evidenceRefs).toHaveLength(2);
    const save = vi.fn(async (_options: { data: string }) => ({ canceled: false }));
    window.chengjing = { files: { save } } as unknown as NonNullable<Window["chengjing"]>;
    vi.spyOn(window, "confirm").mockReturnValue(true); // Explicit synthetic plaintext consent.
    await exportInvestigation(artifact, localEvidenceRepository, "en");
    expect(save).toHaveBeenCalledOnce(); expect(save.mock.calls[0]?.[0].data).toContain("ZT-82");
    await db.attachments.delete(readImageIdea(a)!.attachmentId);
    await expect(publishInvestigationRelation(artifact, artifact.relations[0].id, localEvidenceRepository)).rejects.toThrow();
    await expect(exportInvestigation(artifact, localEvidenceRepository, "en")).rejects.toThrow(); expect(save).toHaveBeenCalledOnce();
  });
  it("invalid metadata and active private markers fail closed while ordinary user sources properties remain compatible", async () => {
    const { card } = await collectImage("a.png", image(), details());
    await db.cards.update(card.id, { properties: { ...card.properties, sources: "ordinary source note" } });
    expect(await verifiedImageEvidence((await db.cards.get(card.id))!)).toContain("圖片收藏");
    expect(() => readImageIdea({ ...card, properties: { [imageIdeaKey]: "{broken" } })).toThrow("invalid");
  });
});
