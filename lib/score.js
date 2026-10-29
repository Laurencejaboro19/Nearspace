/**
 * The Nearspace ranking algorithm.
 *
 * The problem: Enamine's SmallWorld returns a graph *edit distance*, onepot
 * returns its own Tanimoto, and neither tells you whether a compound is worth
 * pursuing. Sorting on a vendor's own number gives a list that is neither
 * comparable across sources nor useful for triage.
 *
 * So we score every candidate ourselves, from three things we can compute
 * locally, and one we can only get after ADMET is fetched:
 *
 *   similarity  ECFP4 Tanimoto to the query. The main signal — this is a SAR
 *               tool, so structural relatedness dominates.
 *   sizeFit     Heavy-atom count closeness. A hit twice the size of your query
 *               may share a fingerprint but is a different chemical series.
 *   drugLike    Lipinski/Veber-style penalties from local RDKit descriptors.
 *   admet       Predicted liability penalties (hERG, Ames, DILI, absorption),
 *               folded in only once ADMETlab results exist.
 *
 * Every sub-score is 0–1, higher is better, and all of them are kept on the row
 * so the table can show you *why* something ranked where it did. Weights are
 * exported and adjustable — the point is that the ranking is auditable, not
 * that these particular numbers are correct for your project.
 */

export const WEIGHTS = {
  similarity: 0.60,
  sizeFit: 0.10,
  drugLike: 0.30,
  // Applied only when ADMET data is present; the three above are renormalised
  // to make room for it so scores stay on the same 0-1 scale.
  admet: 0.25,
};

const clamp01 = (x) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

/**
 * How close in size is this candidate to the query?
 *
 * Fingerprint similarity is surprisingly tolerant of large appendages, so a
 * 55-heavy-atom hit can score well against a 15-atom query. This term pulls
 * those down without excluding them.
 */
export function sizeFit(queryHeavy, candidateHeavy) {
  if (!queryHeavy || !candidateHeavy) return 0.5;
  const ratio = Math.min(queryHeavy, candidateHeavy) / Math.max(queryHeavy, candidateHeavy);
  return clamp01(ratio);
}

/**
 * Drug-likeness from local RDKit descriptors — no network, no API.
 *
 * Deliberately a soft score rather than a pass/fail filter: an early SAR hit
 * list is the wrong place to hard-exclude anything, but you do want the
 * reasonable compounds at the top.
 */
export function drugLike(desc) {
  if (!desc) return 0.5;

  const mw = desc.amw ?? desc.exactmw;
  const logp = desc.CrippenClogP;
  const tpsa = desc.tpsa;
  const hbd = desc.lipinskiHBD ?? desc.NumHBD;
  const hba = desc.lipinskiHBA ?? desc.NumHBA;
  const rotb = desc.NumRotatableBonds;

  // Lipinski's rule of five: each violation costs a quarter of the term.
  let violations = 0;
  if (mw > 500) violations += 1;
  if (logp > 5) violations += 1;
  if (hbd > 5) violations += 1;
  if (hba > 10) violations += 1;
  const lipinski = 1 - violations / 4;

  // Veber: oral bioavailability correlates with low flexibility and TPSA.
  let veber = 1;
  if (rotb > 10) veber -= 0.5;
  if (tpsa > 140) veber -= 0.5;

  // Very small fragments and very greasy or very polar compounds are poor
  // starting points even when they break no explicit rule.
  let sanity = 1;
  if (mw < 150) sanity -= 0.4;
  if (logp < -1) sanity -= 0.2;
  if (logp > 6) sanity -= 0.3;

  return clamp01(0.5 * lipinski + 0.3 * clamp01(veber) + 0.2 * clamp01(sanity));
}

/**
 * Read a possibly-string probability from ADMETlab into a number.
 *
 * Guards null, undefined and "" explicitly, because Number(null) and Number("")
 * are both 0 — which for a toxicity endpoint would read as "probability zero",
 * scoring a compound with NO prediction as perfectly safe and ranking it above
 * one that was actually predicted and came back clean. Missing must stay
 * missing.
 */
function prob(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Fold predicted ADMET liabilities into a 0–1 score.
 *
 * ADMETlab reports most toxicity endpoints as a probability of the *bad*
 * outcome, so those are inverted here. Anything missing is simply skipped
 * rather than assumed safe — a compound with no hERG prediction should not
 * outrank one that was measured and came back clean.
 */
export function admetScore(admet) {
  if (!admet || admet.error) return null;

  const terms = [];

  // Toxicity / liability: lower probability is better.
  for (const key of ["herg", "ames", "dili", "hepatotox", "carcinogen"]) {
    const p = prob(admet[key]);
    if (p != null && p >= 0 && p <= 1) terms.push(1 - p);
  }

  // Absorption: higher is better.
  const hia = prob(admet.hia);
  if (hia != null && hia >= 0 && hia <= 1) terms.push(hia);

  const f20 = prob(admet.f20);
  if (f20 != null && f20 >= 0 && f20 <= 1) terms.push(f20);

  // Caco-2 permeability is reported as log(cm/s); > -5.15 is their "good"
  // threshold. Map it onto 0-1 over a plausible window.
  const caco2 = prob(admet.caco2);
  if (caco2 != null && caco2 < 0) {
    terms.push(clamp01((caco2 + 6.5) / 1.5));
  }

  // CYP3A4 inhibition is a liability for drug-drug interactions.
  const cyp = prob(admet.cyp3a4inh);
  if (cyp != null && cyp >= 0 && cyp <= 1) terms.push(1 - cyp);

  if (!terms.length) return null;
  return clamp01(terms.reduce((a, b) => a + b, 0) / terms.length);
}

/**
 * Composite score for one row.
 *
 * Returns the total plus every component, so nothing about the ranking is
 * hidden from the person reading the table.
 */
export function scoreRow(row, { queryHeavy, admet } = {}) {
  const sim = clamp01(row.similarity ?? 0);
  const size = sizeFit(queryHeavy, row.descriptors?.NumHeavyAtoms);
  const drug = drugLike(row.descriptors);
  const adm = admetScore(admet);

  let total;
  const parts = { similarity: sim, sizeFit: size, drugLike: drug, admet: adm };

  if (adm == null) {
    total =
      WEIGHTS.similarity * sim +
      WEIGHTS.sizeFit * size +
      WEIGHTS.drugLike * drug;
  } else {
    // Make room for the ADMET term by shrinking the local terms proportionally,
    // so a scored-with-ADMET row is still on the same 0-1 scale as one without.
    const room = 1 - WEIGHTS.admet;
    const base = WEIGHTS.similarity + WEIGHTS.sizeFit + WEIGHTS.drugLike;
    total =
      room * ((WEIGHTS.similarity * sim + WEIGHTS.sizeFit * size + WEIGHTS.drugLike * drug) / base) +
      WEIGHTS.admet * adm;
  }

  return { score: clamp01(total), parts };
}

/** Score a whole list and sort it, best first. */
export function scoreAndSort(rows, { queryHeavy, admetBySmiles = {} } = {}) {
  const scored = rows.map((row) => {
    const { score, parts } = scoreRow(row, {
      queryHeavy,
      admet: admetBySmiles[row.smiles],
    });
    return { ...row, score, scoreParts: parts };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored;
}
