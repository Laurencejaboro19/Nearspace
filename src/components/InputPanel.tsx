import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Check, FlaskConical, Sparkles, Upload } from "lucide-react";
import Structure from "./Structure";
import { analyseSites, fromMolfile, fromSmiles, toSmiles } from "../chem/mol";
import type { Mode } from "../chem/generate";

export const EXAMPLES: { name: string; smiles: string }[] = [
  { name: "Celecoxib", smiles: "CC1=CC=C(C=C1)C1=CC(=NN1C1=CC=C(C=C1)S(N)(=O)=O)C(F)(F)F" },
  { name: "Imatinib", smiles: "CC1=C(C=C(C=C1)NC(=O)C1=CC=C(CN2CCN(C)CC2)C=C1)NC1=NC=CC(=N1)C1=CN=CC=C1" },
  { name: "Aspirin", smiles: "CC(=O)Oc1ccccc1C(=O)O" },
  { name: "Sildenafil", smiles: "CCCC1=NN(C)C2=C1N=C(NC2=O)C1=CC(=CC=C1OCC)S(=O)(=O)N1CCN(C)CC1" },
  { name: "Ciprofloxacin", smiles: "OC(=O)C1=CN(C2CC2)C2=CC(=C(F)C=C2C1=O)N1CCNCC1" },
];

const MODES: { id: Mode; title: string; blurb: string }[] = [
  { id: "conservative", title: "Conservative", blurb: "One R-group swap per analog. Scaffold untouched." },
  { id: "explore", title: "Explore", blurb: "Up to two changes, plus a nitrogen scan of the rings." },
  { id: "grow", title: "Grow", blurb: "Add whole new side chains at open ring positions." },
];

const COUNT_CHIPS = [10, 50, 100, 250, 1000];

interface Props {
  smiles: string;
  onSmiles: (s: string) => void;
  parentName: string;
  onParentName: (s: string) => void;
  mode: Mode;
  onMode: (m: Mode) => void;
  count: number;
  onCount: (n: number) => void;
  lockedSites: string[];
  onToggleLock: (label: string) => void;
  onGenerate: () => void;
  busy: boolean;
}

