/**
 * Client-side chemistry, via RDKit's MinimalLib compiled to WebAssembly.
 *
 * Running this in the browser rather than on the server is what keeps Nearspace
 * free to host: RDKit through Python would need a container, torch-class
 * dependencies blow past the serverless size limit, and every search would cost
 * compute. Here the user's own browser does it, instantly, at zero cost.
 *
 * Jobs:
 *   - SDF -> SMILES, so a user can upload a structure file
 *   - ECFP4 fingerprints, so Enamine's edit distance and onepot's Tanimoto can
 *     be re-scored onto ONE comparable metric
 *   - InChIKey, to collapse the same compound offered by both vendors
 *   - structure drawings
 *
 * If the WASM fails to load (old browser, blocked CDN), callers fall back to
 * vendor ordering and the UI says so rather than pretending.
 */

const RDKIT_VERSION = "2026.9.1";
const RDKIT_URL = `https://unpkg.com/@rdkit/rdkit@${RDKIT_VERSION}/dist/RDKit_minimal.js`;

let rdkitPromise = null;

export function loadRDKit() {
  if (rdkitPromise) return rdkitPromise;

  rdkitPromise = new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("RDKit only loads in the browser."));
      return;
    }
    if (window.RDKit) {
      resolve(window.RDKit);
      return;
    }

    const script = document.createElement("script");
    script.src = RDKIT_URL;
    script.async = true;
    script.onload = () => {
      if (!window.initRDKitModule) {
        reject(new Error("RDKit loaded but initRDKitModule is missing."));
        return;
      }
      window
        .initRDKitModule()
        .then((instance) => {
          window.RDKit = instance;
          resolve(instance);
        })
        .catch(reject);
    };
    script.onerror = () => reject(new Error("Could not fetch RDKit from the CDN."));
    document.head.appendChild(script);
  });

  return rdkitPromise;
}

/** Run `fn` with a molecule and always free the WASM object afterwards. */
function withMol(RDKit, input, fn) {
  let mol = null;
  try {
    mol = RDKit.get_mol(input);
    if (!mol || !mol.is_valid()) return null;
    return fn(mol);
  } catch {
    return null;
  } finally {
    if (mol) mol.delete();
  }
}

export function canonical(RDKit, smiles) {
  return withMol(RDKit, smiles, (mol) => mol.get_smiles());
}

/**
 * InChIKey, which is how we recognise that Enamine and onepot are offering the
 * same compound written two different ways.
 *
 * Note the split API: get_inchi() is a method on the molecule, but turning an
 * InChI into a key is a module-level function.
 */
export function inchiKey(RDKit, smiles) {
  return withMol(RDKit, smiles, (mol) => {
    try {
      const inchi = mol.get_inchi();
      if (!inchi) return null;
      const key = RDKit.get_inchikey_for_inchi(inchi);
      return key || null;
    } catch {
      return null;
    }
  });
}

export function svg(RDKit, smiles, width = 180, height = 120) {
  return withMol(RDKit, smiles, (mol) =>
    mol.get_svg_with_highlights(
      JSON.stringify({ width, height, bondLineWidth: 1, addStereoAnnotation: false })
    )
  );
}

/** ECFP4 as a Uint8Array of set-bit flags, plus its popcount. */
export function fingerprint(RDKit, smiles) {
  return withMol(RDKit, smiles, (mol) => {
    const raw = mol.get_morgan_fp(JSON.stringify({ radius: 2, nBits: 2048 }));
    if (typeof raw !== "string") return null;
    const bits = new Uint8Array(raw.length);
    let count = 0;
    for (let i = 0; i < raw.length; i += 1) {
      if (raw.charCodeAt(i) === 49) {
        bits[i] = 1;
        count += 1;
      }
    }
    return { bits, count };
  });
}

/**
 * All 43 RDKit descriptors for a structure, computed locally.
 *
 * This is why the results table is populated the instant a search returns:
 * molecular weight, cLogP, TPSA, H-bond counts, ring counts and the rest need
 * no network call at all. ADMETlab is then only needed for the predicted
 * pharmacokinetics and toxicity, which is the part a descriptor cannot give you.
 */
export function descriptors(RDKit, smiles) {
  return withMol(RDKit, smiles, (mol) => {
    try {
      return JSON.parse(mol.get_descriptors());
    } catch {
      return null;
    }
  });
}

