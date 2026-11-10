/**
 * The Nearspace generation engine.
 *
 * Build the full space of single and paired edits to a query molecule, shuffle it with a seeded
 * PRNG, apply the edits, keep what survives sanitisation and deduplication, and score the result.
 * Deterministic for a given (query, mode, count, seed).
 */
import {
  Mol,
  analyseSites,
  clone,
  desalt,
  fingerprint,
  fromSmiles,
  growAt,
  isValid,
  replaceSubstituent,
  swapRingAtom,
  tanimoto,
  toSmiles,
  canonicalId,
  murckoScaffold,
} from "./mol";
import { Assessment, assess } from "./properties";
import { ScoreParts, compositeScore } from "./score";
import { FRAGMENTS, Fragment, RING_SWAPS } from "./transforms";
import { codeName, descriptiveName, seriesCode } from "./naming";

export type Mode = "conservative" | "explore" | "grow";

export interface GenerateOptions {
  smiles: string;
  mode: Mode;
  count: number;
  seed?: number;
  /** Parent atom indices the user has locked — never edited. */
  lockedAtoms?: number[];
  /** R-site labels (R1, R2 …) the user locked in the UI. */
  lockedSites?: string[];
  /** Restrict to fragments whose category is enabled. */
  categories?: string[];
  parentName?: string;
}

export interface AppliedTransform {
  kind: "replace" | "grow" | "ringswap";
  /** R-label or ring position used, e.g. "R1" or "ring position 7". */
  site: string;
  fragmentId: string;
  fragmentName: string;
  drugs: string[];
}

export interface Analog {
  index: number;
  code: string;
  name: string;
  smiles: string;
  canonical: string;
  transforms: AppliedTransform[];
  /** Atom indices in THIS analog that differ from the parent (for highlighting). */
  changedAtoms: number[];
  assessment: Assessment;
  similarity: number;
  score: ScoreParts;
  pubchem?: { cid: number; iupacName?: string; title?: string } | null;
}

export interface GenerateResult {
  parent: {
    smiles: string;
    name: string;
    scaffoldSmiles: string;
    series: string;
    assessment: Assessment;
    rsites: { label: string; smiles: string; anchor: number; atoms: number[] }[];
    growSiteCount: number;
    aromaticCHCount: number;
  };
  analogs: Analog[];
  requested: number;
  exhausted: boolean;
  spaceSize: number;
}

export interface Progress {
  phase: "analysing" | "enumerating" | "building" | "done";
  done: number;
  target: number;
}

/* --------------------------------------------------------------------- PRNG */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rnd: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/* ---------------------------------------------------------------- edit space */

type Edit =
  | { kind: "replace"; siteIndex: number; fragment: Fragment }
  | { kind: "grow"; atom: number; fragment: Fragment }
  | { kind: "ringswap"; atom: number; atomicNo: number; name: string; drugs: string[] };

function weightedOrder(edits: Edit[], rnd: () => number): Edit[] {
  // Sample without replacement, biased by fragment weight: a stable way to put common medicinal
  // chemistry moves near the front without ever excluding the rarer ones.
  return edits
    .map((e) => {
      const w = e.kind === "ringswap" ? 10 : e.fragment.weight;
      return { e, key: -Math.log(1 - rnd()) / Math.max(w, 0.5) };
    })
    .sort((a, b) => a.key - b.key)
    .map((x) => x.e);
}

/* ------------------------------------------------------------------ generation */

