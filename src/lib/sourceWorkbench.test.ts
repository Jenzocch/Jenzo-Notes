import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "../db";
import type { CardRecord } from "../types";
import { excerptDocument, matchingExcerpt, normalizedSourceUrl, parseSourcedDocument, safeDocumentExport, searchNoteSources, sourceAppendix, sourcesStillCurrent, type NoteSource } from "./sourceWorkbench";
import { marked } from "marked";
import { renderSafeMarkdown } from "./safeMarkdown";

const card = (id: string, text: string, updatedAt = 1): CardRecord => ({ id, title: id, plainText: text, contentHtml: "", kind: "note", state: "active", createdAt: updatedAt, updatedAt, tagIds: [], favorite: false, color: "slate", attachmentIds: [], properties: {} });
afterEach(async () => { await db.cards.clear(); await db.fragments.clear(); }, 30000);

describe("source workbench retrieval", () => {
  it("finds old unindexed notes, long-note tails and quick fragments without recent-candidate bias", async () => {
    await db.cards.bulkAdd(Array.from({ length: 510 }, (_, i) => card(`new-${i}`, "irrelevant new note", 1000 + i)));
    await db.cards.add(card("old", "x".repeat(20000) + "古老航海計畫：明年出發"));
    await db.cards.add({ ...card("trash", "航海計畫"), state: "trash" });
    await db.fragments.add({ id: "idea", text: "航海計畫：先準備資料", pinned: false, tagIds: [], createdAt: 2, updatedAt: 2 });
    const sources = await searchNoteSources("航海計畫", "zh-TW");
    expect(sources.map(source => source.key)).toEqual(["fragment:idea", "card:old"]);
    expect(sources[1].excerpt).toContain("古老航海計畫");
    expect(sources[1].excerpt.length).toBeLessThanOrEqual(1600);
    expect(await sourcesStillCurrent(sources)).toBe(true);
    await db.fragments.update("idea", { text: "changed", updatedAt: 3 });
    expect(await sourcesStillCurrent(sources)).toBe(false);
  });
  it("bounds results, rejects empty queries and preserves exact source text", async () => {
    await db.cards.bulkAdd(Array.from({ length: 30 }, (_, i) => card(`match-${i}`, "navigation", i + 1)));
    expect(await searchNoteSources("", "en")).toEqual([]);
    expect(await searchNoteSources("navigation", "en", 8)).toHaveLength(8);
    const text = "before ".repeat(1000) + "Navigation route\noriginal punctuation!";
    expect(text).toContain(matchingExcerpt(text, ["navigation"]));
    expect(matchingExcerpt(text, ["navigation"])).toContain("Navigation route");
    const fullWidth = "x".repeat(20000) + "Ｖｏｙａｇｅ計畫";
    expect(matchingExcerpt(fullWidth, ["voyage"])).toContain("Ｖｏｙａｇｅ計畫");
  });
  it("rejects a deleted source even if its timestamp is unchanged", async () => {
    await db.cards.add(card("source", "evidence original"));
    const sources = await searchNoteSources("evidence", "en");
    await db.cards.update("source", { state: "trash" });
    expect(await sourcesStillCurrent(sources)).toBe(false);
  });
});

describe("document evidence", () => {
  const source: NoteSource = { key: "card:old", id: "old", type: "card", title: "Route notes", excerpt: "We plan to sail next year. The date is uncertain.", updatedAt: 1, matched: ["sail"], sourceUrl: "https://example.com/source" };
  const response = (key = source.key, quote = "We plan to sail next year.") => JSON.stringify({ title: "Planning brief", sections: [{ heading: "Evidence", text: "A plan is recorded; timing needs confirmation.", evidence: [{ key, quote }] }] });
  it("accepts exact quotes with source numbers and retains source URL/id/date in exports", () => {
    const result = parseSourcedDocument(response(), [source]);
    expect(renderSafeMarkdown(result.text)).toContain("We plan to sail next year.");
    expect(result.text).toContain("> [1]");
    expect(sourceAppendix([source], "en")).toContain("https://example.com/source");
    expect(renderSafeMarkdown(sourceAppendix([source], "en"))).toContain("card:old");
    expect(excerptDocument("Planning brief", [source], "en")).toContain("have not been inferred");
  });
  it("rejects invented keys, paraphrases presented as quotes, missing evidence and malformed output", () => {
    expect(() => parseSourcedDocument(response("card:missing"), [source])).toThrow();
    expect(() => parseSourcedDocument(response(source.key, "The sailing date is confirmed."), [source])).toThrow();
    expect(() => parseSourcedDocument('{"title":"x","sections":[{"heading":"x","text":"unsupported","evidence":[]}]}', [source])).toThrow();
    expect(() => parseSourcedDocument("not JSON", [source])).toThrow();
  });
  it("renders quoted Markdown and HTML as literal source text, not links or formatting", () => {
    const literal = { ...source, excerpt: "**untrusted emphasis** [click](https://example.com) <script>attack()</script>" };
    const raw = JSON.stringify({ title: "Quote", sections: [{ heading: "Evidence", text: "Review the literal source.", evidence: [{ key: literal.key, quote: literal.excerpt }] }] });
    const html = renderSafeMarkdown(parseSourcedDocument(raw, [literal]).text);
    expect(html).not.toContain("<a "); expect(html).not.toContain("<strong>"); expect(html).not.toContain("<script>");
    expect(html).toContain("**untrusted emphasis**");
  });
  it("exports generated/edited HTML, image Markdown, reference images and fence attacks as inert text", () => {
    const malicious = { ...source, sourceUrl: 'https://example.invalid/\n\n<img src="https://tracker.invalid/private">' };
    const raw = JSON.stringify({ title: "<script>title()</script>", sections: [{ heading: '<img src="https://tracker.invalid/h">', text: '<script>run()</script> ![tracker](https://tracker.invalid)\n![ref][r]\n[r]: https://tracker.invalid', evidence: [{ key: source.key, quote: "We plan to sail next year." }] }] });
    const text = parseSourcedDocument(raw, [malicious]).text + sourceAppendix([malicious], "en") + '\n~~~\n<img src="https://tracker.invalid/edited">\n~~~~~';
    const exported = safeDocumentExport(text); const html = marked.parse(exported) as string;
    expect(html).not.toMatch(/<(img|script|iframe|a|video|audio)\b/i);
    expect(html).toContain("We plan to sail next year"); expect(exported).toContain("card:old"); expect(exported).toContain("tracker");
    expect(normalizedSourceUrl(malicious.sourceUrl)).toBeNull();
    expect(normalizedSourceUrl("https://user:password@example.com/")).toBeNull(); expect(normalizedSourceUrl("javascript:alert(1)")).toBeNull();
    expect(normalizedSourceUrl("https://EXAMPLE.com/a?b=1")).toBe("https://example.com/a?b=1");
  });
});
