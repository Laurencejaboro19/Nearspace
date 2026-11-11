import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Atom,
  ChevronDown,
  Download,
  FileSpreadsheet,
  FileText,
  Github,
  Loader2,
  Moon,
  Package,
  SlidersHorizontal,
  Sun,
  Terminal,
  X,
} from "lucide-react";
import InputPanel from "./components/InputPanel";
import AnalogCard from "./components/AnalogCard";
import DetailDrawer from "./components/DetailDrawer";
import Filters, { DEFAULT_FILTERS, FilterState, SortKey, applyFilters } from "./components/Filters";
import Structure from "./components/Structure";
import type { Analog, GenerateResult, Mode, Progress } from "./chem/generate";
import type { WorkerResponse } from "./workers/generate.worker";
import { download, toCSV, toSDF, toSMI, toZip } from "./chem/export";

const PAGE = 48;

export default function App() {
  const [dark, setDark] = useState(true);
  const [smiles, setSmiles] = useState("");
  const [parentName, setParentName] = useState("");
  const [mode, setMode] = useState<Mode>("explore");
  const [count, setCount] = useState(100);
  const [lockedSites, setLockedSites] = useState<string[]>([]);

  const [result, setResult] = useState<GenerateResult | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [sort, setSort] = useState<SortKey>("score");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<Analog | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportProgress, setExportProgress] = useState(0);
  const [showDocking, setShowDocking] = useState(false);

  const workerRef = useRef<Worker | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.documentElement.classList.toggle("light", !dark);
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  useEffect(() => () => workerRef.current?.terminate(), []);

  /* ------------------------------------------------------------- generation */

  const runGeneration = useCallback(() => {
    setError(null);
    setResult(null);
    setSelected(new Set());
    setVisibleCount(PAGE);
    setProgress({ phase: "analysing", done: 0, target: count });

    workerRef.current?.terminate();
    const worker = new Worker(new URL("./workers/generate.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const data = event.data;
      if (data.type === "progress") setProgress(data.progress);
      else if (data.type === "result") {
        setResult(data.result);
        setProgress(null);
        worker.terminate();
        workerRef.current = null;
        window.setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
      } else {
        setError(data.message);
        setProgress(null);
        worker.terminate();
        workerRef.current = null;
      }
    };
    worker.onerror = () => {
      setError("The generation worker crashed. Try a smaller batch or a simpler query.");
      setProgress(null);
    };

    worker.postMessage({
      type: "generate",
      options: { smiles, mode, count, parentName, lockedSites },
    });
  }, [smiles, mode, count, parentName, lockedSites]);

  /* ------------------------------------------------------- filtering & sort */

  const filtered = useMemo(() => {
    if (!result) return [];
    const list = applyFilters(result.analogs, filters);
    const sorted = [...list];
    sorted.sort((a, b) => {
      switch (sort) {
        case "similarity": return b.similarity - a.similarity;
        case "qed": return b.assessment.qed - a.assessment.qed;
        case "sa": return a.assessment.saScoreHeuristic - b.assessment.saScoreHeuristic;
        case "mw": return a.assessment.descriptors.mw - b.assessment.descriptors.mw;
        case "logP": return a.assessment.descriptors.logP - b.assessment.descriptors.logP;
        default: return b.score.total - a.score.total;
      }
    });
    return sorted;
  }, [result, filters, sort]);

  useEffect(() => setVisibleCount(PAGE), [filters, sort]);

  // Infinite scroll: a sentinel below the grid pulls in the next page.
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!sentinel.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) setVisibleCount((v) => Math.min(v + PAGE, filtered.length));
      },
      { rootMargin: "600px" },
    );
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [filtered.length]);

  const exportSet = useMemo(
    () => (selected.size ? filtered.filter((a) => selected.has(a.code)) : filtered),
    [filtered, selected],
  );

  /* ------------------------------------------------------------------ export */

  async function runExport(kind: "sdf3d" | "sdf2d" | "csv" | "smi" | "zip") {
    if (!result || exportSet.length === 0) return;
    setExporting(kind);
    setExportProgress(0);
    try {
      const stamp = result.parent.series;
      if (kind === "csv") download(`nearspace-${stamp}.csv`, toCSV(exportSet), "text/csv");
      else if (kind === "smi") download(`nearspace-${stamp}.smi`, toSMI(exportSet), "chemical/x-daylight-smiles");
      else if (kind === "zip") {
        const blob = await toZip(exportSet, { threeD: true, parentSmiles: result.parent.smiles });
        download(`nearspace-${stamp}.zip`, blob, "application/zip");
      } else {
        const threeD = kind === "sdf3d";
        const sdf = await toSDF(exportSet, { threeD, parentSmiles: result.parent.smiles }, (done, total) =>
          setExportProgress(Math.round((done / total) * 100)),
        );
        download(`nearspace-${stamp}${threeD ? "-3d" : "-2d"}.sdf`, sdf, "chemical/x-mdl-sdfile");
      }
    } catch {
      setError("Export failed. Try a smaller selection.");
    } finally {
      setExporting(null);
      setExportProgress(0);
    }
  }

  const busy = progress !== null;

  /* --------------------------------------------------------------------- UI */

  return (
    <div className="relative z-10 min-h-full">
      <header
        className="sticky top-0 z-30 border-b backdrop-blur-xl"
        style={{ borderColor: "var(--line)", background: "color-mix(in srgb, var(--surface) 82%, transparent)" }}
      >
        <div className="mx-auto flex max-w-[1500px] items-center gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent/15 text-accent">
              <Atom className="h-4.5 w-4.5" />
            </span>
            <div className="leading-tight">
              <p className="text-sm font-bold tracking-tight">NEARSPACE</p>
              <p className="hidden text-[10px] dim sm:block">Scaffold-preserving analog generator</p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <a
              href="https://github.com/Laurencejaboro19/nearspace"
              target="_blank"
              rel="noreferrer"
              className="rounded-lg p-2 transition hover:bg-white/10"
              aria-label="Source on GitHub"
            >
              <Github className="h-4 w-4" />
            </a>
            <button
              onClick={() => setDark((d) => !d)}
              className="rounded-lg p-2 transition hover:bg-white/10"
              aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
            >
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] px-4 pb-32 sm:px-6">
        {/* ------------------------------------------------------------- hero */}
        {!result && !busy && (
          <section className="grid items-center gap-8 py-10 lg:grid-cols-[1.05fr_1fr] lg:py-16">
            <div className="animate-fade-up">
              <p className="chip mb-4 bg-accent/10 text-accent">For SAR · runs entirely in your browser</p>
              <h1 className="text-balance text-4xl font-bold leading-[1.08] tracking-tight sm:text-5xl">
                Keep the scaffold.
                <br />
                <span className="bg-gradient-to-r from-accent-soft to-accent-deep bg-clip-text text-transparent">
                  Change everything else.
                </span>
              </h1>
              <p className="mt-4 max-w-xl text-[15px] leading-relaxed dim">
                Give Nearspace one structure. It finds the Bemis–Murcko core, then builds up to 1000 analogs by swapping
                functional groups and growing side chains taken from clinically approved drugs — each one named, drawn in
                2D and 3D, scored, and exported as a docking-ready SDF.
              </p>
              <div className="mt-6 flex flex-wrap gap-2 text-[11px]">
                {["Search by drug name", "No account", "No API keys", "Open source"].map((t) => (
                  <span key={t} className="chip">{t}</span>
                ))}
              </div>
            </div>
            <div className="panel animate-fade-up p-5 sm:p-6">
              <InputPanel
                smiles={smiles}
                onSmiles={setSmiles}
                parentName={parentName}
                onParentName={setParentName}
                mode={mode}
                onMode={setMode}
                count={count}
                onCount={setCount}
                lockedSites={lockedSites}
                onToggleLock={(label) =>
                  setLockedSites((l) => (l.includes(label) ? l.filter((x) => x !== label) : [...l, label]))
                }
                onGenerate={runGeneration}
                busy={busy}
              />
            </div>
          </section>
        )}

        {/* --------------------------------------------------------- progress */}
        {busy && (
          <section className="grid min-h-[60vh] place-items-center">
            <div className="panel w-full max-w-md p-8 text-center animate-fade-up">
              <Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin text-accent" />
              <p className="text-sm font-semibold">
                {progress?.phase === "analysing" && "Reading the structure and finding the scaffold…"}
                {progress?.phase === "enumerating" && "Enumerating the edit space…"}
                {progress?.phase === "building" && "Building and scoring analogs…"}
                {progress?.phase === "done" && "Finishing up…"}
              </p>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-accent-soft to-accent transition-all duration-300"
                  style={{ width: `${Math.max(4, ((progress?.done ?? 0) / Math.max(1, progress?.target ?? 1)) * 100)}%` }}
                />
              </div>
              <p className="mt-2 font-mono text-xs dim">
                {progress?.done ?? 0} / {progress?.target ?? count}
              </p>
              <p className="mt-4 text-[11px] dim">
                Everything runs locally, so a large batch takes a moment. The page stays usable.
              </p>
            </div>
          </section>
        )}

        {error && (
          <div className="panel mt-6 border-fail/40 p-4 text-sm text-fail animate-fade-up">
            {error}
            <button onClick={() => setError(null)} className="float-right rounded p-1 hover:bg-white/10">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* ---------------------------------------------------------- results */}
        {result && !busy && (
          <section ref={resultsRef} className="py-6 lg:grid lg:grid-cols-[300px_1fr] lg:gap-6">
            {/* ------------------------------------------------------ sidebar */}
            <aside className="hidden lg:block">
              <div className="sticky top-20 space-y-4">
                <div className="panel p-4">
                  <p className="label">Query</p>
                  <Structure smiles={result.parent.smiles} width={250} height={150} />
                  <p className="mt-2 truncate text-xs font-semibold">{result.parent.name}</p>
                  <p className="font-mono text-[10px] dim">series {result.parent.series}</p>
                  <button onClick={() => setResult(null)} className="btn-ghost mt-3 w-full py-2 text-xs">
                    New query
                  </button>
                </div>
                <div className="panel p-4">
                  <Filters
                    value={filters}
                    onChange={setFilters}
                    sort={sort}
                    onSort={setSort}
                    shown={filtered.length}
                    total={result.analogs.length}
                  />
                </div>
              </div>
            </aside>

            {/* -------------------------------------------------------- grid */}
            <div>
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <div>
                  <h2 className="text-xl font-bold tracking-tight">
                    {result.analogs.length} analog{result.analogs.length === 1 ? "" : "s"}
                  </h2>
                  <p className="text-xs dim">
                    from an edit space of {result.spaceSize.toLocaleString()} ·{" "}
                    {selected.size > 0 ? `${selected.size} selected` : `${filtered.length} after filters`}
                    {result.exhausted && ` · space exhausted at ${result.analogs.length} of ${result.requested}`}
                  </p>
                </div>
                <div className="ml-auto flex items-center gap-2">
                  <button onClick={() => setFiltersOpen(true)} className="btn-ghost px-3 py-2 text-xs lg:hidden">
                    <SlidersHorizontal className="h-3.5 w-3.5" /> Filters
                  </button>
                  {selected.size > 0 && (
                    <button onClick={() => setSelected(new Set())} className="chip hover:bg-white/10">
                      Clear selection
                    </button>
                  )}
                </div>
              </div>

              {result.exhausted && (
                <p className="panel mb-4 p-3 text-xs dim">
                  The edit space for this scaffold ran out before reaching {result.requested}. Try Explore or Grow mode,
                  or unlock a position, to open up more chemistry.
                </p>
              )}

              {filtered.length === 0 ? (
                <div className="panel grid place-items-center p-12 text-center">
                  <p className="text-sm font-semibold">No analog passes these filters</p>
                  <p className="mt-1 max-w-sm text-xs dim">
                    Relax a slider — nothing was deleted, the filters only hide rows.
                  </p>
                  <button onClick={() => setFilters(DEFAULT_FILTERS)} className="btn-ghost mt-4 text-xs">
                    Reset filters
                  </button>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                    {filtered.slice(0, visibleCount).map((analog) => (
                      <AnalogCard
                        key={analog.code}
                        analog={analog}
                        selected={selected.has(analog.code)}
                        onSelect={(code, next) =>
                          setSelected((s) => {
                            const copy = new Set(s);
                            if (next) copy.add(code);
                            else copy.delete(code);
                            return copy;
                          })
                        }
                        onOpen={setDetail}
                      />
                    ))}
                  </div>
                  <div ref={sentinel} className="h-10" />
                  {visibleCount < filtered.length && (
                    <button
                      onClick={() => setVisibleCount((v) => Math.min(v + PAGE, filtered.length))}
                      className="btn-ghost mx-auto mt-2 flex text-xs"
                    >
                      <ChevronDown className="h-4 w-4" /> Show more ({filtered.length - visibleCount} left)
                    </button>
                  )}
                </>
              )}

              {/* ------------------------------------------------- docking help */}
              <div className="panel mt-8 overflow-hidden">
                <button
                  onClick={() => setShowDocking((s) => !s)}
                  className="flex w-full items-center gap-2 p-4 text-left text-sm font-semibold"
                >
                  <Terminal className="h-4 w-4 text-accent" />
                  Next step: dock these with AutoDock Vina
                  <ChevronDown className={`ml-auto h-4 w-4 transition ${showDocking ? "rotate-180" : ""}`} />
                </button>
                {showDocking && (
                  <div className="space-y-3 border-t px-4 pb-4 pt-3 text-xs" style={{ borderColor: "var(--line)" }}>
                    <p className="dim">
                      Download the 3D SDF, then split and convert it with Open Babel before running Vina.
                    </p>
                    <pre className="overflow-x-auto rounded-lg bg-black/40 p-3 font-mono text-[11px] leading-relaxed">
{`# split the multi-SDF into one PDBQT per ligand
obabel nearspace-${result.parent.series}-3d.sdf -O lig.pdbqt -m --partialcharge gasteiger

# prepare the receptor once
obabel target.pdb -O target.pdbqt -xr

# dock one ligand
vina --receptor target.pdbqt --ligand lig1.pdbqt \\
     --center_x 0 --center_y 0 --center_z 0 \\
     --size_x 20 --size_y 20 --size_z 20 \\
     --exhaustiveness 8 --out lig1_out.pdbqt`}
                    </pre>
                    <p className="dim">
                      Set the box centre and size from your target's binding site. Vina generates its own conformers, so
                      the single conformer in the SDF is only a starting geometry.
                    </p>
                  </div>
                )}
              </div>

              <p className="mt-6 text-[11px] leading-relaxed dim">
                These compounds are computationally generated hypotheses. Properties are calculated descriptors and
                rule-based filters, not trained ADMET models; the synthetic accessibility number is a heuristic proxy,
                not Ertl's published score. Check synthetic feasibility and novelty before acting on anything here.
              </p>
            </div>
          </section>
        )}
      </main>

      {/* --------------------------------------------------------- export bar */}
      {result && !busy && (
        <div
          className="fixed inset-x-0 bottom-0 z-30 border-t backdrop-blur-xl"
          style={{ borderColor: "var(--line)", background: "color-mix(in srgb, var(--surface) 88%, transparent)" }}
        >
          <div className="mx-auto flex max-w-[1500px] items-center gap-2 overflow-x-auto px-4 py-3 sm:px-6">
            <span className="hidden shrink-0 text-xs dim sm:block">
              Export <span className="font-mono font-semibold text-accent">{exportSet.length}</span>
              {selected.size ? " selected" : " filtered"}
            </span>
            <div className="flex shrink-0 items-center gap-2 sm:ml-auto">
              <button onClick={() => runExport("sdf3d")} disabled={!!exporting} className="btn-primary px-3 py-2 text-xs">
                {exporting === "sdf3d" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                {exporting === "sdf3d" ? `SDF ${exportProgress}%` : "SDF (3D)"}
              </button>
              <button onClick={() => runExport("sdf2d")} disabled={!!exporting} className="btn-ghost px-3 py-2 text-xs">
                <FileText className="h-3.5 w-3.5" /> SDF (2D)
              </button>
              <button onClick={() => runExport("csv")} disabled={!!exporting} className="btn-ghost px-3 py-2 text-xs">
                <FileSpreadsheet className="h-3.5 w-3.5" /> CSV
              </button>
              <button onClick={() => runExport("smi")} disabled={!!exporting} className="btn-ghost px-3 py-2 text-xs">
                <FileText className="h-3.5 w-3.5" /> SMILES
              </button>
              <button onClick={() => runExport("zip")} disabled={!!exporting} className="btn-ghost px-3 py-2 text-xs">
                {exporting === "zip" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Package className="h-3.5 w-3.5" />} ZIP
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------- mobile filter sheet */}
      {filtersOpen && (
        <div className="fixed inset-0 z-40 flex items-end lg:hidden" role="dialog" aria-modal="true">
          <button className="absolute inset-0 bg-black/60" onClick={() => setFiltersOpen(false)} aria-label="Close filters" />
          <div
            className="relative max-h-[85vh] w-full overflow-y-auto rounded-t-2xl border-t p-5 animate-fade-up"
            style={{ background: "var(--surface-raised)", borderColor: "var(--line)" }}
          >
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm font-bold">Filters & sorting</p>
              <button onClick={() => setFiltersOpen(false)} className="rounded-lg p-2 hover:bg-white/10">
                <X className="h-4 w-4" />
              </button>
            </div>
            {result && (
              <Filters
                value={filters}
                onChange={setFilters}
                sort={sort}
                onSort={setSort}
                shown={filtered.length}
                total={result.analogs.length}
              />
            )}
            <button onClick={() => setFiltersOpen(false)} className="btn-primary mt-5 w-full">
              Show {filtered.length} analogs
            </button>
          </div>
        </div>
      )}

      <DetailDrawer
        analog={detail}
        parentSmiles={result?.parent.smiles ?? ""}
        onClose={() => setDetail(null)}
        onPubChem={(code, hit) => {
          setResult((r) =>
            r ? { ...r, analogs: r.analogs.map((a) => (a.code === code ? { ...a, pubchem: hit } : a)) } : r,
          );
          setDetail((d) => (d && d.code === code ? { ...d, pubchem: hit } : d));
        }}
      />
    </div>
  );
}
