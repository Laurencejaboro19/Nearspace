/**
 * Naming.
 *
 * Generated analogs are novel structures, and there is no free public service that turns an
 * arbitrary novel structure into a correct IUPAC name. So Nearspace gives every compound a stable
 * code plus a descriptive name built from the edits that were actually applied, and offers an
 * optional PubChem lookup that returns a real IUPAC name ONLY for compounds that already exist
 * there. Nothing is ever invented.
 */
import type { AppliedTransform } from "./generate";

/** Stable 6-character hash of a canonical scaffold id, used as the series code. */
export function seriesCode(canonicalScaffold: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < canonicalScaffold.length; i++) {
    const c = canonicalScaffold.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  let value = (h1 ^ h2) >>> 0;
  for (let i = 0; i < 6; i++) {
    out += alphabet[value % alphabet.length];
    value = Math.floor(value / alphabet.length) + ((h1 >>> (i * 3)) & 7);
  }
  return out;
}

export function codeName(series: string, index: number): string {
  return `NS-${series}-${String(index).padStart(4, "0")}`;
}

/**
 * Human-readable name from the edits applied, e.g.
 * "R1 → morpholin-4-yl, aza-scan analog of celecoxib".
 * Positions are given as the R-label or ring position Nearspace actually used; no locant is
 * invented.
 */
export function descriptiveName(parentName: string, transforms: AppliedTransform[]): string {
  if (!transforms.length) return `${parentName} (unchanged)`;
  const parts = transforms.map((t) => {
    if (t.kind === "replace") return `${t.site} → ${t.fragmentName}`;
    if (t.kind === "grow") return `${t.fragmentName} added at ${t.site}`;
    return `${t.fragmentName} at ${t.site}`;
  });
  return `${parts.join(", ")} — analog of ${parentName}`;
}

/* --------------------------------------------------------------- PubChem lookup */

export interface PubChemHit {
  inchiKeyOrSmiles: string;
  cid: number;
  iupacName?: string;
  title?: string;
}

const PUBCHEM = "https://pubchem.ncbi.nlm.nih.gov/rest/pug";

/**
 * Look a structure up by SMILES. Returns null when PubChem does not have it — which is the normal
 * answer for a freshly generated analog, and is reported as "novel (not in PubChem)".
 */
export async function lookupPubChem(smiles: string, signal?: AbortSignal): Promise<PubChemHit | null> {
  try {
    const url = `${PUBCHEM}/compound/smiles/${encodeURIComponent(smiles)}/property/IUPACName,Title/JSON`;
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    const data = await res.json();
    const row = data?.PropertyTable?.Properties?.[0];
    if (!row?.CID) return null;
    return { inchiKeyOrSmiles: smiles, cid: row.CID, iupacName: row.IUPACName, title: row.Title };
  } catch {
    return null;
  }
}

/** Throttled batch lookup so PubChem's rate limit (~5 requests/second) is respected. */
export async function lookupMany(
  smilesList: string[],
  onHit: (smiles: string, hit: PubChemHit | null) => void,
  signal?: AbortSignal,
): Promise<void> {
  for (const smiles of smilesList) {
    if (signal?.aborted) return;
    const hit = await lookupPubChem(smiles, signal);
    onHit(smiles, hit);
    await new Promise((r) => setTimeout(r, 260));
  }
}

/** Best-effort name for the molecule the user typed in. */
export async function nameParent(smiles: string, signal?: AbortSignal): Promise<string> {
  const hit = await lookupPubChem(smiles, signal);
  if (hit?.title) return hit.title;
  return "the query compound";
}
