import "fake-indexeddb/auto";
import { Blob as NodeBlob } from "node:buffer";
import { webcrypto } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db";
import { collectImage } from "./imageIdeas";
import { calendarPayload, cancelPlanning, confirmPlanning, createMockGoogleConnector, listPlanningOperations, planningQuestions, proposePlanning, syncPlanning, tasksPayload, type GooglePlanningConnector, type PlanningInput } from "./googlePlanning";
import { lockSecureVault, unlockSecureVault } from "./secureSecretary";
import { mockSecretaryVault } from "./secureSecretary.fixture";

beforeAll(() => Object.defineProperty(crypto, "subtle", { configurable: true, value: webcrypto.subtle }));
beforeEach(async () => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-10T08:00:00Z")); window.chengjing = { secretaryVault: mockSecretaryVault() } as NonNullable<Window["chengjing"]>; await unlockSecureVault(); });
afterEach(async () => { await lockSecureVault(); window.chengjing = undefined; vi.useRealTimers(); await db.tasks.clear(); await db.cards.clear(); await db.attachments.clear(); });

const base = (patch: Partial<PlanningInput> = {}): PlanningInput => ({ kind: "task", title: "Synthetic task", details: "Keep original Indonesian wording: contoh", wallTime: "", timeZone: "Asia/Taipei", location: "", reminderMinutes: "20", dueDate: "2026-10-12", noDueDate: false, origin: "", transport: "", travelMinutes: "", preparationMinutes: "", trafficMinutes: "", destinations: ["google-tasks"], ...patch });

describe("local planning and follow-up questions", () => {
  it("does not guess missing flight inputs and applies the user's three-hour preference across days", () => {
    const incomplete = base({ kind: "international-flight", destinations: ["google-calendar"], dueDate: "", wallTime: "2026-10-12T02:00", location: "TPE T2", origin: "", transport: "", travelMinutes: "", preparationMinutes: "", trafficMinutes: "" });
    expect(planningQuestions(incomplete)).toEqual(expect.arrayContaining([expect.stringMatching(/depart from/), expect.stringMatching(/travel/), expect.stringMatching(/preparation/), expect.stringMatching(/traffic/)]));
    const proposal = proposePlanning({ ...incomplete, origin: "Synthetic home", transport: "taxi", travelMinutes: "60", preparationMinutes: "45", trafficMinutes: "30" });
    expect(new Date(proposal.startInstant!).toISOString()).toBe("2026-10-11T18:00:00.000Z");
    expect(new Date(proposal.airportArrivalInstant!).toISOString()).toBe("2026-10-11T15:00:00.000Z");
    expect(new Date(proposal.leaveInstant!).toISOString()).toBe("2026-10-11T12:45:00.000Z");
  });

  it("creates nothing before confirmation and deduplicates double confirmation", async () => {
    const proposal = proposePlanning(base()); expect(await db.tasks.count()).toBe(0); expect(await listPlanningOperations()).toEqual([]);
    const [left, right] = await Promise.all([confirmPlanning(proposal), confirmPlanning(proposal)]);
    expect(left.id).toBe(right.id); expect(await db.tasks.count()).toBe(1); expect(await listPlanningOperations()).toHaveLength(1);
    expect((await db.tasks.toArray())[0]).toMatchObject({ title: "Synthetic task", conversionKey: `google-planning:${proposal.id}` });
  });

  it("rejects tampered timing and expired consent", async () => {
    const meeting = proposePlanning(base({ kind: "online-meeting", destinations: ["google-calendar"], dueDate: "", wallTime: "2026-10-11T09:00", location: "https://meet.example.test/synthetic" }));
    await expect(confirmPlanning({ ...meeting, startInstant: meeting.startInstant! + 60000 })).rejects.toThrow(/timing changed/);
    vi.setSystemTime(meeting.expiresAt + 1); await expect(confirmPlanning(meeting)).rejects.toThrow(/expired/);
  });
});

describe("Google API-shaped payloads and mock-only state machine", () => {
  it("keeps photos in Notes and never emits an attachment, local path, or writable Tasks link", async () => {
    const { card } = await collectImage("synthetic.png", new NodeBlob(["synthetic image"], { type: "image/png" }) as unknown as Blob, { annotation: "合成圖片", sourceUrl: "https://example.test/source", sourceDate: "2026-10-09", rawText: "contoh", correctedText: "contoh", reviewed: true, engine: "manual", language: "id" });
    const operation = await confirmPlanning(proposePlanning(base({ imageCardId: card.id })));
    const payload = tasksPayload(operation); const serialized = JSON.stringify(payload);
    expect(payload.notes).toContain(card.id); expect(payload.notes).toContain("Photo stays in Jenzo Notes");
    expect(serialized).not.toMatch(/relativePath|file:\/\/|chengjing-attachment/i);
    expect(Object.keys(payload)).not.toContain("attachments"); expect(Object.keys(payload)).not.toContain("links");
    expect(Object.keys(payload).sort()).toEqual(["due", "notes", "title"]);
    expect(payload.due).toBe("2026-10-12T00:00:00.000Z");
  });

  it("builds an explicit Calendar timezone and 20-minute meeting reminder", async () => {
    const operation = await confirmPlanning(proposePlanning(base({ kind: "online-meeting", destinations: ["google-calendar"], dueDate: "", wallTime: "2026-10-11T09:00", location: "https://meet.example.test/synthetic" })));
    expect(calendarPayload(operation)).toMatchObject({ start: { dateTime: "2026-10-11T01:00:00.000Z", timeZone: "Asia/Taipei" }, reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 20 }] } });
  });

  it("represents unconnected and invalid-token states without claiming sync", async () => {
    const first = await confirmPlanning(proposePlanning(base()));
    expect((await syncPlanning(first.id, createMockGoogleConnector("not-connected"))).sync["google-tasks"]).toBe("not-connected");
    expect((await syncPlanning(first.id, createMockGoogleConnector("token-invalid"))).sync["google-tasks"]).toBe("token-invalid");
    expect((await listPlanningOperations())[0].remoteIds).toEqual({});
  });

  it("keeps partial success, retries only failure, and deduplicates repeated clicks", async () => {
    const operation = await confirmPlanning(proposePlanning(base({ kind: "online-meeting", destinations: ["google-calendar", "google-tasks"], dueDate: "", wallTime: "2026-10-11T09:00", location: "https://meet.example.test/synthetic" })));
    const partial = await syncPlanning(operation.id, createMockGoogleConnector("connected", "google-tasks"));
    expect(partial.status).toBe("partially-synced"); expect(partial.sync).toEqual({ "google-calendar": "created", "google-tasks": "failed" });
    const calendar = vi.fn(); const tasks = vi.fn(async () => ({ id: "MOCK-task-retry" }));
    const retry: GooglePlanningConnector = { mode: "mock", connectionState: async () => "connected", createCalendar: calendar, createTask: tasks };
    const [left, right] = await Promise.all([syncPlanning(operation.id, retry), syncPlanning(operation.id, retry)]);
    expect(left.status).toBe("synced"); expect(right.status).toBe("synced"); expect(calendar).not.toHaveBeenCalled(); expect(tasks).toHaveBeenCalledTimes(1);
  });

  it("cancels before dispatch and refuses changed/deleted image sources", async () => {
    const cancelled = await confirmPlanning(proposePlanning(base())); await cancelPlanning(cancelled.id);
    await expect(syncPlanning(cancelled.id, createMockGoogleConnector("connected"))).rejects.toThrow(/cancelled/);
    const { card } = await collectImage("source.png", new NodeBlob(["source"], { type: "image/png" }) as unknown as Blob, { annotation: "source", sourceUrl: "", sourceDate: "", rawText: "", correctedText: "", reviewed: false, engine: "manual", language: "" });
    const linked = await confirmPlanning(proposePlanning(base({ title: "Linked", imageCardId: card.id })));
    await db.cards.update(card.id, { state: "trash" });
    const result = await syncPlanning(linked.id, createMockGoogleConnector("connected"));
    expect(result.sync["google-tasks"]).toBe("source-invalid"); expect(result.remoteIds).toEqual({});
    const { card: changedCard } = await collectImage("changed.png", new NodeBlob(["changed source"], { type: "image/png" }) as unknown as Blob, { annotation: "source", sourceUrl: "", sourceDate: "", rawText: "", correctedText: "", reviewed: false, engine: "manual", language: "" });
    const changed = await confirmPlanning(proposePlanning(base({ title: "Changed", imageCardId: changedCard.id })));
    await db.cards.update(changedCard.id, { updatedAt: changedCard.updatedAt + 1 });
    expect((await syncPlanning(changed.id, createMockGoogleConnector("connected"))).sync["google-tasks"]).toBe("source-invalid");
  });
});
