/**
 * Molecule layer for Nearspace, built on OpenChemLib.
 *
 * Everything here runs in the browser (and inside the generation Web Worker): parsing, scaffold
 * detection, structural edits, depiction, similarity and 3D embedding. No server, no API keys.
 */
import { Molecule, MoleculeProperties, SmilesParser, SSSearcher, SSSearcherWithIndex } from "openchemlib";

export type Mol = Molecule;

/** Parse a SMILES string. Throws on invalid input. */
export function fromSmiles(smiles: string): Mol {
  const m = Molecule.fromSmiles(smiles.trim());
  m.ensureHelperArrays(Molecule.cHelperRings);
  return m;
}

/** Parse a molfile / SD record. */
export function fromMolfile(molfile: string): Mol {
  const m = Molecule.fromMolfile(molfile);
  m.ensureHelperArrays(Molecule.cHelperRings);
  return m;
}

/** Copy preserving atom numbering (getIDCode round-trips renumber atoms — never use that to clone). */
export function clone(m: Mol): Mol {
  const c = m.getCompactCopy();
  c.ensureHelperArrays(Molecule.cHelperRings);
  return c;
}

export function canonicalId(m: Mol): string {
  return m.getIDCode();
}

export function toSmiles(m: Mol): string {
  return m.toSmiles();
}

/** Keep only the largest connected fragment (drops salts and counter-ions). */
export function desalt(m: Mol): Mol {
  const fragments = m.getFragments();
  if (fragments.length <= 1) return m;
  let best = fragments[0];
  for (const f of fragments) if (f.getAllAtoms() > best.getAllAtoms()) best = f;
  best.ensureHelperArrays(Molecule.cHelperRings);
  return best;
}

/**
 * Valence sanity check. OCL will happily build a hypervalent atom if you add a bond to a full
 * valence, so every generated molecule is checked before it is accepted.
 */
