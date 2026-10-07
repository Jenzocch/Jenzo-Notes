interface Recognition {
  processLocally: boolean; lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null; onend: (() => void) | null;
  start(): void; abort(): void;
}
export interface LocalRecognitionConstructor { new(): Recognition; available?: (options: { langs: string[]; processLocally: boolean }) => Promise<string> }
export async function startLocalSpeech(Constructor: LocalRecognitionConstructor | undefined, language: string, onText: (text: string) => void, onEnd: () => void, onError: (error: string) => void, signal?: AbortSignal) {
  if (!Constructor?.available) throw new Error("On-device speech is unavailable. Use typing/paste; cloud recognition will not be used.");
  const available = await Constructor.available({ langs: [language], processLocally: true });
  if (signal?.aborted) throw new Error("Speech request cancelled");
  if (available !== "available") throw new Error("On-device language pack unavailable. No download or cloud fallback was started.");
  const recognition = new Constructor();
  if (!("processLocally" in recognition)) throw new Error("On-device recognition cannot be guaranteed");
  recognition.processLocally = true; recognition.lang = language; recognition.continuous = false; recognition.interimResults = false;
  recognition.onresult = event => onText(Array.from(event.results).map(result => result[0]?.transcript || "").join(" "));
  recognition.onerror = event => { recognition.onresult = null; recognition.abort(); onError(event.error); onEnd(); };
  recognition.onend = onEnd;
  recognition.start(); return () => { recognition.onresult = null; recognition.onerror = null; recognition.onend = null; recognition.abort(); };
}
