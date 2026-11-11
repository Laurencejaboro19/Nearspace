import { memo, useState } from "react";
import { AlertTriangle, Box, Check, Copy } from "lucide-react";
import Structure from "./Structure";
import type { Analog } from "../chem/generate";

interface Props {
  analog: Analog;
  selected: boolean;
  onSelect: (code: string, next: boolean) => void;
  onOpen: (analog: Analog) => void;
  onOpen3D: (analog: Analog) => void;
}

function ScoreRing({ value }: { value: number }) {
  const r = 13;
  const circumference = 2 * Math.PI * r;
  const dash = circumference * value;
  const colour = value > 0.66 ? "#a3e635" : value > 0.4 ? "#22d3ee" : "#fbbf24";
  return (
    <svg viewBox="0 0 32 32" className="h-9 w-9 -rotate-90" aria-hidden>
      <circle cx="16" cy="16" r={r} fill="none" stroke="currentColor" strokeWidth="3" className="opacity-15" />
      <circle
        cx="16"
        cy="16"
        r={r}
        fill="none"
        stroke={colour}
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${circumference}`}
      />
    </svg>
  );
}

function AnalogCard({ analog, selected, onSelect, onOpen, onOpen3D }: Props) {
  const [copied, setCopied] = useState(false);
  const d = analog.assessment.descriptors;

  return (
    <article
      className={`panel group relative flex flex-col overflow-hidden transition hover:-translate-y-0.5 ${
        selected ? "ring-2 ring-accent" : ""
      }`}
    >
      <label className="absolute left-3 top-3 z-10 flex cursor-pointer items-center" title="Select for export">
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onSelect(analog.code, e.target.checked)}
          className="h-4 w-4 cursor-pointer accent-[#22d3ee]"
          aria-label={`Select ${analog.code}`}
        />
      </label>

      {analog.assessment.alerts.length > 0 && (
        <span
          className="absolute right-3 top-3 z-10 text-warn"
          title={`Structural alerts: ${analog.assessment.alerts.join(", ")}`}
        >
          <AlertTriangle className="h-4 w-4" />
        </span>
      )}

      <div className="relative bg-white/[0.02]">
        <button onClick={() => onOpen(analog)} className="block w-full px-3 pb-1 pt-7 text-left">
          <Structure smiles={analog.smiles} width={300} height={190} highlight={analog.changedAtoms} lazy />
        </button>
        <button
          onClick={() => onOpen3D(analog)}
          className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold backdrop-blur transition hover:border-accent hover:bg-accent hover:text-ink-950"
          style={{ borderColor: "var(--line)", background: "color-mix(in srgb, var(--surface-raised) 85%, transparent)" }}
          title={`Rotate ${analog.code} in 3D`}
          aria-label={`View ${analog.code} in 3D`}
        >
          <Box className="h-3.5 w-3.5" /> 3D
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3 pt-2">
        <button onClick={() => onOpen(analog)} className="text-left">
          <p className="font-mono text-xs font-semibold text-accent">{analog.code}</p>
          <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug dim">{analog.name}</p>
        </button>

        <div className="mt-auto flex items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1">
            <span className="chip font-mono">MW {d.mw.toFixed(0)}</span>
            <span className="chip font-mono">logP {d.logP.toFixed(1)}</span>
            <span className="chip font-mono">QED {analog.assessment.qed.toFixed(2)}</span>
            <span className={`chip font-mono ${analog.assessment.lipinskiPass ? "text-pass" : "text-warn"}`}>
              Ro5 {analog.assessment.lipinskiPass ? "pass" : "fail"}
            </span>
          </div>
          <div className="relative shrink-0" title={`Nearspace score ${analog.score.total.toFixed(2)}`}>
            <ScoreRing value={analog.score.total} />
            <span className="absolute inset-0 grid place-items-center font-mono text-[10px] font-semibold tabular-nums">
              {Math.round(analog.score.total * 100)}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <code className="flex-1 truncate rounded-md bg-white/[0.04] px-2 py-1 font-mono text-[10px] dim">
            {analog.smiles}
          </code>
          <button
            onClick={() => {
              void navigator.clipboard.writeText(analog.smiles);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1200);
            }}
            className="rounded-md p-1.5 transition hover:bg-white/10"
            aria-label={`Copy SMILES for ${analog.code}`}
          >
            {copied ? <Check className="h-3.5 w-3.5 text-pass" /> : <Copy className="h-3.5 w-3.5 dim" />}
          </button>
        </div>
      </div>
    </article>
  );
}

export default memo(AnalogCard);
