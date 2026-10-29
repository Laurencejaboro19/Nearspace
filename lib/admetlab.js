/**
 * ADMETlab 3.0 (admetlab3.scbdd.com) — free, no registration, 119 ADMET-related
 * properties per molecule: 21 physicochemical, 20 medicinal chemistry,
 * 9 absorption, 9 distribution, 14 metabolism, 2 excretion, 36 toxicity and
 * 8 toxicophore rules, of which 77 are trained models.
 *
 * Endpoints (all POST, all JSON):
 *   /api/washmol        standardise a SMILES
 *   /api/molsvg         structure drawing
 *   /api/single/admet   predict — ONE molecule per request
 *   /api/admetCSV       fetch a result CSV by taskId
 *
 * Two things dictate the design:
 *   1. Prediction is one molecule per call, so 100 compounds is 100 requests.
 *   2. The authors ask for no more than 5 requests per second, and say the web
 *      interface takes precedence over API traffic. So we throttle hard and
 *      accept that 100 compounds takes ~20s of wall clock.
 *
 * Their field names are not formally documented, so extraction below is
 * tolerant: we look for several plausible keys per property and return the raw
 * record alongside, so nothing is silently lost.
 */

import { sleep } from "./cache.js";

const BASE = "https://admetlab3.scbdd.com";
const UA = "Nearspace/0.1 (academic; https://github.com/Laurencejaboro19/nearspace)";

/** Their guidance is <=5 req/s. 220ms spacing keeps us under it with headroom. */
const MIN_SPACING_MS = 220;

function pick(record, candidates) {
  for (const key of candidates) {
    if (record[key] !== undefined && record[key] !== null && record[key] !== "") {
      return record[key];
    }
  }
  // case-insensitive second pass
  const lower = Object.fromEntries(
    Object.entries(record).map(([k, v]) => [k.toLowerCase(), v])
  );
  for (const key of candidates) {
    const v = lower[key.toLowerCase()];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
}

/** Flatten whatever envelope the API used down to one record per molecule. */
function firstRecord(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (Array.isArray(payload)) return payload.find((r) => r && typeof r === "object") || null;

  for (const field of ["data", "result", "results", "batches", "prediction", "predictions"]) {
    const block = payload[field];
    if (!block) continue;
    if (Array.isArray(block)) {
      const row = block.find((r) => r && typeof r === "object");
      if (row) return firstRecord(row) || row;
    } else if (typeof block === "object") {
      return firstRecord(block) || block;
    }
  }
  // already flat?
  return Object.keys(payload).length ? payload : null;
}

const FIELD_MAP = {
  mw: ["MW", "mw", "MolWt", "molecular_weight"],
  logp: ["logP", "LogP", "logp", "MolLogP"],
  tpsa: ["TPSA", "tpsa"],
  hbd: ["nHD", "HBD", "nHBD", "NumHDonors"],
  hba: ["nHA", "HBA", "nHBA", "NumHAcceptors"],
  rotbonds: ["nRot", "nRotB", "RotBonds", "NumRotatableBonds"],
  qed: ["QED", "qed"],
  synth: ["Synth", "SAscore", "synth"],
  lipinski: ["Lipinski", "LipinskiRule", "RuleOfFive"],
  pains: ["PAINS", "Pains"],
  caco2: ["Caco-2", "caco2", "Caco2"],
  hia: ["HIA", "hia"],
  f20: ["F(20%)", "F20", "f20"],
  bbb: ["BBB", "bbb"],
  ppb: ["PPB", "ppb"],
  cyp3a4inh: ["CYP3A4-inh", "CYP3A4_inhibition", "CYP3A4inh"],
  cyp2d6inh: ["CYP2D6-inh", "CYP2D6_inhibition", "CYP2D6inh"],
  halflife: ["T12", "t1/2", "half_life"],
  clearance: ["CL", "cl", "clearance"],
  herg: ["hERG", "herg"],
  ames: ["Ames", "AMES", "ames"],
  dili: ["DILI", "dili"],
  hepatotox: ["H-HT", "HHT", "hepatotoxicity"],
  carcinogen: ["Carcinogenicity", "carcinogen"],
};

function extract(record) {
  if (!record) return null;
  const out = { raw: record };
  for (const [name, keys] of Object.entries(FIELD_MAP)) {
    out[name] = pick(record, keys);
  }
  return out;
}

async function postJson(path, body, { timeoutMs = 25000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": UA,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });
    if (res.status === 429 || res.status === 503) {
      const retry = Number(res.headers.get("Retry-After")) || 5;
      const err = new Error("ADMETlab is rate limiting or busy.");
      err.retryAfter = retry;
      err.transient = true;
      throw err;
    }
    if (!res.ok) throw new Error(`ADMETlab HTTP ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Standardise a SMILES through their Molecule Wash (fragments, charges,
 * tautomers, isotopes, stereochemistry).
 *
 * Never throws: standardisation is a nice-to-have, so any failure returns the
 * input unchanged rather than taking down the caller. Nearspace canonicalises
 * in the browser with RDKit anyway, so this is only worth calling when you
 * specifically want ADMETlab's own normalisation.
 */
export async function washMolecule(smiles) {
  try {
    const payload = await postJson("/api/washmol", { SMILES: smiles });
    const record = firstRecord(payload);
    const washed = record
      ? pick(record, ["SMILES", "smiles", "washed", "canonical_smiles"])
      : null;
    return typeof washed === "string" && washed ? washed : smiles;
  } catch {
    return smiles;
  }
}

/** Predict one molecule. Returns null on a per-molecule failure, never throws. */
export async function predictOne(smiles, { feature = false } = {}) {
  try {
    const payload = await postJson("/api/single/admet", { SMILES: smiles, feature });
    const extracted = extract(firstRecord(payload));
    if (!extracted) return { smiles, error: "no data returned" };
    return { smiles, ...extracted };
  } catch (err) {
    return {
      smiles,
      error: String(err.message || err),
      transient: Boolean(err.transient),
    };
  }
}

/**
 * Predict a batch, throttled.
 *
 * Deliberately sequential. Their server asks for <=5 req/s across all clients,
 * and parallelising from a serverless function is the fastest way to get an IP
 * blocked and ruin a free resource for everyone.
 */
export async function predictBatch(smilesList, { onProgress } = {}) {
  const results = [];
  for (let i = 0; i < smilesList.length; i += 1) {
    const started = Date.now();
    const result = await predictOne(smilesList[i]);
    results.push(result);
    if (onProgress) onProgress(i + 1, smilesList.length);

    if (result.transient) await sleep(2000);
    const elapsed = Date.now() - started;
    if (elapsed < MIN_SPACING_MS && i < smilesList.length - 1) {
      await sleep(MIN_SPACING_MS - elapsed);
    }
  }
  return results;
}
