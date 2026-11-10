import { useEffect, useState } from "react";
import { Check, Copy, Download, ExternalLink, Loader2, Search, X } from "lucide-react";
import Structure from "./Structure";
import Viewer3D from "./Viewer3D";
import { analogRecord, download, ensure3DResources } from "../chem/export";
import { lookupPubChem } from "../chem/naming";
import { ALERT_NOTES } from "../chem/properties";
import { WEIGHTS } from "../chem/score";
import type { Analog } from "../chem/generate";

interface Props {
  analog: Analog | null;
  parentSmiles: string;
  onClose: () => void;
  onPubChem: (code: string, hit: Analog["pubchem"]) => void;
}

export default function DetailDrawer({ analog, parentSmiles, onClose, onPubChem }: Props) {
  const [looking, setLooking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!analog) return null;
  const d = analog.assessment.descriptors;

  const rows: [string, string][] = [
    ["Molecular weight", `${d.mw.toFixed(2)} Da`],
    ["cLogP", d.logP.toFixed(2)],
    ["Aqueous logS", d.logS.toFixed(2)],
    ["TPSA", `${d.tpsa.toFixed(1)} Å²`],
    ["H-bond donors", String(d.hbd)],
    ["H-bond acceptors", String(d.hba)],
    ["Rotatable bonds", String(d.rotatableBonds)],
    ["Heavy atoms", String(d.heavyAtoms)],
    ["Rings / aromatic", `${d.rings} / ${d.aromaticRings}`],
    ["Fraction Csp³", d.fractionCsp3.toFixed(2)],
    ["Stereocentres", String(d.stereoCenters)],
    ["Formal charge", String(d.formalCharge)],
    ["QED", analog.assessment.qed.toFixed(3)],
    ["SA score (heuristic)", `${analog.assessment.saScoreHeuristic.toFixed(2)} / 10`],
    ["Tanimoto to parent", analog.similarity.toFixed(3)],
  ];

  async function lookUp() {
    if (!analog) return;
    setLooking(true);
    const hit = await lookupPubChem(analog.smiles);
    onPubChem(analog.code, hit ? { cid: hit.cid, iupacName: hit.iupacName, title: hit.title } : null);
    setLooking(false);
  }

  async function downloadOne(threeD: boolean) {
    if (!analog) return;
    setDownloading(true);
    try {
      if (threeD) await ensure3DResources();
      download(`${analog.code}.sdf`, analogRecord(analog, { threeD, parentSmiles }), "chemical/x-mdl-sdfile");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={analog.code}>
      <button className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-label="Close details" />
      <div
        className="relative flex h-full w-full max-w-xl flex-col overflow-y-auto border-l shadow-2xl animate-fade-up"
        style={{ background: "var(--surface-raised)", borderColor: "var(--line)" }}
      >
        <header
          className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b px-5 py-4 backdrop-blur"
          style={{ borderColor: "var(--line)", background: "color-mix(in srgb, var(--surface-raised) 88%, transparent)" }}
        >
          <div className="min-w-0">
            <p className="font-mono text-sm font-bold text-accent">{analog.code}</p>
            <p className="mt-0.5 text-sm leading-snug">{analog.name}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 transition hover:bg-white/10" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-6 p-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="panel p-2">
              <Structure smiles={parentSmiles} width={260} height={170} />
              <p className="mt-1 text-center text-[10px] dim">Parent</p>
            </div>
            <div className="panel p-2">
              <Structure smiles={analog.smiles} width={260} height={170} highlight={analog.changedAtoms} />
              <p className="mt-1 text-center text-[10px] dim">This analog</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <code className="flex-1 break-all rounded-lg bg-white/[0.04] px-3 py-2 font-mono text-[11px]">
              {analog.smiles}
            </code>
            <button
              onClick={() => {
                void navigator.clipboard.writeText(analog.smiles);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1200);
              }}
              className="btn-ghost px-3 py-2"
              aria-label="Copy SMILES"
            >
              {copied ? <Check className="h-4 w-4 text-pass" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>

          {/* ------------------------------------------------------------- 3D */}
          <section>
            <h3 className="label">3D structure</h3>
            <Viewer3D smiles={analog.smiles} code={analog.code} />
          </section>

          {/* ------------------------------------------------------- transforms */}
          <section>
            <h3 className="label">What changed</h3>
            <ul className="space-y-2">
              {analog.transforms.map((t, i) => (
                <li key={i} className="panel p-3">
                  <p className="text-sm">
                    <span className="font-mono text-accent">{t.site}</span>{" "}
                    <span className="dim">{t.kind === "replace" ? "replaced with" : t.kind === "grow" ? "grown with" : "modified by"}</span>{" "}
                    <strong className="font-semibold">{t.fragmentName}</strong>
                  </p>
                  <p className="mt-1 text-[11px] dim">In approved drugs: {t.drugs.join(", ")}</p>
                </li>
              ))}
            </ul>
          </section>

          {/* -------------------------------------------------------- properties */}
          <section>
            <h3 className="label">Calculated properties</h3>
            <dl className="panel divide-y overflow-hidden" style={{ borderColor: "var(--line)" }}>
              {rows.map(([k, v]) => (
                <div key={k} className="flex items-center justify-between px-3 py-2" style={{ borderColor: "var(--line)" }}>
                  <dt className="text-xs dim">{k}</dt>
                  <dd className="font-mono text-xs font-medium tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
          </section>

          {/* ------------------------------------------------------------ rules */}
          <section>
            <h3 className="label">Rule panels</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {analog.assessment.rules.map((r) => (
                <div key={r.name} className="panel p-3">
                  <p className="flex items-center justify-between text-xs font-semibold">
                    {r.name}
                    <span className={r.pass ? "text-pass" : "text-warn"}>{r.pass ? "pass" : "fail"}</span>
                  </p>
                  {r.violations.length > 0 && <p className="mt-1 text-[11px] dim">{r.violations.join(" · ")}</p>}
                </div>
              ))}
            </div>
          </section>

          {/* ----------------------------------------------------------- alerts */}
          {analog.assessment.alerts.length > 0 && (
            <section>
              <h3 className="label">Structural alerts</h3>
              <ul className="space-y-1.5">
                {analog.assessment.alerts.map((a) => (
                  <li key={a} className="panel border-warn/30 p-3">
                    <p className="text-xs font-semibold text-warn">{a}</p>
                    <p className="mt-0.5 text-[11px] dim">{ALERT_NOTES.get(a)}</p>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] dim">
                Flags for triage, not verdicts — several approved drugs carry one.
              </p>
            </section>
          )}

          {/* ------------------------------------------------------------ score */}
          <section>
            <h3 className="label">Score breakdown</h3>
            <div className="panel space-y-2 p-3">
              {(
                [
                  ["Similarity to parent", analog.score.similarity, WEIGHTS.similarity],
                  ["Drug-likeness (QED)", analog.score.qed, WEIGHTS.qed],
                  ["Ease of synthesis", analog.score.synthesis, WEIGHTS.synthesis],
                  ["Free of alerts", analog.score.cleanliness, WEIGHTS.cleanliness],
                ] as [string, number, number][]
              ).map(([label, value, weight]) => (
                <div key={label}>
                  <div className="mb-1 flex justify-between text-[11px]">
                    <span className="dim">
                      {label} <span className="opacity-60">×{weight}</span>
                    </span>
                    <span className="font-mono tabular-nums">{value.toFixed(2)}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${value * 100}%` }} />
                  </div>
                </div>
              ))}
              <p className="border-t pt-2 text-xs font-semibold" style={{ borderColor: "var(--line)" }}>
                Nearspace score{" "}
                <span className="float-right font-mono text-accent">{analog.score.total.toFixed(3)}</span>
              </p>
            </div>
          </section>

          {/* ---------------------------------------------------------- pubchem */}
          <section>
            <h3 className="label">Known identity</h3>
            {analog.pubchem === undefined ? (
              <button onClick={lookUp} disabled={looking} className="btn-ghost w-full">
                {looking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Check PubChem for a real name
              </button>
            ) : analog.pubchem === null ? (
              <p className="panel p-3 text-xs dim">
                Not found in PubChem — this structure appears to be novel, so it carries its Nearspace code and a
                descriptive name. No IUPAC name is invented for it.
              </p>
            ) : (
              <div className="panel space-y-1 p-3">
                <p className="text-sm font-semibold">{analog.pubchem.title ?? "Known compound"}</p>
                {analog.pubchem.iupacName && <p className="text-[11px] dim">{analog.pubchem.iupacName}</p>}
                <a
                  href={`https://pubchem.ncbi.nlm.nih.gov/compound/${analog.pubchem.cid}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                >
                  PubChem CID {analog.pubchem.cid} <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}
          </section>

          {/* -------------------------------------------------------- downloads */}
          <section className="grid grid-cols-2 gap-2 pb-6">
            <button onClick={() => downloadOne(true)} disabled={downloading} className="btn-primary">
              {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} SDF (3D)
            </button>
            <button onClick={() => downloadOne(false)} disabled={downloading} className="btn-ghost">
              <Download className="h-4 w-4" /> MOL (2D)
            </button>
            <button
              onClick={() => download(`${analog.code}.smi`, `${analog.smiles}\t${analog.code}\n`)}
              className="btn-ghost col-span-2"
            >
              <Download className="h-4 w-4" /> SMILES file
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