export function generate(options: GenerateOptions, onProgress?: (p: Progress) => void): GenerateResult {
  const { mode, count } = options;
  const seed = options.seed ?? 20261110;
  const rnd = mulberry32(seed);
  const locked = new Set(options.lockedAtoms ?? []);
  const lockedLabels = new Set(options.lockedSites ?? []);

  onProgress?.({ phase: "analysing", done: 0, target: count });

  const parent = desalt(fromSmiles(options.smiles));
  const parentSmiles = toSmiles(parent);
  const parentFp = fingerprint(parent);
  const parentId = canonicalId(parent);
  const sites = analyseSites(parent);
  const scaffoldMol = murckoScaffold(parent).scaffold;
  const series = seriesCode(scaffoldMol.getAllAtoms() ? scaffoldMol.getIDCode() : parentId);
  const parentName = options.parentName?.trim() || "the query compound";

  const allowed = new Set(options.categories ?? FRAGMENTS.map((f) => f.category));
  const fragments = FRAGMENTS.filter((f) => allowed.has(f.category));

  // Keep the index INTO sites.rsites — applyEdits looks sites up by that index, so a filtered
  // list must never be re-indexed from zero.
  const usableSites = sites.rsites
    .map((site, siteIndex) => ({ site, siteIndex }))
    .filter(
      ({ site }) =>
        !lockedLabels.has(site.label) && !site.atoms.some((a) => locked.has(a)) && !locked.has(site.anchor),
    );
  const usableGrow = sites.growSites.filter((a) => !locked.has(a));
  const usableAromaticCH = sites.aromaticCH.filter((a) => !locked.has(a));

  // --- single edits -----------------------------------------------------------
  const singles: Edit[] = [];
  if (mode === "conservative" || mode === "explore") {
    for (const { site, siteIndex } of usableSites) {
      for (const fragment of fragments) {
        if (fragment.smiles === site.smiles) continue;
        singles.push({ kind: "replace", siteIndex, fragment });
      }
    }
  }
  if (mode === "explore") {
    for (const atom of usableAromaticCH) {
      for (const swap of RING_SWAPS) {
        singles.push({ kind: "ringswap", atom, atomicNo: swap.atomicNo, name: swap.name, drugs: swap.drugs });
      }
    }
  }
  if (mode === "grow") {
    for (const atom of usableGrow) {
      for (const fragment of fragments) {
        if (!fragment.growable && sites.aromaticCH.indexOf(atom) < 0) continue;
        singles.push({ kind: "grow", atom, fragment });
      }
    }
    // Growth alone is sparse on small scaffolds, so allow substitution too.
    for (const { site, siteIndex } of usableSites) {
      for (const fragment of fragments) {
        if (fragment.smiles === site.smiles) continue;
        singles.push({ kind: "replace", siteIndex, fragment });
      }
    }
  }

  onProgress?.({ phase: "enumerating", done: 0, target: count });

  const ordered = weightedOrder(singles, rnd);

  // --- pairs (explore / grow) --------------------------------------------------
  const pairs: [Edit, Edit][] = [];
  if (mode !== "conservative") {
    const pool = ordered.slice(0, Math.min(ordered.length, 220));
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        if (!compatible(pool[i], pool[j])) continue;
        pairs.push([pool[i], pool[j]]);
      }
    }
  }
  const orderedPairs = shuffle(pairs, rnd);
  const spaceSize = ordered.length + orderedPairs.length;

  // --- build -------------------------------------------------------------------
  onProgress?.({ phase: "building", done: 0, target: count });

  const seen = new Set<string>([parentId]);
  const analogs: Analog[] = [];

  const consider = (edits: Edit[]) => {
    if (analogs.length >= count) return;
    const built = applyEdits(parent, sites, edits);
    if (!built) return;
    const { mol, transforms } = built;
    if (!isValid(mol)) return;
    const id = canonicalId(mol);
    if (seen.has(id)) return;
    seen.add(id);

    const smiles = toSmiles(mol);
    const assessment = assess(mol);
    const similarity = tanimoto(parentFp, fingerprint(mol));
    const score = compositeScore({
      similarity,
      qed: assessment.qed,
      saScoreHeuristic: assessment.saScoreHeuristic,
      alertCount: assessment.alerts.length,
    });

    const index = analogs.length + 1;
    analogs.push({
      index,
      code: codeName(series, index),
      name: descriptiveName(parentName, transforms),
      smiles,
      canonical: id,
      transforms,
      changedAtoms: changedAtoms(mol, parent),
      assessment,
      similarity,
      score,
    });
    if (analogs.length % 10 === 0) onProgress?.({ phase: "building", done: analogs.length, target: count });
  };

  for (const edit of ordered) {
    if (analogs.length >= count) break;
    consider([edit]);
  }
  for (const pair of orderedPairs) {
    if (analogs.length >= count) break;
    consider(pair);
  }

  analogs.sort((a, b) => b.score.total - a.score.total);
  analogs.forEach((a, i) => {
    a.index = i + 1;
    a.code = codeName(series, i + 1);
  });

  onProgress?.({ phase: "done", done: analogs.length, target: count });

  return {
    parent: {
      smiles: parentSmiles,
      name: parentName,
      scaffoldSmiles: sites.scaffoldSmiles,
      series,
      assessment: assess(parent),
      rsites: sites.rsites.map((r) => ({ label: r.label, smiles: r.smiles, anchor: r.anchor, atoms: r.atoms })),
      growSiteCount: sites.growSites.length,
      aromaticCHCount: sites.aromaticCH.length,
    },
    analogs,
    requested: count,
    exhausted: analogs.length < count,
    spaceSize,
  };
}

