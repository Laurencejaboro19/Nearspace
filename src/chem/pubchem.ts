/**
 * PubChem lookup — the "I only know the drug's name" path.
 *
 * Everything here runs in the visitor's browser against PubChem's public PUG-REST service, which
 * sends `Access-Control-Allow-Origin: *`. No key, no server, nothing proxied.
 *
 * A deliberate design note on robustness: PubChem has renamed its SMILES *properties* over time
 * (`CanonicalSMILES` → `ConnectivitySMILES`, `IsomericSMILES` → `SMILES`), and asking for a
 * property name the service no longer knows fails the whole request. So structure resolution never
 * goes through the property endpoint — it fetches the SDF record and parses it locally, which has
 * been stable for years. Property calls are used only for human-facing metadata (title, formula),
 * are limited to long-stable field names, and are allowed to fail without breaking a search.
 */
import { fromMolfile, toSmiles } from "./mol";

export const PUG_REST = "https://pubchem.ncbi.nlm.nih.gov/rest/pug";
const PUG = PUG_REST;
const AUTOCOMPLETE = "https://pubchem.ncbi.nlm.nih.gov/rest/autocomplete/compound";

/** PubChem asks for no more than 5 requests a second. Everything funnels through this queue. */
const MIN_GAP_MS = 220;
let lastCall = 0;

