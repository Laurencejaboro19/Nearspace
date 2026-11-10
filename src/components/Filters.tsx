import { RotateCcw } from "lucide-react";

export interface FilterState {
  mwMax: number;
  logPMax: number;
  tpsaMax: number;
  hbdMax: number;
  hbaMax: number;
  rotbMax: number;
  qedMin: number;
  saMax: number;
  lipinskiOnly: boolean;
  noAlerts: boolean;
}

export const DEFAULT_FILTERS: FilterState = {
  mwMax: 900,
  logPMax: 9,
  tpsaMax: 250,
  hbdMax: 10,
  hbaMax: 20,
  rotbMax: 20,
  qedMin: 0,
  saMax: 10,
  lipinskiOnly: false,
  noAlerts: false,
};

export type SortKey = "score" | "similarity" | "qed" | "sa" | "mw" | "logP";

const SLIDERS: { key: keyof FilterState; label: string; min: number; max: number; step: number; suffix?: string }[] = [
  { key: "mwMax", label: "Max MW", min: 100, max: 900, step: 10, suffix: " Da" },
  { key: "logPMax", label: "Max cLogP", min: -2, max: 9, step: 0.5 },
  { key: "tpsaMax", label: "Max TPSA", min: 20, max: 250, step: 5, suffix: " Å²" },
  { key: "hbdMax", label: "Max HBD", min: 0, max: 10, step: 1 },
  { key: "hbaMax", label: "Max HBA", min: 0, max: 20, step: 1 },
  { key: "rotbMax", label: "Max rotatable bonds", min: 0, max: 20, step: 1 },
  { key: "qedMin", label: "Min QED", min: 0, max: 1, step: 0.05 },
  { key: "saMax", label: "Max SA score (heuristic)", min: 1, max: 10, step: 0.5 },
];

export default function Filters({
  value,
  onChange,
  sort,
  onSort,
  shown,
  total,
}: {
  value: FilterState;
  onChange: (next: FilterState) => void;
  sort: SortKey;
  onSort: (s: SortKey) => void;
  shown: number;
  total: number;
}) {
  const set = <K extends keyof FilterState>(key: K, v: FilterState[K]) => onChange({ ...value, [key]: v });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs dim">
          <span className="font-mono font-semibold text-accent">{shown}</span> of {total} shown
        </p>
        <button onClick={() => onChange(DEFAULT_FILTERS)} className="chip transition hover:bg-white/10">
          <RotateCcw className="h-3 w-3" /> Reset
        </button>
      </div>

      <div>
        <label className="label" htmlFor="sort">
          Sort by
        </label>
        <select id="sort" value={sort} onChange={(e) => onSort(e.target.value as SortKey)} className="field">
          <option value="score">Nearspace score</option>
          <option value="similarity">Similarity to parent</option>
          <option value="qed">QED (drug-likeness)</option>
          <option value="sa">Easiest to make</option>
          <option value="mw">Molecular weight</option>
          <option value="logP">cLogP</option>
        </select>
      </div>

      <div className="space-y-3">
        {SLIDERS.map((s) => {
          const v = value[s.key] as number;
          const pct = ((v - s.min) / (s.max - s.min)) * 100;
          return (
            <div key={s.key}>
              <div className="mb-1 flex justify-between text-[11px]">
                <span className="dim">{s.label}</span>
                <span className="font-mono tabular-nums">
                  {s.step < 1 ? v.toFixed(s.step === 0.05 ? 2 : 1) : v}
                  {s.suffix ?? ""}
                </span>
              </div>
              <input
                type="range"
                min={s.min}
                max={s.max}
                step={s.step}
                value={v}
                onChange={(e) => set(s.key, Number(e.target.value) as FilterState[typeof s.key])}
                className="range"
                style={{ ["--pct" as string]: `${pct}%` }}
                aria-label={s.label}
              />
            </div>
          );
        })}
      </div>

      <div className="space-y-2">
        {(
          [
            ["lipinskiOnly", "Lipinski-compliant only"],
            ["noAlerts", "Hide compounds with structural alerts"],
          ] as [keyof FilterState, string][]
        ).map(([key, label]) => (
          <label key={key} className="flex cursor-pointer items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={value[key] as boolean}
              onChange={(e) => set(key, e.target.checked as FilterState[typeof key])}
              className="h-4 w-4 accent-[#22d3ee]"
            />
            {label}
          </label>
        ))}
      </div>
    </div>
  );
}

export function applyFilters<T extends {
  assessment: { descriptors: { mw: number; logP: number; tpsa: number; hbd: number; hba: number; rotatableBonds: number };
    qed: number; saScoreHeuristic: number; alerts: string[]; lipinskiPass: boolean };
}>(items: T[], f: FilterState): T[] {
  return items.filter((a) => {
    const d = a.assessment.descriptors;
    if (d.mw > f.mwMax) return false;
    if (d.logP > f.logPMax) return false;
    if (d.tpsa > f.tpsaMax) return false;
    if (d.hbd > f.hbdMax) return false;
    if (d.hba > f.hbaMax) return false;
    if (d.rotatableBonds > f.rotbMax) return false;
    if (a.assessment.qed < f.qedMin) return false;
    if (a.assessment.saScoreHeuristic > f.saMax) return false;
    if (f.lipinskiOnly && !a.assessment.lipinskiPass) return false;
    if (f.noAlerts && a.assessment.alerts.length > 0) return false;
    return true;
  });
}
