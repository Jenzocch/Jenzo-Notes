import { useEffect, useRef, useState } from "react";
import { useI18n } from "../hooks/useI18n";
import { secureVaultEpoch } from "../lib/secureSecretary";
import { checkEvidence, evidenceFingerprint, localEvidenceRepository, type EvidenceRef, type EvidenceRepository, type EvidenceSource, type EvidenceState, type SourceStamp } from "../lib/investigationEvidence";

export function InvestigationTaskEvidence({ metadata }: { metadata: unknown }) {
  const [states, setStates] = useState<Record<string, EvidenceState>>({});
  const value = metadata as { version?: number; inputSources?: SourceStamp[]; evidence?: EvidenceRef[] } | undefined;
  const inputs = value?.version === 1 && Array.isArray(value.inputSources) ? value.inputSources.slice(0, 12) : [];
  useEffect(() => {
    let active = true;
    const check = () => { void Promise.all(inputs.map(async source => [source.key, await checkEvidence(source, localEvidenceRepository)] as const)).then(entries => { if (active) setStates(Object.fromEntries(entries)); }).catch(() => { if (active) setStates({ invalid: "invalid" }); }); };
    check(); const timer = window.setInterval(check, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [metadata]);
  if (!value || value.version !== 1) return null;
  return <details><summary>Task input evidence status</summary><p>Interpretation remains unverified. Source changes require review before acting.</p><ul>{inputs.map(source => <li key={source.key}>{source.key}: {states[source.key] || "checking"}</li>)}</ul>{Array.isArray(value.evidence) && <EvidenceReferences evidence={value.evidence} refreshKey={Object.values(states).join("|")} />}</details>;
}

export function EvidenceReferences({ evidence, repository = localEvidenceRepository, refreshKey = 0 }: { evidence: EvidenceRef[]; repository?: EvidenceRepository; refreshKey?: unknown }) {
  const { language } = useI18n(); const zh = language.startsWith("zh");
  const [states, setStates] = useState<Record<string, EvidenceState>>({});
  const [original, setOriginal] = useState<{ source: EvidenceSource; ref: EvidenceRef; current: boolean } | null>(null);
  const [error, setError] = useState(""); const generation = useRef(0); const highlighted = useRef<HTMLElement>(null);
  useEffect(() => {
    let active = true; const version = ++generation.current;
    setOriginal(null); setStates({});
    void Promise.all(evidence.slice(0, 12).map(async ref => [ref.key, await checkEvidence(ref, repository)] as const)).then(entries => { if (active && version === generation.current) setStates(Object.fromEntries(entries)); }).catch(() => { if (active) setError("Evidence unavailable"); });
    const lock = () => { generation.current++; setOriginal(null); setStates(Object.fromEntries(evidence.map(ref => [ref.key, "locked"]))); };
    window.addEventListener("chengjing:secure-vault-locking", lock);
    return () => { active = false; generation.current++; window.removeEventListener("chengjing:secure-vault-locking", lock); };
  }, [evidence, repository, refreshKey]);
  useEffect(() => { highlighted.current?.scrollIntoView({ block: "center" }); }, [original]);
  async function open(ref: EvidenceRef) {
    const version = generation.current; const epoch = secureVaultEpoch(); setError("");
    try {
      const source = await repository.resolve(ref.key); if (!source) throw new Error(zh ? "原始來源已刪除。" : "Original source was deleted.");
      const current = await evidenceFingerprint(source) === ref.fingerprint && source.text.slice(ref.start, ref.end) === ref.quote;
      if (version !== generation.current || epoch !== secureVaultEpoch()) return;
      setOriginal({ source, ref, current });
    } catch (error) { if (version === generation.current) setError(error instanceof Error ? error.message : "Evidence unavailable"); }
  }
  return <details className="evidence-references">
    <summary>{zh ? "證據與原始來源" : "Evidence and original sources"} ({evidence.length})</summary>
    {evidence.slice(0, 12).map((ref, index) => {
      const state = states[ref.key]; const hidden = state === "locked" || state === "invalid" || ref.privacy === "private" && !state;
      return <article key={`${ref.key}:${ref.start}:${index}`} data-evidence-state={state || "checking"}>
        <strong>{hidden ? zh ? "來源無法存取" : "Source inaccessible" : ref.title}</strong>
        <small>{state || (zh ? "校驗中" : "checking")} {state === "valid" ? zh ? "· 原文引用符合；解讀仍需判斷" : "· Quote matches; interpretation still requires judgment" : ""}</small>
        {!hidden && <><blockquote>{ref.quote}</blockquote><small>{ref.key} · {ref.privacy} · {ref.start}–{ref.end}</small><button type="button" disabled={state === "missing" || !state} onClick={() => void open(ref)}>{zh ? "查看目前原文" : "Read current original"}</button></>}
      </article>;
    })}
    {original && <section className="source-original"><b>{original.source.title}</b><p>{original.current ? zh ? "已定位到引用原文。" : "Located original quotation." : zh ? "来源已變動；下方是目前全文，舊引用不可當成有效證據。" : "Source changed; this is current full text. The old quote is not valid evidence."}</p><pre>{original.current ? <>{original.source.text.slice(0, original.ref.start)}<mark ref={highlighted}>{original.ref.quote}</mark>{original.source.text.slice(original.ref.end)}</> : original.source.text}</pre><button type="button" onClick={() => setOriginal(null)}>{zh ? "關閉原文" : "Close original"}</button></section>}
    {error && <p role="status">{error}</p>}
  </details>;
}