async function throttle(): Promise<void> {
  const wait = Math.max(0, lastCall + MIN_GAP_MS - Date.now());
  lastCall = Date.now() + wait;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

export class LookupError extends Error {
  constructor(
    message: string,
    readonly kind: "not-found" | "network" | "ambiguous" | "bad-input",
  ) {
    super(message);
  }
}

async function getJSON(url: string, signal?: AbortSignal): Promise<unknown> {
  await throttle();
  let res: Response;
  try {
    res = await fetch(url, { signal, headers: { Accept: "application/json" } });
  } catch (error) {
    if ((error as Error)?.name === "AbortError") throw error;
    throw new LookupError("Could not reach PubChem. Check your connection.", "network");
  }
  if (res.status === 404) throw new LookupError("No compound of that name in PubChem.", "not-found");
  if (!res.ok) throw new LookupError(`PubChem returned ${res.status}.`, "network");
  return res.json();
}

async function getText(url: string, signal?: AbortSignal): Promise<string> {
  await throttle();
  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch (error) {
    if ((error as Error)?.name === "AbortError") throw error;
    throw new LookupError("Could not reach PubChem. Check your connection.", "network");
  }
  if (res.status === 404) throw new LookupError("PubChem has no structure record for that entry.", "not-found");
  if (!res.ok) throw new LookupError(`PubChem returned ${res.status}.`, "network");
  return res.text();
}

/* ------------------------------------------------------------------ queries */

export interface Candidate {
  cid: number;
  title?: string;
  formula?: string;
  /** Filled in lazily — the structure is a second request per candidate. */
  smiles?: string;
}

export interface Resolved {
  cid: number;
  smiles: string;
  title: string;
  formula?: string;
  iupacName?: string;
  synonyms: string[];
}

const INCHIKEY = /^[A-Z]{14}-[A-Z]{10}-[A-Z]$/;
const CID_ONLY = /^(?:cid[:\s]*)?(\d{1,9})$/i;

/** What kind of thing did the user type? Lets one box accept a name, a CID or an InChIKey. */
export function classifyQuery(raw: string): { kind: "cid" | "inchikey" | "name"; value: string } {
  const q = raw.trim();
  const cid = q.match(CID_ONLY);
  if (cid) return { kind: "cid", value: cid[1] };
  if (INCHIKEY.test(q.toUpperCase())) return { kind: "inchikey", value: q.toUpperCase() };
  return { kind: "name", value: q };
}

/** Type-ahead suggestions. Returns [] rather than throwing — a failed hint must never block typing. */
export async function suggestNames(query: string, signal?: AbortSignal): Promise<string[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  try {
    const data = (await getJSON(`${AUTOCOMPLETE}/${encodeURIComponent(q)}/json?limit=10`, signal)) as {
      dictionary_terms?: { compound?: string[] };
    };
    return data?.dictionary_terms?.compound ?? [];
  } catch {
    return [];
  }
}

/** Resolve a query to the PubChem CIDs that match it, best match first. */
export async function findCids(raw: string, signal?: AbortSignal): Promise<number[]> {
  const { kind, value } = classifyQuery(raw);
  if (!value) throw new LookupError("Type a drug or compound name first.", "bad-input");

  if (kind === "cid") return [Number(value)];

  const path =
    kind === "inchikey"
      ? `${PUG}/compound/inchikey/${encodeURIComponent(value)}/cids/JSON`
      : `${PUG}/compound/name/${encodeURIComponent(value)}/cids/JSON?name_type=word`;

  const data = (await getJSON(path, signal)) as { IdentifierList?: { CID?: number[] } };
  const cids = data?.IdentifierList?.CID ?? [];
  if (!cids.length) throw new LookupError(`Nothing in PubChem matches “${value}”.`, "not-found");
  return cids;
}

/**
 * Titles and formulas for a batch of CIDs. Best-effort: if the property endpoint changes shape
 * again, searching still works, the candidates are just labelled by CID.
 */
export async function describeCids(cids: number[], signal?: AbortSignal): Promise<Candidate[]> {
  const list = cids.slice(0, 12);
  const fallback = list.map((cid) => ({ cid }));
  if (!list.length) return [];
  try {
    const data = (await getJSON(
      `${PUG}/compound/cid/${list.join(",")}/property/Title,MolecularFormula/JSON`,
      signal,
    )) as { PropertyTable?: { Properties?: { CID: number; Title?: string; MolecularFormula?: string }[] } };
    const rows = data?.PropertyTable?.Properties ?? [];
    if (!rows.length) return fallback;
    const byCid = new Map(rows.map((r) => [r.CID, r]));
    return list.map((cid) => ({
      cid,
      title: byCid.get(cid)?.Title,
      formula: byCid.get(cid)?.MolecularFormula,
    }));
  } catch (error) {
    if ((error as Error)?.name === "AbortError") throw error;
    return fallback;
  }
}

/**
 * The structure itself, from the 2D SDF record. Parsed locally, so what comes back is a SMILES in
 * exactly the form the rest of Nearspace expects.
 */
export async function structureForCid(cid: number, signal?: AbortSignal): Promise<string> {
  const sdf = await getText(`${PUG}/compound/cid/${cid}/record/SDF?record_type=2d`, signal);
  const record = sdf.split("$$$$")[0];
  try {
    const mol = fromMolfile(record);
    if (mol.getAllAtoms() < 2) throw new Error("too small");
    return toSmiles(mol);
  } catch {
    throw new LookupError("PubChem's record for that compound could not be read as a structure.", "not-found");
  }
}

/** Synonyms, for showing what else a compound is called. Never fatal. */
export async function synonymsForCid(cid: number, signal?: AbortSignal): Promise<string[]> {
  try {
    const data = (await getJSON(`${PUG}/compound/cid/${cid}/synonyms/JSON`, signal)) as {
      InformationList?: { Information?: { Synonym?: string[] }[] };
    };
    return (data?.InformationList?.Information?.[0]?.Synonym ?? []).slice(0, 8);
  } catch (error) {
    if ((error as Error)?.name === "AbortError") throw error;
    return [];
  }
}

/** IUPAC name. Separate and optional, because this is the field most exposed to renaming. */
export async function iupacNameForCid(cid: number, signal?: AbortSignal): Promise<string | undefined> {
  try {
    const data = (await getJSON(`${PUG}/compound/cid/${cid}/property/IUPACName/JSON`, signal)) as {
      PropertyTable?: { Properties?: { IUPACName?: string }[] };
    };
    return data?.PropertyTable?.Properties?.[0]?.IUPACName;
  } catch (error) {
    if ((error as Error)?.name === "AbortError") throw error;
    return undefined;
  }
}

/** Everything about one CID, for the moment a candidate is actually chosen. */
export async function resolveCid(cid: number, signal?: AbortSignal): Promise<Resolved> {
  const smiles = await structureForCid(cid, signal);
  const [described] = await describeCids([cid], signal);
  const [synonyms, iupacName] = await Promise.all([
    synonymsForCid(cid, signal),
    iupacNameForCid(cid, signal),
  ]);
  return {
    cid,
    smiles,
    title: described?.title || synonyms[0] || `CID ${cid}`,
    formula: described?.formula,
    iupacName,
    synonyms,
  };
}

/**
 * One-shot search: name in, structure out, plus the other candidates when the name is ambiguous.
 * A single unambiguous hit resolves straight through.
 */
export async function searchByName(
  raw: string,
  signal?: AbortSignal,
): Promise<{ resolved: Resolved; alternatives: Candidate[] }> {
  const cids = await findCids(raw, signal);
  const resolved = await resolveCid(cids[0], signal);
  const alternatives = cids.length > 1 ? await describeCids(cids.slice(0, 8), signal) : [];
  return { resolved, alternatives };
}
