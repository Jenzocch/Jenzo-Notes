import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "../db";
import { acknowledgeReminder, cancelLocalReminder, checkDueReminders, confirmReminder, importSelectedMockSources, listReminders, parseReminder, simulateDestination, wallTimeCandidates } from "./secretary";
import { conservativeMockCost, requireCloudBudgetAuthorization, reserveMockCost } from "./secretaryBudget";
import { startLocalSpeech, type LocalRecognitionConstructor } from "./localSpeech";
afterEach(async () => { await db.preferences.clear(); await db.tasks.clear(); await db.fragments.clear(); }, 30000);
const plan = (repeat: "once" | "daily" | "weekly" = "once") => parseReminder("synthetic reminder", "2026-10-08T09:00", "Asia/Taipei", repeat, ["local", "calendar-mock", "clock-mock"]);
describe("local reminder proposals", () => {
  it("uses the requested IANA zone and rejects invalid dates, gaps and ambiguous DST times", () => {
    expect(wallTimeCandidates("2026-10-08T09:00", "Asia/Taipei")).toEqual([Date.parse("2026-10-08T01:00Z")]);
    expect(wallTimeCandidates("2026-03-08T02:30", "America/New_York")).toEqual([]);
    expect(wallTimeCandidates("2026-11-01T01:30", "America/New_York")).toEqual([Date.parse("2026-11-01T05:30Z"), Date.parse("2026-11-01T06:30Z")]);
    expect(() => parseReminder("x", "2026-11-01T01:30", "America/New_York", "once", ["local"])).toThrow(/overlap/);
    expect(() => wallTimeCandidates("2026-02-30T10:00", "UTC")).toThrow();
    expect(() => wallTimeCandidates("2026-10-08T09:00", "bad-zone")).toThrow();
    expect(parseReminder("x", "2026-10-08T09:00", "Asia/Taipei", "once", ["local"], 1).instant).toBe(Date.parse("2026-10-08T01:00Z"));
  });
  it("creates nothing until confirmation, and concurrent confirmations create exactly one task/operation", async () => {
    const proposal = plan(); expect(await db.tasks.count()).toBe(0);
    await Promise.all([confirmReminder(proposal), confirmReminder(proposal)]);
    expect(await db.tasks.count()).toBe(1); expect(await listReminders()).toHaveLength(1);
    await expect(confirmReminder({ ...proposal, title: "changed payload" })).rejects.toThrow(/another proposal/);
    expect(await db.tasks.count()).toBe(1);
  });
  it("reopens the database offline, catches up overdue reminders and deduplicates acknowledgements", async () => {
    const proposal = plan(); await confirmReminder(proposal); db.close(); await db.open();
    expect(await checkDueReminders(proposal.instant - 1)).toHaveLength(0);
    expect(await checkDueReminders(proposal.instant + 1)).toHaveLength(1);
    await Promise.all([acknowledgeReminder(proposal.id, proposal.instant + 1), acknowledgeReminder(proposal.id, proposal.instant + 1)]);
    expect(await checkDueReminders(proposal.instant + 3600000)).toHaveLength(0);
    expect((await listReminders())[0].status).toBe("done");
  });
  it("keeps weekly recurrence on the original weekday after an offline gap", async () => {
    const proposal = plan("weekly"); await confirmReminder(proposal);
    await checkDueReminders(proposal.instant + 3 * 86400000);
    await acknowledgeReminder(proposal.id, proposal.instant + 3 * 86400000);
    expect((await listReminders())[0].nextDueAt).toBe(proposal.instant + 7 * 86400000);
  });
  it("keeps local wall time across DST and pauses a nonexistent recurrence for review", async () => {
    const proposal = parseReminder("x", "2026-03-07T02:30", "America/New_York", "daily", ["local"]);
    await confirmReminder(proposal); await checkDueReminders(proposal.instant); await acknowledgeReminder(proposal.id, proposal.instant);
    expect((await listReminders())[0].status).toBe("needs-review");
    const noon = parseReminder("noon", "2026-03-07T12:00", "America/New_York", "daily", ["local"]);
    await confirmReminder(noon); await checkDueReminders(noon.instant); await acknowledgeReminder(noon.id, noon.instant);
    expect((await listReminders()).find(item => item.id === noon.id)?.nextDueAt).toBe(noon.instant + 23 * 3600000);
  });
  it("cancels only in-app reminder state, retaining task and source operation", async () => {
    const proposal = plan(); await confirmReminder(proposal); await cancelLocalReminder(proposal.id);
    expect(await checkDueReminders(proposal.instant + 1)).toEqual([]); expect(await db.tasks.count()).toBe(1);
  });
  it("does not execute malformed imported reminder records", async () => {
    await db.preferences.put({ key: "secretary-operation:bad", value: { id: "bad", title: "imported" } });
    await expect(checkDueReminders()).rejects.toThrow(/original data retained/);
    expect(await db.tasks.count()).toBe(0);
  });
});
describe("consent-scoped mock connectors", () => {
  it("preserves calendar partial success across permission revocation and retries", async () => {
    const proposal = plan("daily"); await confirmReminder(proposal);
    expect(await simulateDestination(proposal.id, "calendar-mock", true)).toBe("mock-created");
    expect(await simulateDestination(proposal.id, "clock-mock", false)).toBe("mock-permission-revoked");
    expect(await simulateDestination(proposal.id, "calendar-mock", false)).toBe("mock-created");
    expect(await simulateDestination(proposal.id, "clock-mock", true)).toBe("mock-awaiting-clock-confirmation");
    const operation = (await listReminders())[0]; expect(operation.destinationsState.local).toBe("scheduled");
  });
  it("never claims an arbitrary-date clock alarm was created", async () => {
    const proposal = plan(); await confirmReminder(proposal);
    expect(await simulateDestination(proposal.id, "clock-mock", true)).toBe("blocked-arbitrary-date");
  });
  it("imports only explicitly selected synthetic sources, rejects revoked permission and deduplicates", async () => {
    const operation = crypto.randomUUID();
    await expect(importSelectedMockSources(["drive-demo-1"], false, operation)).rejects.toThrow();
    await expect(importSelectedMockSources(["unselected-private-file"], true, operation)).rejects.toThrow();
    await Promise.all([importSelectedMockSources(["drive-demo-1"], true, operation), importSelectedMockSources(["drive-demo-1"], true, operation)]);
    expect(await db.fragments.count()).toBe(1);
    expect((await db.fragments.toArray())[0].text).not.toContain("Notion");
  });
});
describe("budget fail closed and atomic mock reservations", () => {
  const quote = { inputTokens: 1000000, maxOutputTokens: 1000000, retries: 0, inputUsdPerMillion: 0.5, outputUsdPerMillion: 0.5, usdToTwd: 40, buffer: 1.3 };
  it("includes input + maximum output + retry + FX/tax buffer, blocks unknown pricing", () => {
    expect(conservativeMockCost(quote)).toBe(520000);
    expect(() => conservativeMockCost({ ...quote, usdToTwd: NaN })).toThrow();
    expect(() => conservativeMockCost({ ...quote, inputUsdPerMillion: 0 })).toThrow();
    expect(() => requireCloudBudgetAuthorization()).toThrow(/Cloud AI paused/);
  });
  it("rejects concurrent overcommit and deduplicates restart/retry reservations", async () => {
    const id = crypto.randomUUID();
    const results = await Promise.allSettled([reserveMockCost(id, quote), reserveMockCost(crypto.randomUUID(), quote)]);
    expect(results.filter(item => item.status === "fulfilled")).toHaveLength(1);
    expect(await reserveMockCost(id, quote)).toBe(52);
    await expect(reserveMockCost(id, { ...quote, retries: 1 })).rejects.toThrow(/reused/);
  });
  it("rejects malformed imported ledgers without altering the original record", async () => {
    const key = "secretary-mock-budget:2026-10";
    const value = { reservations: [{ operationId: "bad-import", quote: "unknown", reservedUnits: -1000000 }] };
    await db.preferences.put({ key, value });
    await expect(reserveMockCost(crypto.randomUUID(), quote, "2026-10")).rejects.toThrow(/Invalid mock ledger/);
    expect((await db.preferences.get(key))?.value).toEqual(value);
  });
});
describe("on-device speech only", () => {
  function recognizer(availability = "available") {
    const start = vi.fn(); const abort = vi.fn();
    class Fake { static available = vi.fn(async () => availability); processLocally = false; lang = ""; continuous = true; interimResults = true; onresult = null; onerror = null; onend = null; start = start; abort = abort; }
    return { Constructor: Fake as LocalRecognitionConstructor, start, abort };
  }
  it("never starts for unavailable local packs or cancelled capability checks", async () => {
    const mock = recognizer("downloadable"); await expect(startLocalSpeech(mock.Constructor, "en", vi.fn(), vi.fn(), vi.fn())).rejects.toThrow(/No download/); expect(mock.start).not.toHaveBeenCalled();
    const supported = recognizer(); const controller = new AbortController(); controller.abort();
    await expect(startLocalSpeech(supported.Constructor, "en", vi.fn(), vi.fn(), vi.fn(), controller.signal)).rejects.toThrow(/cancelled/); expect(supported.start).not.toHaveBeenCalled();
  });
  it("starts only when called explicitly and aborts on stop", async () => {
    const mock = recognizer(); expect(mock.start).not.toHaveBeenCalled();
    const stop = await startLocalSpeech(mock.Constructor, "en", vi.fn(), vi.fn(), vi.fn());
    expect(mock.Constructor.available).toHaveBeenCalledWith({ langs: ["en"], processLocally: true });
    expect(mock.start).toHaveBeenCalledTimes(1); stop(); expect(mock.abort).toHaveBeenCalledTimes(1);
  });
  it("revoked microphone permission aborts and removes transcript delivery", async () => {
    let instance: { onerror: ((event: { error: string }) => void) | null; onresult: unknown };
    const abort = vi.fn(); const onEnd = vi.fn(); const onError = vi.fn();
    class Fake {
      static async available() { return "available"; }
      processLocally = false; lang = ""; continuous = false; interimResults = false;
      onerror: ((event: { error: string }) => void) | null = null; onresult = null; onend = null;
      constructor() { instance = this; } start() {} abort = abort;
    }
    await startLocalSpeech(Fake as LocalRecognitionConstructor, "en", vi.fn(), onEnd, onError);
    instance!.onerror!({ error: "not-allowed" });
    expect(abort).toHaveBeenCalledTimes(1); expect(onError).toHaveBeenCalledWith("not-allowed");
    expect(instance!.onresult).toBeNull(); expect(onEnd).toHaveBeenCalledTimes(1);
  });
});
