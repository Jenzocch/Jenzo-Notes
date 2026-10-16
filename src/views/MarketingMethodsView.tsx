import { useDeferredValue, useMemo, useRef, useState } from "react";
import { BookMarked, ExternalLink, FilePlus2, LoaderCircle, Search, ShieldCheck } from "lucide-react";
import { useAppStore } from "../store";
import { getMarketingMethodsCopy } from "../lib/marketingMethodsCopy";
import { loadMarketingMethod, marketingMethodCatalog, marketingMethodProvenance, saveMarketingMethodCard, searchMarketingMethods, type LoadedMarketingMethod } from "../lib/marketingMethods";
import { renderSafeMarkdown } from "../lib/safeMarkdown";

const visibleLimit = 80;

export function MarketingMethodsView() {
  const language = useAppStore((state) => state.language);
  const openCard = useAppStore((state) => state.openCard);
  const copy = getMarketingMethodsCopy(language);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [selected, setSelected] = useState<LoadedMarketingMethod | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const request = useRef(0);
  const matches = useMemo(() => searchMarketingMethods(deferredQuery, marketingMethodCatalog.entryCount), [deferredQuery]);
  const visible = matches.slice(0, visibleLimit);
  const contentHtml = useMemo(() => selected ? renderSafeMarkdown(selected.content) : "", [selected]);

  async function choose(id: string) {
    const token = ++request.current;
    setLoading(true); setMessage("");
    try {
      const method = await loadMarketingMethod(id);
      if (request.current === token) setSelected(method);
    } catch {
      if (request.current === token) { setSelected(null); setMessage(copy.loadFailed); }
    } finally {
      if (request.current === token) setLoading(false);
    }
  }

  async function save() {
    if (!selected || saving) return;
    setSaving(true); setMessage("");
    try {
      const result = await saveMarketingMethodCard(selected);
      setMessage(result.created ? copy.created : copy.existing);
      openCard(result.card.id);
    } catch {
      setMessage(copy.loadFailed);
    } finally { setSaving(false); }
  }

  return <div className="marketing-methods-view">
    <header className="marketing-methods-intro">
      <span>{copy.eyebrow}</span><h2>{copy.title}</h2><p>{copy.description}</p>
      <div className="marketing-methods-provenance"><ShieldCheck size={16}/><span>{marketingMethodCatalog.version} · {marketingMethodCatalog.entryCount} methods · {marketingMethodProvenance.license} · {marketingMethodProvenance.commit.slice(0, 7)}</span></div>
    </header>
    <div className="marketing-methods-layout">
      <aside className="marketing-methods-index">
        <label><Search size={17}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.search} aria-label={copy.search}/></label>
        <p>{copy.results.replace("{count}", String(matches.length))}</p>
        {matches.length > visibleLimit && <small>{copy.limited.replace("{count}", String(visibleLimit))}</small>}
        <div className="marketing-methods-results">
          {visible.map((entry) => <button type="button" key={entry.id} className={selected?.entry.id === entry.id ? "is-active" : ""} onClick={() => void choose(entry.id)} aria-pressed={selected?.entry.id === entry.id}>
            <b>{entry.id} · {entry.name}</b><span>{entry.description}</span>
          </button>)}
        </div>
      </aside>
      <section className="marketing-method-reader">
        {loading ? <div className="marketing-method-empty" role="status"><LoaderCircle className="spin"/><p>{copy.loading}</p></div> : selected ? <>
          <header><div><span>{selected.entry.id}</span><h3>{selected.entry.name}</h3></div><button type="button" className="primary-button" disabled={saving} onClick={() => void save()}>{saving ? <LoaderCircle size={16} className="spin"/> : <FilePlus2 size={16}/>} {saving ? copy.saving : copy.save}</button></header>
          <div className="marketing-method-boundary"><ShieldCheck size={16}/><span>{copy.boundary}</span></div>
          <article className="safe-markdown marketing-method-content" dangerouslySetInnerHTML={{ __html: contentHtml }}/>
          <footer><a href={selected.sourceUrl} target="_blank" rel="noopener noreferrer">{copy.source} <ExternalLink size={14}/></a><a href={`${marketingMethodProvenance.repository}/blob/${marketingMethodProvenance.commit}/LICENSE`} target="_blank" rel="noopener noreferrer">{copy.license} <ExternalLink size={14}/></a></footer>
        </> : <div className="marketing-method-empty"><BookMarked size={34}/><p>{copy.choose}</p></div>}
        {message && <p className="marketing-method-status" role="status">{message}</p>}
      </section>
    </div>
  </div>;
}