export default function InputPanel(props: Props) {
  const { smiles, onSmiles, mode, onMode, count, onCount, busy } = props;
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const parsed = useMemo(() => {
    const value = smiles.trim();
    if (!value) return { ok: false as const, empty: true as const };
    try {
      const mol = fromSmiles(value);
      if (mol.getAllAtoms() < 2) return { ok: false as const, empty: false as const, message: "Too small to work with." };
      const sites = analyseSites(mol);
      return {
        ok: true as const,
        empty: false as const,
        canonical: toSmiles(mol),
        atoms: mol.getAllAtoms(),
        sites,
      };
    } catch {
      return { ok: false as const, empty: false as const, message: "Not a SMILES string I can parse." };
    }
  }, [smiles]);

  async function readFile(file: File) {
    setFileError(null);
    try {
      const text = await file.text();
      if (/\.(sdf|mol)$/i.test(file.name) || text.includes("V2000") || text.includes("V3000")) {
        const record = text.split("$$$$")[0];
        onSmiles(toSmiles(fromMolfile(record)));
      } else {
        const first = text
          .split("\n")
          .map((l) => l.trim())
          .find((l) => l && !l.startsWith("#"));
        if (!first) throw new Error("empty");
        onSmiles(first.split(/[\s\t]+/)[0]);
      }
    } catch {
      setFileError(`Could not read a structure out of ${file.name}.`);
    }
  }

  return (
    <div className="space-y-5">
      {/* ---------------------------------------------------------- structure in */}
      <div>
        <label className="label" htmlFor="smiles">
          Query structure
        </label>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files?.[0];
            if (file) void readFile(file);
          }}
          className={`rounded-xl border-2 border-dashed p-1 transition ${dragging ? "border-accent bg-accent/5" : "border-transparent"}`}
        >
          <textarea
            id="smiles"
            value={smiles}
            onChange={(e) => onSmiles(e.target.value)}
            spellCheck={false}
            rows={3}
            placeholder="Paste a SMILES string, or drop a .sdf / .mol / .smi file here"
            className="field resize-y font-mono text-[13px] leading-relaxed"
          />
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button onClick={() => fileRef.current?.click()} className="btn-ghost px-3 py-1.5 text-xs">
            <Upload className="h-3.5 w-3.5" /> Upload file
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".sdf,.mol,.smi,.txt"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void readFile(file);
              e.target.value = "";
            }}
          />
          {EXAMPLES.map((ex) => (
            <button
              key={ex.name}
              onClick={() => {
                onSmiles(ex.smiles);
                props.onParentName(ex.name.toLowerCase());
              }}
              className="chip transition hover:bg-accent/15 hover:text-accent"
            >
              <FlaskConical className="h-3 w-3" /> {ex.name}
            </button>
          ))}
        </div>

        {fileError && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-fail">
            <AlertCircle className="h-3.5 w-3.5" /> {fileError}
          </p>
        )}
        {!parsed.ok && !parsed.empty && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-fail">
            <AlertCircle className="h-3.5 w-3.5" /> {parsed.message}
          </p>
        )}
      </div>

      {/* ------------------------------------------------------------- scaffold */}
      {parsed.ok && (
        <div className="panel animate-fade-up p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider dim">Detected scaffold</p>
            <span className="chip">
              <Check className="h-3 w-3 text-pass" /> {parsed.atoms} atoms
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-white/[0.03] p-2">
              <Structure smiles={parsed.canonical} width={260} height={180} />
              <p className="mt-1 text-center text-[10px] dim">Query</p>
            </div>
            <div className="rounded-xl bg-white/[0.03] p-2">
              {parsed.sites.scaffoldSmiles ? (
                <Structure smiles={parsed.sites.scaffoldSmiles} width={260} height={180} />
              ) : (
                <div className="grid h-full place-items-center px-3 text-center text-[11px] dim">
                  No ring system — Nearspace will vary the substituents it can find.
                </div>
              )}
              <p className="mt-1 text-center text-[10px] dim">Bemis–Murcko core</p>
            </div>
          </div>

          <div className="mt-3">
            <p className="mb-1.5 text-[11px] dim">
              {parsed.sites.rsites.length} substituent site{parsed.sites.rsites.length === 1 ? "" : "s"} ·{" "}
              {parsed.sites.aromaticCH.length} open aromatic C–H · tap a site to lock it
            </p>
            <div className="flex flex-wrap gap-1.5">
              {parsed.sites.rsites.map((r) => {
                const locked = props.lockedSites.includes(r.label);
                return (
                  <button
                    key={r.label}
                    onClick={() => props.onToggleLock(r.label)}
                    title={locked ? "Locked — will not be changed" : "Click to lock this position"}
                    className={`chip font-mono transition ${
                      locked ? "bg-fail/20 text-fail line-through" : "hover:bg-accent/15 hover:text-accent"
                    }`}
                  >
                    {r.label}: {r.smiles}
                  </button>
                );
              })}
              {parsed.sites.rsites.length === 0 && <span className="chip">No acyclic substituents found</span>}
            </div>
          </div>
        </div>
      )}

      {/* ----------------------------------------------------------------- mode */}
      <div>
        <p className="label">Generation mode</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => onMode(m.id)}
              className={`rounded-xl border p-3 text-left transition ${
                mode === m.id ? "border-accent bg-accent/10" : "hover:bg-white/5"
              }`}
              style={{ borderColor: mode === m.id ? undefined : "var(--line)" }}
            >
              <p className="text-sm font-semibold">{m.title}</p>
              <p className="mt-0.5 text-[11px] leading-snug dim">{m.blurb}</p>
            </button>
          ))}
        </div>
      </div>

      {/* ---------------------------------------------------------------- count */}
      <div>
        <div className="mb-1.5 flex items-end justify-between">
          <span className="label mb-0">How many analogs</span>
          <span className="font-mono text-2xl font-semibold text-accent tabular-nums">{count}</span>
        </div>
        <input
          type="range"
          min={1}
          max={1000}
          value={count}
          onChange={(e) => onCount(Number(e.target.value))}
          className="range"
          style={{ ["--pct" as string]: `${((count - 1) / 999) * 100}%` }}
          aria-label="Number of analogs to generate"
        />
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {COUNT_CHIPS.map((n) => (
            <button
              key={n}
              onClick={() => onCount(n)}
              className={`chip transition ${count === n ? "bg-accent/20 text-accent" : "hover:bg-white/10"}`}
            >
              {n}
            </button>
          ))}
          <input
            type="number"
            min={1}
            max={1000}
            value={count}
            onChange={(e) => onCount(Math.min(1000, Math.max(1, Number(e.target.value) || 1)))}
            className="field ml-auto w-24 px-2 py-1 text-right font-mono text-xs"
            aria-label="Exact number of analogs"
          />
        </div>
      </div>

      <div>
        <label className="label" htmlFor="parent-name">
          Parent name <span className="font-normal normal-case dim">(used in analog names)</span>
        </label>
        <input
          id="parent-name"
          value={props.parentName}
          onChange={(e) => props.onParentName(e.target.value)}
          placeholder="e.g. celecoxib"
          className="field"
        />
      </div>

      <button onClick={props.onGenerate} disabled={!parsed.ok || busy} className="btn-primary w-full py-3 text-base">
        <Sparkles className="h-4 w-4" />
        {busy ? "Generating…" : `Generate ${count} analog${count === 1 ? "" : "s"}`}
      </button>
    </div>
  );
}
