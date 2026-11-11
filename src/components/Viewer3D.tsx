import { useEffect, useRef, useState } from "react";
import { Loader2, Orbit, RotateCcw } from "lucide-react";
import { conformer3D, ensure3DResources } from "../chem/export";
import { fromSmiles } from "../chem/mol";

type Style = "stick" | "ball" | "spacefill" | "surface";

const STYLES: { id: Style; label: string }[] = [
  { id: "stick", label: "Stick" },
  { id: "ball", label: "Ball & stick" },
  { id: "spacefill", label: "Spacefill" },
  { id: "surface", label: "Surface" },
];

interface Viewer {
  addModel: (data: string, format: string) => unknown;
  setStyle: (sel: Record<string, unknown>, style: Record<string, unknown>) => void;
  addSurface: (type: unknown, opts: Record<string, unknown>) => void;
  removeAllModels: () => void;
  removeAllSurfaces: () => void;
  zoomTo: () => void;
  render: () => void;
  spin: (axis: string | boolean) => void;
  resize: () => void;
}

interface Lib {
  createViewer: (el: HTMLElement, cfg?: Record<string, unknown>) => Viewer;
  SurfaceType: { VDW: unknown };
}

/**
 * 3Dmol is bundled rather than pulled from a CDN: a blocked or slow CDN would otherwise take the
 * 3D view down with it, and plenty of university and hospital networks block them. Loaded on demand
 * so its weight is only paid by someone who actually opens a 3D view.
 */
let libPromise: Promise<Lib> | null = null;
function load3Dmol(): Promise<Lib> {
  if (!libPromise) {
    libPromise = import("3dmol/build/3Dmol.es6.js").then(
      (m) => ((m as unknown as { default?: Lib }).default ?? m) as unknown as Lib,
      (error) => {
        libPromise = null;
        throw error;
      },
    );
  }
  return libPromise;
}

export default function Viewer3D({
  smiles,
  code,
  height = "h-64 sm:h-80",
}: {
  smiles: string;
  code: string;
  height?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer | null>(null);
  const lib = useRef<Lib | null>(null);
  const [style, setStyle] = useState<Style>("ball");
  const [spinning, setSpinning] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("Building a 3D conformer…");
  const [embedded, setEmbedded] = useState(true);

  // Build the conformer and draw it.
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setMessage("Building a 3D conformer…");
    viewer.current = null;

    (async () => {
      try {
        await ensure3DResources();
        if (cancelled) return;

        const mol = fromSmiles(smiles);
        const conformer = conformer3D(mol);
        const molblock = conformer ? conformer.toMolfile() : mol.toMolfile();
        if (cancelled) return;
        setEmbedded(!!conformer);

        setMessage("Starting the viewer…");
        const $3Dmol = await load3Dmol();
        if (cancelled || !host.current) return;
        lib.current = $3Dmol;

        const v = $3Dmol.createViewer(host.current, { backgroundAlpha: 0 });
        viewer.current = v;
        v.addModel(molblock, "sdf");
        applyStyle(v, $3Dmol, style);
        v.zoomTo();
        v.render();
        if (spinning) v.spin("y");
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smiles]);

  // Style changes reuse the existing model.
  useEffect(() => {
    const v = viewer.current;
    if (!v || !lib.current || status !== "ready") return;
    v.removeAllSurfaces();
    applyStyle(v, lib.current, style);
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
      <div
        className={`relative ${height} overflow-hidden rounded-xl border`}
        style={{ borderColor: "var(--line)" }}
        data-testid="viewer3d"
        data-status={status}
      >
        <div ref={host} className="absolute inset-0 [&_canvas]:!rounded-xl" />
        {status === "loading" && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-xs dim">
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> {message}
            </span>
          </div>
        )}
        {status === "error" && (
          <div className="absolute inset-0 grid place-items-center px-6 text-center text-xs dim">
            The 3D view could not be built for this structure. The 2D depiction and the SDF download are
            unaffected.
          </div>
        )}
        {status === "ready" && (
          <span className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/40 px-2.5 py-1 text-[10px] text-white/70 backdrop-blur">
            Drag to rotate · scroll to zoom · right-drag to pan
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-xl border p-1" style={{ borderColor: "var(--line)" }}>
          {STYLES.map((s) => (
            <button
              key={s.id}
              onClick={() => setStyle(s.id)}
              disabled={status !== "ready"}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition disabled:opacity-40 ${
                style === s.id ? "bg-accent text-ink-950" : "dim hover:bg-white/5"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setSpinning((s) => !s)}
          disabled={status !== "ready"}
          className="btn-ghost px-3 py-1.5 text-xs"
        >
          <Orbit className="h-3.5 w-3.5" /> {spinning ? "Stop" : "Spin"}
        </button>
        <button
          onClick={() => {
            viewer.current?.zoomTo();
            viewer.current?.render();
          }}
          disabled={status !== "ready"}
          className="btn-ghost px-3 py-1.5 text-xs"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Reset
        </button>
      </div>

      <p className="text-[11px] dim">
        {embedded
          ? `${code} — a single conformer from a distance-geometry embedding. Fine for inspection and as a docking starting point; Vina will generate its own conformers.`
          : `${code} — 3D embedding failed for this structure, so flat coordinates are shown. Generate conformers yourself before docking.`}
      </p>
    </div>
  );
}

function applyStyle(v: Viewer, lib: Lib, style: Style) {
  const scheme = { colorscheme: "cyanCarbon" };
  if (style === "stick") v.setStyle({}, { stick: { radius: 0.14, ...scheme } });
  else if (style === "ball") v.setStyle({}, { stick: { radius: 0.12, ...scheme }, sphere: { scale: 0.26, ...scheme } });
  else if (style === "spacefill") v.setStyle({}, { sphere: { scale: 0.95, ...scheme } });
  else {
    v.setStyle({}, { stick: { radius: 0.12, ...scheme } });
    try {
      v.addSurface(lib.SurfaceType.VDW, { opacity: 0.68, color: "#22d3ee" });
    } catch {
      /* surfaces are a nicety, not a requirement */
    }
  }
}
