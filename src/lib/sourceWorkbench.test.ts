import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "../db";
import type { CardRecord } from "../types";
import { excerptDocument, matchingExcerpt, parseSourcedDocument, searchNoteSources, sourceAppendix, sourcesStillCurrent, type NoteSource } from "./sourceWorkbench";

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
    expect(result.text).toContain("> We plan to sail next year.\n> [1]");
    expect(sourceAppendix([source], "en")).toContain("https://example.com/source");
    expect(sourceAppendix([source], "en")).toContain("ID: card:old");
    expect(excerptDocument("Planning brief", [source], "en")).toContain("have not been inferred");
  });
  it("rejects invented keys, paraphrases presented as quotes, missing evidence and malformed output", () => {
    expect(() => parseSourcedDocument(response("card:missing"), [source])).toThrow();
    expect(() => parseSourcedDocument(response(source.key, "The sailing date is confirmed."), [source])).toThrow();
    expect(() => parseSourcedDocument('{"title":"x","sections":[{"heading":"x","text":"unsupported","evidence":[]}]}', [source])).toThrow();
    expect(() => parseSourcedDocument("not JSON", [source])).toThrow();
  });
});
