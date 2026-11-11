import { useEffect, useMemo, useRef, useState } from "react";
import { depict, fromSmiles } from "../chem/mol";
import { useIsDark } from "../theme";

interface Props {
  smiles: string;
  width?: number;
  height?: number;
  highlight?: number[];
  /** Defaults to following the page theme. */
  dark?: boolean;
  /** Defer drawing until the card scrolls into view — essential at 1000 compounds. */
  lazy?: boolean;
  className?: string;
}

const cache = new Map<string, string>();

function render(smiles: string, width: number, height: number, highlight: number[], dark: boolean): string {
  const key = `${smiles}|${width}x${height}|${highlight.join(",")}|${dark ? "d" : "l"}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let svg: string;
  try {
    svg = depict(fromSmiles(smiles), { width, height, highlight, dark });
  } catch {
    svg = "";
  }
  if (cache.size > 3000) cache.clear();
  cache.set(key, svg);
  return svg;
}

export default function Structure({
  smiles,
  width = 300,
  height = 210,
  highlight = [],
  dark,
  lazy = false,
  className = "",
}: Props) {
  const themeIsDark = useIsDark();
  const isDark = dark ?? themeIsDark;
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(!lazy);

  useEffect(() => {
    if (!lazy || visible || !ref.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "400px" },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [lazy, visible]);

  const svg = useMemo(
    () => (visible ? render(smiles, width, height, highlight, isDark) : ""),
    [visible, smiles, width, height, highlight, isDark],
  );

  return (
    <div
      ref={ref}
      className={`structure ${className}`}
      style={{ aspectRatio: `${width} / ${height}` }}
      aria-label={`Structure of ${smiles}`}
      role="img"
    >
      {svg ? (
        <div dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <div className="h-full w-full animate-pulse rounded-lg bg-white/5" />
      )}
    </div>
  );
}