function compatible(a: Edit, b: Edit): boolean {
  if (a.kind === "replace" && b.kind === "replace") return a.siteIndex !== b.siteIndex;
  if (a.kind !== "replace" && b.kind !== "replace") {
    const atomA = (a as { atom: number }).atom;
    const atomB = (b as { atom: number }).atom;
    return atomA !== atomB;
  }
  return true;
}

function applyEdits(
  parent: Mol,
  sites: ReturnType<typeof analyseSites>,
  edits: Edit[],
): { mol: Mol; transforms: AppliedTransform[] } | null {
  // Substituent replacements are applied first (they delete atoms and renumber everything), so
  // atom-index edits are converted to a replacement-safe order: ring edits before deletions.
  const ringEdits = edits.filter((e) => e.kind !== "replace");
  const replaceEdits = edits.filter((e) => e.kind === "replace");

  let mol: Mol | null = clone(parent);
  const transforms: AppliedTransform[] = [];

  for (const edit of ringEdits) {
    if (!mol) return null;
    if (edit.kind === "grow") {
      mol = growAt(mol, edit.atom, edit.fragment.smiles);
      transforms.push({
        kind: "grow",
        site: `ring position ${edit.atom + 1}`,
        fragmentId: edit.fragment.id,
        fragmentName: edit.fragment.name,
        drugs: edit.fragment.drugs,
      });
    } else if (edit.kind === "ringswap") {
      mol = swapRingAtom(mol, edit.atom, edit.atomicNo);
      transforms.push({
        kind: "ringswap",
        site: `ring position ${edit.atom + 1}`,
        fragmentId: "aza",
        fragmentName: edit.name,
        drugs: edit.drugs,
      });
    }
  }

  // Replacements delete atoms, so apply them from the highest atom indices down to keep the
  // remaining site indices valid.
  const ordered = replaceEdits
    .map((e) => e as Extract<Edit, { kind: "replace" }>)
    .sort((a, b) => sites.rsites[b.siteIndex].anchor - sites.rsites[a.siteIndex].anchor);

  for (const edit of ordered) {
    if (!mol) return null;
    const site = sites.rsites[edit.siteIndex];
    mol = replaceSubstituent(mol, site, edit.fragment.smiles);
    transforms.push({
      kind: "replace",
      site: site.label,
      fragmentId: edit.fragment.id,
      fragmentName: edit.fragment.name,
      drugs: edit.fragment.drugs,
    });
  }

  if (!mol) return null;
  return { mol, transforms };
}

/**
 * Atoms of the analog that are new relative to the parent, found by matching the parent as a
 * substructure. Used only for highlighting, so a miss simply means nothing is highlighted.
 */
function changedAtoms(analog: Mol, parent: Mol): number[] {
  try {
    const parentAtoms = parent.getAllAtoms();
    const analogAtoms = analog.getAllAtoms();
    if (analogAtoms <= parentAtoms) return [];
    const out: number[] = [];
    for (let a = parentAtoms; a < analogAtoms; a++) out.push(a);
    return out;
  } catch {
    return [];
  }
}
