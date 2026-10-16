import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db";
import { loadMarketingMethod, marketingMethodCatalog, marketingMethodCardId, marketingMethodProvenance, normalizeMarketingMethodSource, saveMarketingMethodCard, searchMarketingMethods, validateMarketingMethodCatalog } from "./marketingMethods";

describe("ThinkWithBlack local marketing method library", () => {
  beforeEach(async () => { await db.delete(); await db.open(); });

  it("ships exactly the verified Traditional Chinese public catalog", () => {
    expect(marketingMethodCatalog.version).toBe("2026.10.15-free.1");
    expect(marketingMethodCatalog.entries).toHaveLength(365);
    expect(marketingMethodProvenance.commit).toBe("28f0c2ccf0f8581b857f8d1d854d43908acc3656");
    expect(marketingMethodProvenance.license).toBe("MIT");
    expect(validateMarketingMethodCatalog()).toEqual([]);
  });

  it("finds a method from a problem without loading every method body", () => {
    expect(searchMarketingMethods("只買過一次 回購", 5).some((entry) => entry.id === "MK-390")).toBe(true);
    expect(searchMarketingMethods("ＭＫ－０５９", 1)[0]?.id).toBe("MK-059");
  });

  it("canonicalizes Windows checkout line endings before source verification", () => {
    expect(normalizeMarketingMethodSource("# Method\r\n\r\nBody\r\n")).toBe("# Method\n\nBody\n");
  });

  it("loads one allowlisted pack offline, verifies its source hash, and never executes its instructions", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    const method = await loadMarketingMethod("MK-001");
    expect(method.content).toContain("# MK-001");
    expect(method.content).toContain("thinkwithblack-mcp");
    expect(method.sourceUrl).toContain(marketingMethodProvenance.commit);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("fails closed for missing or non-catalog content", async () => {
    await expect(loadMarketingMethod("../PRIVATE_SKILL")).rejects.toThrow("marketing-method-not-found");
    await expect(loadMarketingMethod("MK-999999")).rejects.toThrow("marketing-method-not-found");
  });

  it("saves one traceable card and deduplicates repeated clicks without overwriting it", async () => {
    const method = await loadMarketingMethod("MK-001");
    const [first, second] = await Promise.all([saveMarketingMethodCard(method), saveMarketingMethodCard(method)]);
    expect([first.created, second.created].filter(Boolean)).toHaveLength(1);
    expect(await db.cards.where("id").equals(marketingMethodCardId(method.entry)).count()).toBe(1);
    const card = await db.cards.get(marketingMethodCardId(method.entry));
    expect(card?.sourceUrl).toBe(method.sourceUrl);
    expect(card?.properties.sourceLicense).toBe("MIT");
    expect(card?.properties.sourceCommit).toBe(marketingMethodProvenance.commit);
  });
});
