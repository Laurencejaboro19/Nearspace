import { useEffect } from "react";
import { Download, Loader2, PanelRight, X } from "lucide-react";
import Viewer3D from "./Viewer3D";
import Structure from "./Structure";
import type { Analog } from "../chem/generate";

interface Props {
  analog: Analog | null;
  parentSmiles: string;
  onClose: () => void;
  /** Hand off to the full compound drawer. */
  onOpenDetails: (analog: Analog) => void;
  onDownload: (analog: Analog) => void;
  downloading: boolean;
}

/** A focused, large 3D view — what the "3D" button on a card opens. */
export default function Viewer3DModal({
  analog,
  parentSmiles,
  onClose,
  onOpenDetails,
  onDownload,
  downloading,
}: Props) {
  useEffect(() => {
    if (!analog) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [analog, onClose]);

  if (!analog) return null;
  const d = analog.assessment.descriptors;

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center p-3 sm:p-6" role="dialog" aria-modal="true" aria-label={`3D view of ${analog.code}`}>
      <button className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-label="Close 3D view" />
      <div
        className="panel relative flex max-h-full w-full max-w-3xl flex-col overflow-y-auto p-4 shadow-2xl animate-fade-up sm:p-5"
        style={{ background: "var(--surface-raised)" }}
      >
        <header className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-sm font-bold text-accent">{analog.code}</p>
            <p className="mt-0.5 line-clamp-2 text-xs leading-snug dim">{analog.name}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 transition hover:bg-white/10" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </header>

        <Viewer3D smiles={analog.smiles} code={analog.code} height="h-[48vh] sm:h-[52vh]" />

        <div className="mt-4 grid gap-3 sm:grid-cols-[150px_1fr]">
          <div className="panel p-2">
            <Structure smiles={analog.smiles} width={260} height={170} highlight={analog.changedAtoms} />
            <p className="mt-1 text-center text-[10px] dim">2D</p>
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-1">
              <span className="chip font-mono">MW {d.mw.toFixed(1)}</span>
              <span className="chip font-mono">cLogP {d.logP.toFixed(1)}</span>
              <span className="chip font-mono">TPSA {d.tpsa.toFixed(0)}</span>
              <span className="chip font-mono">QED {analog.assessment.qed.toFixed(2)}</span>
              <span className="chip font-mono">SA {analog.assessment.saScoreHeuristic.toFixed(1)}</span>
              <span className={`chip font-mono ${analog.assessment.lipinskiPass ? "text-pass" : "text-warn"}`}>
                Ro5 {analog.assessment.lipinskiPass ? "pass" : "fail"}
              </span>
            </div>
            <code className="break-all rounded-lg bg-white/[0.04] px-2 py-1.5 font-mono text-[10px] dim">
              {analog.smiles}
            </code>
            <div className="mt-auto flex flex-wrap gap-2">
              <button onClick={() => onDownload(analog)} disabled={downloading} className="btn-primary px-3 py-2 text-xs">
                {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                SDF (3D)
              </button>
              <button
                onClick={() => {
                  onClose();
                  onOpenDetails(analog);
                }}
                className="btn-ghost px-3 py-2 text-xs"
              >
                <PanelRight className="h-3.5 w-3.5" /> Full details
              </button>
            </div>
          </div>
        </div>

        {parentSmiles && (
          <p className="mt-3 text-[10px] dim">
            Highlighted atoms in the 2D view are what changed relative to the parent.
          </p>
        )}
      </div>
    </div>
  );
}
