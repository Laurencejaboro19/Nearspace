/**
 * onepot CORE search.
 *
 * Official API at api.onepot.ai: Tanimoto similarity and SMILES/SMARTS
 * substructure search over the CORE space, with pricing, a chemistry risk
 * score, and a real ordering endpoint.
 *
 * Needs ONEPOT_API_KEY. Without it this module reports itself unavailable and
 * Nearspace searches Enamine only — the app stays useful either way.
 *
 * The response shape has moved between client versions, so parsing here is
 * deliberately tolerant rather than assuming one layout.
 */

import { cacheGet, cacheSet } from "./cache.js";

const BASE = "https://api.onepot.ai/v1";
const UA = "Nearspace/0.1 (https://github.com/Laurencejaboro19/nearspace)";

export const hasOnepotKey = () => Boolean(process.env.ONEPOT_API_KEY);

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Walk whatever container the API used and yield flat result objects. */
function* iterRows(payload) {
  if (Array.isArray(payload)) {
    for (const row of payload) if (row && typeof row === "object") yield row;
    return;
  }
  if (!payload || typeof payload !== "object") return;

  for (const field of ["results", "data", "analogs", "matches"]) {
    const block = payload[field];
    if (!Array.isArray(block)) continue;
    for (const item of block) {
      if (!item || typeof item !== "object") continue;
      const nested = item.results || item.analogs;
      if (Array.isArray(nested)) {
        for (const row of nested) if (row && typeof row === "object") yield row;
      } else {
        yield item;
      }
    }
    return;
  }
}

export async function searchOnepot(smiles, { maxResults = 300, includeRisk = true } = {}) {
  const key = process.env.ONEPOT_API_KEY;
  if (!key) {
    return { hits: [], unavailable: "no ONEPOT_API_KEY set", cached: false };
  }

  const cacheKey = `onepot:hits:v1:${maxResults}:${smiles}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return { hits: cached, cached: true };

  const body = { smiles_list: [smiles], max_results: maxResults };
  if (includeRisk) body.include_chemistry_risk_score = true;

  const res = await fetch(`${BASE}/search`, {
    method: "POST",
    headers: {
      "X-API-Key": key,
      "Content-Type": "application/json",
      "User-Agent": UA,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (res.status === 401 || res.status === 403) {
    throw new Error("onepot rejected the API key.");
  }
  if (!res.ok) {
    throw new Error(`onepot search failed (HTTP ${res.status}).`);
  }

  const payload = await res.json();
  const hits = [];
  for (const row of iterRows(payload)) {
    const smi = row.smiles ?? row.smi;
    if (!smi) continue;
    hits.push({
      smiles: String(smi),
      source: "onepot",
      catalogId: row.id ?? row.compound_id ?? null,
      vendorScore: num(row.similarity ?? row.tanimoto),
      vendorMetric: "tanimoto",
      priceUsd: num(row.price ?? row.price_usd),
      extra: {
        riskScore: row.chemistry_risk_score ?? row.risk ?? null,
        tier: row.tier ?? null,
      },
    });
  }

  if (hits.length) await cacheSet(cacheKey, hits);
  return { hits, cached: false };
}

/** Place a synthesis order. Real money — the caller must confirm first. */
export async function orderOnepot(smilesList, email, notes = "") {
  const key = process.env.ONEPOT_API_KEY;
  if (!key) throw new Error("No ONEPOT_API_KEY set.");

  const res = await fetch(`${BASE}/order`, {
    method: "POST",
    headers: {
      "X-API-Key": key,
      "Content-Type": "application/json",
      "User-Agent": UA,
    },
    body: JSON.stringify({ smiles: smilesList, email, notes }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`onepot order failed (HTTP ${res.status}).`);
  return res.json();
}