export function tanimoto(a, b) {
  if (!a || !b) return null;
  let shared = 0;
  const len = Math.min(a.bits.length, b.bits.length);
  for (let i = 0; i < len; i += 1) {
    if (a.bits[i] && b.bits[i]) shared += 1;
  }
  const union = a.count + b.count - shared;
  return union === 0 ? 0 : shared / union;
}

/**
 * The popcount bound. Tanimoto(a,b) <= min(|a|,|b|) / max(|a|,|b|), so a
 * candidate whose bit count is too far from the query's cannot clear the
 * threshold and never needs comparing. Cheap integer test instead of a loop
 * over 2048 bits — this is what makes a local index over millions of cached
 * compounds practical later.
 */
export function couldClear(queryFp, candidateFp, threshold) {
  if (!threshold || threshold <= 0) return true;
  if (!queryFp || !candidateFp) return false;
  const n = candidateFp.count;
  return n >= queryFp.count * threshold && n <= queryFp.count / threshold;
}

/**
 * Pull every molecule out of an SDF and return their SMILES.
 *
 * Done line by line rather than by splitting on the "$$$$" delimiter: a naive
 * split leaves a leading newline on every record after the first, which shifts
 * the three mandatory molblock header lines and makes RDKit reject them. An SDF
 * is a line-oriented format, so parse it as one.
 */
export function sdfToSmiles(RDKit, text, limit = 50) {
  const lines = String(text).replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let block = [];

  for (const line of lines) {
    if (line.trim() === "$$$$") {
      if (block.length) {
        const smi = withMol(RDKit, block.join("\n"), (mol) => mol.get_smiles());
        if (smi) out.push(smi);
      }
      block = [];
      if (out.length >= limit) return out;
      continue;
    }
    block.push(line);
  }

  // a trailing record with no closing delimiter is still a molecule
  if (block.join("").trim() && out.length < limit) {
    const smi = withMol(RDKit, block.join("\n"), (mol) => mol.get_smiles());
    if (smi) out.push(smi);
  }

  return out;
}

/**
 * Dedupe across vendors, then score everything against the query on one metric
 * and cut to `top`.
 *
 * Vendor scores are not comparable — SmallWorld returns graph edit distance,
 * onepot returns its own Tanimoto — so a merged ranking only means something if
 * we recompute it ourselves.
 */
export function rankHits(RDKit, query, hits, { top = 100, threshold = 0 } = {}) {
  const queryFp = fingerprint(RDKit, query);
  if (!queryFp) throw new Error("Could not parse the query structure.");

  const best = new Map();
  for (const hit of hits) {
    const can = canonical(RDKit, hit.smiles);
    if (!can) continue;
    const key = inchiKey(RDKit, can) || can;
    const current = best.get(key);

    if (!current) {
      best.set(key, { ...hit, smiles: can, inchiKey: key, alsoIn: [] });
      continue;
    }

    // prefer the entry that carries a price, then the cheaper one
    const preferNew =
      (current.priceUsd == null && hit.priceUsd != null) ||
      (current.priceUsd != null && hit.priceUsd != null && hit.priceUsd < current.priceUsd);
    const winner = preferNew ? { ...hit, smiles: can, inchiKey: key, alsoIn: current.alsoIn } : current;
    const loser = preferNew ? current : hit;

    if (loser.source !== winner.source) {
      winner.alsoIn = Array.from(new Set([...(winner.alsoIn || []), loser.source]));
      if (loser.catalogId) {
        winner.extra = { ...(winner.extra || {}), [`${loser.source}Id`]: loser.catalogId };
      }
    }
    best.set(key, winner);
  }

  const scored = [];
  for (const hit of best.values()) {
    const fp = fingerprint(RDKit, hit.smiles);
    if (!couldClear(queryFp, fp, threshold)) continue;
    const sim = tanimoto(queryFp, fp);
    if (sim == null || sim < threshold) continue;
    // Descriptors come along for the ride: the scoring algorithm needs them and
    // they cost nothing once the molecule is already parsed.
    scored.push({ ...hit, similarity: sim, descriptors: descriptors(RDKit, hit.smiles) });
  }

  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, top);
}
