import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowRight, Loader2, Search, X } from "lucide-react";
import Structure from "./Structure";
import {
  Candidate,
  LookupError,
  Resolved,
  classifyQuery,
  describeCids,
  findCids,
  resolveCid,
  structureForCid,
  suggestNames,
} from "../chem/pubchem";

interface Props {
  /** Called once a structure has actually been resolved. */
  onResolved: (smiles: string, name: string, cid: number) => void;
}

const POPULAR = ["Celecoxib", "Imatinib", "Sildenafil", "Metformin", "Ciprofloxacin", "Paracetamol"];

export default function NameSearch({ onResolved }: Props) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [resolved, setResolved] = useState<Resolved | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Type-ahead. Debounced, and silently skipped for CIDs and InChIKeys.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || classifyQuery(q).kind !== "name") {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      const hits = await suggestNames(q, controller.signal);
      setSuggestions(hits);
      setHighlighted(-1);
    }, 220);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  // Close the suggestion list on an outside click.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setShowSuggestions(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const search = useCallback(async (term: string) => {
    const q = term.trim();
    if (!q) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setBusy(true);
    setError(null);
    setCandidates(null);
    setResolved(null);
    setShowSuggestions(false);

    try {
      const cids = await findCids(q, controller.signal);

      if (cids.length === 1) {
        const hit = await resolveCid(cids[0], controller.signal);
        if (controller.signal.aborted) return;
        setResolved(hit);
        setBusy(false);
        return;
      }

      // Ambiguous: show what matched and let the user pick.
      const described = await describeCids(cids, controller.signal);
      if (controller.signal.aborted) return;
      setCandidates(described);
      setBusy(false);

      // Fill in structures in the background so the list becomes browsable.
      for (const candidate of described) {
        if (controller.signal.aborted) return;
        try {
          const smiles = await structureForCid(candidate.cid, controller.signal);
          if (controller.signal.aborted) return;
          setCandidates((list) =>
            list ? list.map((c) => (c.cid === candidate.cid ? { ...c, smiles } : c)) : list,
          );
        } catch {
          /* one unreadable record should not stop the rest */
        }
      }
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      setError(err instanceof LookupError ? err.message : "That search did not work. Try another name.");
      setBusy(false);
    }
  }, []);

  const choose = useCallback(
    async (cid: number) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setBusy(true);
      setError(null);
      try {
        const hit = await resolveCid(cid, controller.signal);
        if (controller.signal.aborted) return;
        setResolved(hit);
        setCandidates(null);
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
        setError(err instanceof LookupError ? err.message : "Could not load that compound.");
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showSuggestions || suggestions.length === 0) {
      if (e.key === "Enter") void search(query);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = highlighted >= 0 ? suggestions[highlighted] : query;
      setQuery(pick);
      void search(pick);
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  }

  return (
    <div className="space-y-4">
      <div ref={boxRef} className="relative">
        <label className="label" htmlFor="name-search">
          Search by name
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 dim" />
          <input
            id="name-search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            onKeyDown={onKeyDown}
            placeholder="e.g. celecoxib, imatinib, aspirin — or a CID or InChIKey"
            autoComplete="off"
            spellCheck={false}
            className="field pl-9 pr-24"
            role="combobox"
            aria-expanded={showSuggestions && suggestions.length > 0}
            aria-controls="name-suggestions"
            aria-autocomplete="list"
          />
          {query && (
            <button
              onClick={() => {
                setQuery("");
                setCandidates(null);
                setResolved(null);
                setError(null);
              }}
              className="absolute right-[4.75rem] top-1/2 -translate-y-1/2 rounded p-1 transition hover:bg-white/10"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5 dim" />
            </button>
          )}
          <button
            onClick={() => void search(query)}
            disabled={busy || !query.trim()}
            className="btn-primary absolute right-1.5 top-1/2 -translate-y-1/2 px-3 py-1.5 text-xs"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Find"}
          </button>
        </div>

        {showSuggestions && suggestions.length > 0 && (
          <ul
            id="name-suggestions"
            role="listbox"
            className="panel absolute z-20 mt-1 max-h-64 w-full overflow-y-auto p-1 shadow-2xl"
            style={{ background: "var(--surface-raised)" }}
          >
            {suggestions.map((s, i) => (
              <li key={s} role="option" aria-selected={i === highlighted}>
                <button
                  onMouseEnter={() => setHighlighted(i)}
                  onClick={() => {
                    setQuery(s);
                    void search(s);
                  }}
                  className={`block w-full truncate rounded-lg px-3 py-2 text-left text-sm transition ${
                    i === highlighted ? "bg-accent/15 text-accent" : "hover:bg-white/5"
                  }`}
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!resolved && !candidates && !busy && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] dim">Try:</span>
          {POPULAR.map((name) => (
            <button
              key={name}
              onClick={() => {
                setQuery(name);
                void search(name);
              }}
              className="chip transition hover:bg-accent/15 hover:text-accent"
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {error && (
        <p className="flex items-start gap-1.5 text-xs text-fail">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
        </p>
      )}

      {busy && !candidates && (
        <div className="panel grid place-items-center p-8 text-xs dim">
          <Loader2 className="mb-2 h-5 w-5 animate-spin text-accent" />
          Looking it up in PubChem…
        </div>
      )}

      {/* ------------------------------------------------------ disambiguation */}
      {candidates && candidates.length > 0 && (
        <div className="animate-fade-up">
          <p className="mb-2 text-xs dim">
            {candidates.length} entries match that name — pick the one you mean.
          </p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {candidates.map((c) => (
              <li key={c.cid}>
                <button
                  onClick={() => void choose(c.cid)}
                  className="panel flex w-full items-center gap-3 p-2 text-left transition hover:border-accent hover:bg-accent/5"
                >
                  <div className="h-16 w-20 shrink-0 rounded-lg bg-white/[0.03]">
                    {c.smiles ? (
                      <Structure smiles={c.smiles} width={160} height={120} />
                    ) : (
                      <div className="h-full w-full animate-pulse rounded-lg bg-white/5" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold">{c.title ?? `CID ${c.cid}`}</p>
                    <p className="font-mono text-[10px] dim">
                      CID {c.cid}
                      {c.formula ? ` · ${c.formula}` : ""}
                    </p>
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 dim" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ------------------------------------------------------------ resolved */}
      {resolved && (
        <div className="panel animate-fade-up p-4">
          <div className="flex gap-4">
            <div className="h-28 w-32 shrink-0 rounded-xl bg-white/[0.03] p-1">
              <Structure smiles={resolved.smiles} width={220} height={170} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold">{resolved.title}</p>
              <p className="mt-0.5 font-mono text-[10px] dim">
                PubChem CID {resolved.cid}
                {resolved.formula ? ` · ${resolved.formula}` : ""}
              </p>
              {resolved.iupacName && (
                <p className="mt-1.5 line-clamp-2 text-[11px] leading-snug dim" title={resolved.iupacName}>
                  {resolved.iupacName}
                </p>
              )}
              {resolved.synonyms.length > 1 && (
                <p className="mt-1.5 line-clamp-1 text-[10px] dim">
                  Also: {resolved.synonyms.slice(1, 5).join(", ")}
                </p>
              )}
            </div>
          </div>

          <code className="mt-3 block break-all rounded-lg bg-white/[0.04] px-3 py-2 font-mono text-[10px] dim">
            {resolved.smiles}
          </code>

          <button
            onClick={() => onResolved(resolved.smiles, resolved.title.toLowerCase(), resolved.cid)}
            className="btn-primary mt-3 w-full"
          >
            Use this structure <ArrowRight className="h-4 w-4" />
          </button>
          <p className="mt-2 text-center text-[10px] dim">
            Structure from PubChem, parsed locally. Check it matches what you meant before generating.
          </p>
        </div>
      )}
    </div>
  );
}