export function isValid(m: Mol): boolean {
  try {
    m.ensureHelperArrays(Molecule.cHelperRings);
    for (let a = 0; a < m.getAllAtoms(); a++) {
      const max = m.getMaxValenceUncharged(a) + Math.abs(m.getAtomCharge(a));
      if (m.getOccupiedValence(a) > max) return false;
    }
    const smi = m.toSmiles();
    if (!smi) return false;
    const round = Molecule.fromSmiles(smi);
    round.ensureHelperArrays(Molecule.cHelperRings);
    return round.getAllAtoms() === m.getAllAtoms();
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ scaffold */

export interface RSite {
  /** Scaffold atom the substituent hangs off. */
  anchor: number;
  /** Atom indices of the substituent itself (in the parent molecule). */
  atoms: number[];
  /** SMILES of the substituent as it currently stands. */
  smiles: string;
  label: string;
}

export interface SiteReport {
  scaffoldAtoms: Set<number>;
  scaffoldSmiles: string;
  rsites: RSite[];
  /** Aromatic ring C–H positions available for growth / nitrogen scan. */
  aromaticCH: number[];
  /** Any ring atom with a free hydrogen. */
  growSites: number[];
}

/** Bemis–Murcko scaffold: strip terminal non-ring atoms until only rings and linkers remain. */
export function murckoScaffold(mol: Mol): { scaffold: Mol; parentAtoms: Set<number> } {
  const m = clone(mol);
  let map: number[] = Array.from({ length: m.getAllAtoms() }, (_, i) => i);
  for (;;) {
    m.ensureHelperArrays(Molecule.cHelperRings);
    const kill: number[] = [];
    for (let a = 0; a < m.getAllAtoms(); a++) {
      if (!m.isRingAtom(a) && m.getNonHydrogenNeighbourCount(a) <= 1) kill.push(a);
    }
    if (kill.length === 0) break;
    const am = m.deleteAtoms(kill);
    const next: number[] = [];
    am.forEach((newIndex, oldIndex) => {
      if (newIndex >= 0) next[newIndex] = map[oldIndex];
    });
    map = next;
  }
  m.ensureHelperArrays(Molecule.cHelperRings);
  return { scaffold: m, parentAtoms: new Set(map) };
}

export function analyseSites(mol: Mol): SiteReport {
  mol.ensureHelperArrays(Molecule.cHelperRings);
  const { scaffold, parentAtoms } = murckoScaffold(mol);
  const n = mol.getAllAtoms();

  const seen = new Array(n).fill(false);
  const rsites: RSite[] = [];
  for (let a = 0; a < n; a++) {
    if (parentAtoms.has(a) || seen[a]) continue;
    const comp: number[] = [];
    const stack = [a];
    seen[a] = true;
    let anchor = -1;
    while (stack.length) {
      const u = stack.pop() as number;
      comp.push(u);
      for (let k = 0; k < mol.getConnAtoms(u); k++) {
        const v = mol.getConnAtom(u, k);
        if (parentAtoms.has(v)) {
          anchor = v;
          continue;
        }
        if (!seen[v]) {
          seen[v] = true;
          stack.push(v);
        }
      }
    }
    if (anchor < 0) continue;
    rsites.push({
      anchor,
      atoms: comp.sort((x, y) => x - y),
      smiles: substituentSmiles(mol, comp),
      label: "",
    });
  }
  rsites.sort((a, b) => b.atoms.length - a.atoms.length);
  rsites.forEach((r, i) => (r.label = `R${i + 1}`));

  const aromaticCH: number[] = [];
  const growSites: number[] = [];
  for (let a = 0; a < n; a++) {
    if (!mol.isRingAtom(a)) continue;
    if (mol.getImplicitHydrogens(a) <= 0) continue;
    const z = mol.getAtomicNo(a);
    if (z !== 6 && z !== 7) continue;
    growSites.push(a);
    if (mol.isAromaticAtom(a) && z === 6) aromaticCH.push(a);
  }

  return {
    scaffoldAtoms: parentAtoms,
    scaffoldSmiles: scaffold.getAllAtoms() ? scaffold.toSmiles() : "",
    rsites,
    aromaticCH,
    growSites,
  };
}

function substituentSmiles(mol: Mol, atoms: number[]): string {
  try {
    const m = clone(mol);
    const keep = new Set(atoms);
    const kill: number[] = [];
    for (let a = 0; a < m.getAllAtoms(); a++) if (!keep.has(a)) kill.push(a);
    m.deleteAtoms(kill);
    m.ensureHelperArrays(Molecule.cHelperRings);
    return m.toSmiles();
  } catch {
    return "?";
  }
}

/* --------------------------------------------------------------------- edits */

/** Replace an existing substituent with a fragment (fragment atom 0 becomes the attachment). */
export function replaceSubstituent(mol: Mol, site: RSite, fragmentSmiles: string): Mol | null {
  try {
    const m = clone(mol);
    const am = m.deleteAtoms(site.atoms);
    const anchor = am[site.anchor];
    if (anchor === undefined || anchor < 0) return null;
    const frag = Molecule.fromSmiles(fragmentSmiles);
    const fmap = m.addMolecule(frag);
    m.addBond(anchor, fmap[0]);
    m.ensureHelperArrays(Molecule.cHelperRings);
    return m;
  } catch {
    return null;
  }
}

/** Grow a fragment onto a ring position that still carries a hydrogen. */
export function growAt(mol: Mol, atom: number, fragmentSmiles: string): Mol | null {
  try {
    if (mol.getImplicitHydrogens(atom) <= 0) return null;
    const m = clone(mol);
    const frag = Molecule.fromSmiles(fragmentSmiles);
    const fmap = m.addMolecule(frag);
    m.addBond(atom, fmap[0]);
    m.ensureHelperArrays(Molecule.cHelperRings);
    return m;
  } catch {
    return null;
  }
}

/** Nitrogen scan: turn an unsubstituted aromatic C–H into a ring heteroatom. */
export function swapRingAtom(mol: Mol, atom: number, atomicNo: number): Mol | null {
  try {
    if (!mol.isAromaticAtom(atom) || mol.getAtomicNo(atom) !== 6) return null;
    if (mol.getImplicitHydrogens(atom) <= 0) return null;
    const m = clone(mol);
    m.setAtomicNo(atom, atomicNo);
    m.ensureHelperArrays(Molecule.cHelperRings);
    return m;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------- depiction & similarity */

export interface DepictOptions {
  width?: number;
  height?: number;
  highlight?: number[];
  dark?: boolean;
  id?: string;
}

/**
 * Palette fixes for a dark canvas.
 *
 * OpenChemLib draws for paper: bonds and carbon labels come out as `rgb(0,0,0)` and nitrogen as a
 * deep blue, both of which vanish against a near-black background. Colours are remapped after the
 * fact rather than drawn differently, because the depiction code itself has no theme hook.
 */
const DARK_REMAP: [RegExp, string][] = [
  [/rgb\(0,\s*0,\s*0\)/g, "rgb(201,214,238)"], // bonds, carbon and hydrogen labels
  [/rgb\(48,\s*80,\s*248\)/g, "rgb(125,163,255)"], // nitrogen
  [/rgb\(255,\s*13,\s*13\)/g, "rgb(255,112,112)"], // oxygen
  [/rgb\(255,\s*181,\s*0\)/g, "rgb(255,206,84)"], // sulfur
  [/rgb\(144,\s*224,\s*80\)/g, "rgb(163,230,53)"], // fluorine
  [/rgb\(31,\s*240,\s*31\)/g, "rgb(110,231,183)"], // chlorine
];

/** Inline SVG depiction. Highlighted atoms are coloured, which is how changes are shown. */
export function depict(m: Mol, opts: DepictOptions = {}): string {
  const { width = 320, height = 240, highlight = [], dark = true, id } = opts;
  const copy = clone(m);
  if (highlight.length) {
    for (const a of highlight) {
      if (a >= 0 && a < copy.getAllAtoms()) copy.setAtomColor(a, Molecule.cAtomColorDarkRed);
    }
  }
  const svgId = id ?? `ns${Math.random().toString(36).slice(2, 9)}`;
  let svg = copy.toSVG(width, height, svgId, {
    suppressChiralText: true,
    autoCrop: true,
    autoCropMargin: 6,
    strokeWidth: 1.3,
  });
  if (dark) for (const [pattern, replacement] of DARK_REMAP) svg = svg.replace(pattern, replacement);
  return svg;
}

const indexer = new SSSearcherWithIndex();

export function fingerprint(m: Mol): number[] {
  return indexer.createIndex(m);
}

export function tanimoto(a: number[], b: number[]): number {
  return SSSearcherWithIndex.getSimilarityTanimoto(a, b);
}

/* ------------------------------------------------------------- SMARTS matching */

const smartsParser = new SmilesParser({ smartsMode: "smarts" });
const smartsCache = new Map<string, Mol | null>();

function smarts(pattern: string): Mol | null {
  if (smartsCache.has(pattern)) return smartsCache.get(pattern) as Mol | null;
  let q: Mol | null = null;
  try {
    q = smartsParser.parseMolecule(pattern);
    q.setFragment(true);
  } catch {
    q = null;
  }
  smartsCache.set(pattern, q);
  return q;
}

export function matchesSmarts(mol: Mol, pattern: string): boolean {
  const q = smarts(pattern);
  if (!q) return false;
  try {
    const searcher = new SSSearcher();
    searcher.setMol(q, mol);
    return searcher.isFragmentInMolecule();
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ properties */

export function oclProperties(m: Mol) {
  const p = new MoleculeProperties(m);
  return {
    logP: p.logP,
    logS: p.logS,
    tpsa: p.polarSurfaceArea,
    rotatableBonds: p.rotatableBondCount,
    stereoCenters: p.stereoCenterCount,
    hbd: p.donorCount,
    hba: p.acceptorCount,
  };
}

const ATOMIC_WEIGHT: Record<number, number> = {
  1: 1.008, 5: 10.81, 6: 12.011, 7: 14.007, 8: 15.999, 9: 18.998, 14: 28.085,
  15: 30.974, 16: 32.06, 17: 35.45, 34: 78.971, 35: 79.904, 53: 126.904,
};

export function molecularWeight(m: Mol): number {
  m.ensureHelperArrays(Molecule.cHelperNeighbours);
  let mw = 0;
  for (let a = 0; a < m.getAllAtoms(); a++) {
    const z = m.getAtomicNo(a);
    mw += ATOMIC_WEIGHT[z] ?? 0;
    mw += (m.getImplicitHydrogens(a) + m.getExplicitHydrogens(a)) * ATOMIC_WEIGHT[1];
  }
  return mw;
}

export function heavyAtomCount(m: Mol): number {
  let n = 0;
  for (let a = 0; a < m.getAllAtoms(); a++) if (m.getAtomicNo(a) > 1) n++;
  return n;
}

export function aromaticRingCount(m: Mol): number {
  m.ensureHelperArrays(Molecule.cHelperRings);
  return m.getAromaticRingCount();
}

export function ringCount(m: Mol): number {
  m.ensureHelperArrays(Molecule.cHelperRings);
  return m.getRingSet().getSize();
}

export function formalCharge(m: Mol): number {
  let c = 0;
  for (let a = 0; a < m.getAllAtoms(); a++) c += m.getAtomCharge(a);
  return c;
}

export function fractionCsp3(m: Mol): number {
  m.ensureHelperArrays(Molecule.cHelperRings);
  let carbons = 0;
  let sp3 = 0;
  for (let a = 0; a < m.getAllAtoms(); a++) {
    if (m.getAtomicNo(a) !== 6) continue;
    carbons++;
    if (!m.isAromaticAtom(a) && m.getAtomPi(a) === 0) sp3++;
  }
  return carbons ? sp3 / carbons : 0;
}

export { Molecule };
