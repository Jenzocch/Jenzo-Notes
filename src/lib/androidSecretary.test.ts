import { describe, expect, it, vi } from "vitest";
import { createAndroidPrivateAdapters, scheduleConfirmedAndroidReminder, startAndroidLocalSpeech, type AndroidSecretaryBridge, type AndroidSpeechEvent } from "./androidSecretary";
import { parseReminder } from "./secretary";

function native() {
  let listener: ((event: AndroidSpeechEvent) => void) | undefined;
  const cleanup = vi.fn(() => { listener = undefined; });
  const bridge: AndroidSecretaryBridge = {
    notifications: { status: vi.fn(async () => ({ available: true, reason: "available" })), schedule: vi.fn(async () => ({ state: "scheduled", mode: "inexact-once" as const })) },
    speech: { status: vi.fn(async () => ({ available: true, reason: "available" })), start: vi.fn(async sessionId => ({ sessionId })), stop: vi.fn(async () => ({})),
      onEvent: callback => { listener = callback; return cleanup; } },
  };
  return { bridge, emit: (event: AndroidSpeechEvent) => listener?.(event), cleanup };
}
describe("Android private adapter (mock native bridge, no device/cloud)", () => {
  it("uses fixed private endpoints with no legacy storage, paths or network", async () => {
    const call = vi.fn(async (_method: string, _args?: Record<string, unknown>) => ({})); const subscribe = vi.fn(() => vi.fn());
    const { secretaryVault: vault } = createAndroidPrivateAdapters(call, subscribe);
    await vault.unlock(); await vault.read(); await vault.commit({ expectedRevision: 3, data: { version: 2, entries: {} } });
    await vault.previewRestore("ciphertext"); await vault.confirmRestore("token"); await vault.previewRollback("uuid"); await vault.lock();
    expect(call.mock.calls.map(([method]) => method)).toEqual(["secretary.vault.unlock", "secretary.vault.read", "secretary.vault.commit", "secretary.vault.previewRestore", "secretary.vault.confirmRestore", "secretary.vault.previewRollback", "secretary.vault.lock"]);
    expect(call).toHaveBeenCalledWith("secretary.vault.commit", { expectedRevision: 3, data: { version: 2, entries: {} } });
    vault.onState?.(vi.fn()); expect(subscribe).toHaveBeenCalledWith("chengjing:android-vault-state", expect.any(Function));
  });
  it("keeps typing available when microphone/native recognition is unavailable", async () => {
    const { bridge } = native(); vi.mocked(bridge.speech.status).mockResolvedValue({ available: false, reason: "microphone-permission-required" });
    await expect(startAndroidLocalSpeech(bridge, "zh-TW", vi.fn(), vi.fn(), vi.fn())).rejects.toThrow("typing/paste");
    expect(bridge.speech.start).not.toHaveBeenCalled();
  });
  it("accepts only the active session transcript once and ignores late results", async () => {
    const { bridge, emit, cleanup } = native(); const text = vi.fn(); const end = vi.fn();
    await startAndroidLocalSpeech(bridge, "zh-TW", text, end, vi.fn());
    const id = vi.mocked(bridge.speech.start).mock.calls[0][0];
    emit({ sessionId: "other", kind: "result", text: "wrong" }); expect(text).not.toHaveBeenCalled();
    emit({ sessionId: id, kind: "result", text: "synthetic idea" }); emit({ sessionId: id, kind: "result", text: "late" });
    expect(text).toHaveBeenCalledExactlyOnceWith("synthetic idea"); expect(end).toHaveBeenCalledTimes(1); expect(cleanup).toHaveBeenCalledTimes(1);
  });
  it("aborts pending language checks without starting recognition or emitting text", async () => {
    const { bridge, emit } = native(); const controller = new AbortController(); const text = vi.fn(); let release!: () => void;
    vi.mocked(bridge.speech.status).mockImplementation(() => new Promise(resolve => { release = () => resolve({ available: true, reason: "available" }); }));
    const promise = startAndroidLocalSpeech(bridge, "en", text, vi.fn(), vi.fn(), controller.signal);
    controller.abort(); await expect(promise).rejects.toThrow("cancelled"); release();
    emit({ sessionId: "late", kind: "result", text: "late" }); expect(text).not.toHaveBeenCalled(); expect(bridge.speech.start).not.toHaveBeenCalled();
  });
  it("handles native errors without any cloud fallback", async () => {
    const { bridge, emit } = native(); const error = vi.fn(); const text = vi.fn(); const end = vi.fn();
    await startAndroidLocalSpeech(bridge, "en", text, end, error);
    emit({ sessionId: vi.mocked(bridge.speech.start).mock.calls[0][0], kind: "error", error: "installed-language-unavailable" });
    expect(error).toHaveBeenCalledWith("installed-language-unavailable"); expect(text).not.toHaveBeenCalled(); expect(end).toHaveBeenCalledTimes(1);
  });
  const operation = () => ({ ...parseReminder("synthetic reminder", "2099-01-01T12:00", "UTC", "once", ["local"]), taskId: "synthetic-task", proposalFingerprint: "synthetic-fingerprint", status: "scheduled" as const, nextDueAt: Date.parse("2099-01-01T12:00Z"), createdAt: Date.now(), destinationsState: { local: "scheduled" } });
  it("passes the confirmed operation fingerprint to native revalidation", async () => {
    const { bridge } = native(); const op = operation(); await scheduleConfirmedAndroidReminder(bridge, op);
    expect(bridge.notifications.schedule).toHaveBeenCalledExactlyOnceWith(op.id, op.proposalFingerprint);
  });
  it("revoked permission and repeating/overdue/cancelled records never schedule", async () => {
    const { bridge } = native(); const op = operation();
    for (const invalid of [{ ...op, repeat: "daily" as const }, { ...op, status: "cancelled" as const }, { ...op, nextDueAt: 0 }])
      await expect(scheduleConfirmedAndroidReminder(bridge, invalid)).rejects.toThrow("one-shot");
    vi.mocked(bridge.notifications.status).mockResolvedValue({ available: false, reason: "notifications-disabled" });
    await expect(scheduleConfirmedAndroidReminder(bridge, op)).rejects.toThrow("in-app reminder retained"); expect(bridge.notifications.schedule).not.toHaveBeenCalled();
  });
  it("does not silently retry a native handoff tombstone", async () => {
    const { bridge } = native(); vi.mocked(bridge.notifications.schedule).mockResolvedValue({ state: "restore-needs-fresh-confirmation", mode: "inexact-once" });
    await expect(scheduleConfirmedAndroidReminder(bridge, operation())).rejects.toThrow("fresh proposal"); expect(bridge.notifications.schedule).toHaveBeenCalledTimes(1);
  });
});
