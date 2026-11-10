import { useEffect, useRef, useState } from "react";
import { Loader2, Orbit, RotateCcw } from "lucide-react";
import { conformer3D, ensure3DResources } from "../chem/export";
import { fromSmiles } from "../chem/mol";
import type { Viewer3Dmol } from "../vite-env";

type Style = "stick" | "ball" | "spacefill" | "surface";

const STYLES: { id: Style; label: string }[] = [
  { id: "stick", label: "Stick" },
  { id: "ball", label: "Ball & stick" },
  { id: "spacefill", label: "Spacefill" },
  { id: "surface", label: "Surface" },
];

export default function Viewer3D({ smiles, code }: { smiles: string; code: string }) {
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer3Dmol | null>(null);
  const [style, setStyle] = useState<Style>("ball");
  const [spinning, setSpinning] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [molblock, setMolblock] = useState<string | null>(null);
  const [embedded, setEmbedded] = useState(true);

  // Build the 3D conformer (and fall back to flat coordinates if embedding fails).
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    (async () => {
      try {
        await ensure3DResources();
        const mol = fromSmiles(smiles);
        const conformer = conformer3D(mol);
        if (cancelled) return;
        if (conformer) {
          setEmbedded(true);
          setMolblock(conformer.toMolfile());
        } else {
          setEmbedded(false);
          setMolblock(mol.toMolfile());
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [smiles]);

  // Wait for the 3Dmol script, then draw.
  useEffect(() => {
    if (!molblock || !host.current) return;
    let cancelled = false;
    let tries = 0;

    const draw = () => {
      if (cancelled) return;
      const lib = window.$3Dmol;
      if (!lib) {
        if (tries++ > 80) setStatus("error");
        else window.setTimeout(draw, 100);
        return;
      }
      try {
        if (!viewer.current) {
          viewer.current = lib.createViewer(host.current as HTMLElement, { backgroundAlpha: 0 });
        }
        const v = viewer.current;
        v.removeAllSurfaces();
        v.removeAllModels();
        v.addModel(molblock, "sdf");
        applyStyle(v, style);
        v.zoomTo();
        v.render();
        v.spin(spinning ? "y" : false);
        setStatus("ready");
      } catch {
        setStatus("error");
      }
    };

    draw();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [molblock]);

  // Style / spin changes without rebuilding the model.
  useEffect(() => {
    const v = viewer.current;
    if (!v || status !== "ready") return;
    v.removeAllSurfaces();
    applyStyle(v, style);
    v.render();
  }, [style, status]);

  useEffect(() => {
    const v = viewer.current;
    if (!v || status !== "ready") return;
    v.spin(spinning ? "y" : false);
  }, [spinning, status]);

  useEffect(() => {
    const onResize = () => viewer.current?.resize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <div className="space-y-3">
      <div className="relative h-64 overflow-hidden rounded-xl border sm:h-80" style={{ borderColor: "var(--line)" }}>
        <div ref={host} className="absolute inset-0" />
        {status === "loading" && (
          <div className="absolute inset-0 grid place-items-center text-xs dim">
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Embedding 3D coordinates…
            </span>
          </div>
        )}
        {status === "error" && (
          <div className="absolute inset-0 grid place-items-center px-6 text-center text-xs dim">
            The 3D viewer could not start. The 2D structure and the SDF download are unaffected.
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-xl border p-1" style={{ borderColor: "var(--line)" }}>
          {STYLES.map((s) => (
            <button
              key={s.id}
              onClick={() => setStyle(s.id)}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                style === s.id ? "bg-accent text-ink-950" : "dim hover:bg-white/5"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <button onClick={() => setSpinning((s) => !s)} className="btn-ghost px-3 py-1.5 text-xs">
          <Orbit className="h-3.5 w-3.5" /> {spinning ? "Stop" : "Spin"}
        </button>
        <button
          onClick={() => {
            viewer.current?.zoomTo();
            viewer.current?.render();
          }}
          className="btn-ghost px-3 py-1.5 text-xs"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Reset
        </button>
      </div>

      <p className="text-[11px] dim">
        {embedded
          ? `${code} — single conformer from a distance-geometry embedding. Good enough to inspect and to feed a docking run, which will generate its own conformers.`
          : `${code} — 3D embedding failed for this structure, so flat coordinates are shown. Generate conformers yourself before docking.`}
      </p>
    </div>
  );
}

function applyStyle(v: Viewer3Dmol, style: Style) {
  const colorScheme = { colorscheme: "cyanCarbon" };
  if (style === "stick") v.setStyle({}, { stick: { radius: 0.14, ...colorScheme } });
  else if (style === "ball") v.setStyle({}, { stick: { radius: 0.12, ...colorScheme }, sphere: { scale: 0.26, ...colorScheme } });
  else if (style === "spacefill") v.setStyle({}, { sphere: { scale: 0.95, ...colorScheme } });
  else {
    v.setStyle({}, { stick: { radius: 0.12, ...colorScheme } });
    try {
      v.addSurface((window.$3Dmol as unknown as { SurfaceType: { VDW: unknown } }).SurfaceType.VDW, {
        opacity: 0.68,
        color: "#22d3ee",
      });
    } catch {
      /* surface generation is optional */
    }
  }
}
