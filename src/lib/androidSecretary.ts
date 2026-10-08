import type { SecretaryVaultBridge } from "./secureSecretary";
import type { ReminderOperation } from "./secretary";

export interface NativeAvailability { available: boolean; reason: string; mode?: "inexact-once" }
export interface AndroidSpeechEvent { sessionId: string; kind: "result" | "error" | "end"; text?: string; error?: string }
export interface AndroidSecretaryBridge {
  notifications: { status(): Promise<NativeAvailability>; schedule(operationId: string, fingerprint: string): Promise<{ state: string; mode: "inexact-once" }> };
  speech: { status(): Promise<NativeAvailability>; start(sessionId: string, language: string): Promise<{ sessionId: string }>; stop(sessionId: string): Promise<unknown>; onEvent(callback: (event: AndroidSpeechEvent) => void): () => void };
}
type Call = (method: string, args?: Record<string, unknown>) => Promise<any>;
type Subscribe = (name: string, callback: (value: any) => void) => () => void;
export function createAndroidPrivateAdapters(call: Call, subscribe: Subscribe): { secretaryVault: SecretaryVaultBridge; secretaryAndroid: AndroidSecretaryBridge } {
  return {
    secretaryVault: {
      status: () => call("secretary.vault.status"), unlock: () => call("secretary.vault.unlock"), lock: () => call("secretary.vault.lock"),
      read: () => call("secretary.vault.read"), commit: request => call("secretary.vault.commit", request), backup: () => call("secretary.vault.backup"),
      previewRestore: data => call("secretary.vault.previewRestore", { data }), cancelRestore: token => call("secretary.vault.cancelRestore", { token }),
      confirmRestore: token => call("secretary.vault.confirmRestore", { token }), previewRollback: id => call("secretary.vault.previewRollback", { id }),
      onState: callback => subscribe("chengjing:android-vault-state", callback),
    },
    secretaryAndroid: {
      notifications: { status: () => call("secretary.notifications.status"), schedule: (operationId, fingerprint) => call("secretary.notifications.schedule", { operationId, fingerprint }) },
      speech: { status: () => call("secretary.speech.status"), start: (sessionId, language) => call("secretary.speech.start", { sessionId, language }),
        stop: sessionId => call("secretary.speech.stop", { sessionId }), onEvent: callback => subscribe("chengjing:android-secretary-speech", callback) },
    },
  };
}
export async function scheduleConfirmedAndroidReminder(bridge: AndroidSecretaryBridge, operation: ReminderOperation) {
  if (operation.repeat !== "once" || operation.status !== "scheduled" || operation.nextDueAt <= Date.now() || !operation.destinations.includes("local"))
    throw new Error("Native notification requires a future confirmed one-shot in-app reminder");
  const status = await bridge.notifications.status();
  if (!status.available) throw new Error(`${status.reason}; in-app reminder retained, no permission requested`);
  const result = await bridge.notifications.schedule(operation.id, operation.proposalFingerprint);
  if (result.state !== "scheduled") throw new Error(`Native notification ${result.state}; create a fresh proposal, in-app reminder retained`);
  return result;
}
export async function startAndroidLocalSpeech(bridge: AndroidSecretaryBridge, language: string, onText: (text: string) => void, onEnd: () => void, onError: (error: string) => void, signal?: AbortSignal) {
  if (signal?.aborted) throw new Error("Speech request cancelled");
  const sessionId = crypto.randomUUID();
  let finished = false; let unsubscribe = () => {}; let rejectAbort = (_error: Error) => {};
  const stop = () => {
    if (finished) return;
    finished = true; unsubscribe(); signal?.removeEventListener("abort", abort);
    void bridge.speech.stop(sessionId).catch(() => {});
  };
  const abort = () => { stop(); rejectAbort(new Error("Speech request cancelled")); };
  const cancelled = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  signal?.addEventListener("abort", abort, { once: true });
  unsubscribe = bridge.speech.onEvent(event => {
    if (finished || signal?.aborted || event.sessionId !== sessionId) return;
    stop();
    if (event.kind === "result" && typeof event.text === "string") onText(event.text.slice(0, 128000));
    if (event.kind === "error") onError(event.error || "On-device speech failed; use typing/paste");
    onEnd();
  });
  try {
    const status = await Promise.race([bridge.speech.status(), cancelled]);
    if (!status.available) throw new Error(`${status.reason}; use typing/paste. No cloud fallback or download.`);
    if (finished) throw new Error("Speech request cancelled");
    await Promise.race([bridge.speech.start(sessionId, language), cancelled]);
    return stop;
  } catch (error) { stop(); throw error; }
}
