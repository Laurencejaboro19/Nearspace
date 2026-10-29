/**
 * Enamine REAL search, via the SmallWorld server at sw.docking.org.
 *
 * REAL Space is tens of billions of make-on-demand compounds, so the search is
 * delegated: SmallWorld (NextMove's engine, hosted at UCSF by John Irwin,
 * Brian Shoichet and colleagues) does the billion-scale neighbour lookup and we
 * only ever handle the few hundred hits it returns.
 *
 * That server is an academic community resource somebody else pays for. This
 * module therefore caches every query, pages politely, and never fans out. If
 * you deploy this publicly, set KV so the cache is shared — see lib/cache.js.
 *
 * The flow is two-stage and a little awkward:
 *   1. GET /search/submit  -> a server-sent-event stream ending in a hit-list id
 *   2. GET /search/view    -> paged JSON rows for that hit list
 */

import { cacheGet, cacheSet, sleep } from "./cache.js";

const BASE = "https://sw.docking.org";
const UA = "Nearspace/0.1 (academic; https://github.com/Laurencejaboro19/nearspace)";

/** Database names drift between REAL releases, so resolve at runtime. */
async function resolveDb() {
  const preferred = process.env.SMALLWORLD_DB?.trim();
  const cacheKey = "sw:dbs:v1";

  let names = await cacheGet(cacheKey);
  if (!names) {
    try {
      const res = await fetch(`${BASE}/search/maps`, {
        headers: { "User-Agent": UA },
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        names = Array.isArray(data) ? data.map(String) : Object.keys(data || {});
        await cacheSet(cacheKey, names, 60 * 60 * 24);
      }
    } catch {
      names = null;
    }
  }

  if (preferred && (!names || names.includes(preferred))) return preferred;
  if (!names?.length) return preferred || "REAL_Space";

  const real = names.filter((n) => n.toUpperCase().includes("REAL"));
  if (!real.length) return preferred || names[0];
  // longest name is usually the newest, biggest space
  return real.sort((a, b) => b.length - a.length)[0];
}

/** Read the SSE stream and pull out the hit-list id. */
async function submitSearch(smiles, db, dist, signal) {
  const params = new URLSearchParams({
    smi: smiles,
    db,
    dist: String(dist),
    topdist: String(dist),
    scores: "Atom Alignment",
    sdist: String(dist),
    tdn: "6", tup: "6", rdn: "6", rup: "6", ldn: "6", lup: "6",
    maj: "6", min: "6", sub: "6",
  });

  const res = await fetch(`${BASE}/search/submit?${params}`, {
    headers: { "User-Agent": UA, Accept: "text/event-stream" },
    cache: "no-store",
    signal,
  });
  if (!res.ok) throw new Error(`SmallWorld submit failed (HTTP ${res.status})`);
  if (!res.body) throw new Error("SmallWorld returned no stream");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let hlid = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        let payload;
        try {
          payload = JSON.parse(line.slice(5).trim());
        } catch {
          continue;
        }
        if (payload?.hlid != null) hlid = payload.hlid;
        const status = String(payload?.status || "").toUpperCase();
        if (["END", "DONE", "FINISHED"].includes(status) && hlid != null) {
          return hlid;
        }
      }
    }
  } finally {
    try { await reader.cancel(); } catch { /* already closed */ }
  }

  if (hlid == null) {
    throw new Error(
      "SmallWorld did not return a hit-list id. The server may be busy — " +
      "try a smaller distance, or search onepot only."
    );
  }
  return hlid;
}

/** Page the hit list. */
async function fetchHits(hlid, maxResults, signal) {
  const rows = [];
  let draw = 0;

  while (rows.length < maxResults) {
    draw += 1;
    const length = Math.min(100, maxResults - rows.length);
    const params = new URLSearchParams({
      hlid: String(hlid),
      draw: String(draw),
      start: String(rows.length),
      length: String(length),
      "order[0][column]": "0",
      "order[0][dir]": "asc",
    });

    const res = await fetch(`${BASE}/search/view?${params}`, {
      headers: { "User-Agent": UA },
      cache: "no-store",
      signal,
    });
    if (!res.ok) break;

    const payload = await res.json().catch(() => null);
    const batch = payload?.data;
    if (!Array.isArray(batch) || batch.length === 0) break;

    rows.push(...batch);
    if (batch.length < length) break;
    await sleep(400); // be a good citizen
  }

  return rows.slice(0, maxResults);
}

function normalise(rows, db) {
  const out = [];
  for (const row of rows) {
    const raw = row?.smiles ?? row?.smi;
    if (!raw) continue;
    // SmallWorld sometimes appends an id after whitespace
    const smiles = String(raw).trim().split(/\s+/)[0];
    if (!smiles) continue;

    const dist = Number(row?.dist);
    out.push({
      smiles,
      source: "enamine",
      catalogId: row?.id ?? row?.alias ?? null,
      vendorScore: Number.isFinite(dist) ? dist : null,
      vendorMetric: "graph edit distance",
      priceUsd: null,
      extra: { smallworldDb: db },
    });
  }
  return out;
}

/**
 * Neighbours of `smiles` in Enamine REAL.
 *
 * `dist` is graph edit distance, not Tanimoto: 4 is tight, 5 is a good default
 * for a web request, 8+ is slow enough to time out a serverless function.
 */
export async function searchEnamine(smiles, { dist = 5, maxResults = 300, timeoutMs = 45000 } = {}) {
  const db = await resolveDb();
  const cacheKey = `sw:hits:v1:${db}:${dist}:${maxResults}:${smiles}`;

  const cached = await cacheGet(cacheKey);
  if (cached) return { hits: cached, cached: true, db };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const hlid = await submitSearch(smiles, db, dist, controller.signal);
    const rows = await fetchHits(hlid, maxResults, controller.signal);
    const hits = normalise(rows, db);
    if (hits.length) await cacheSet(cacheKey, hits);
    return { hits, cached: false, db };
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error(
        `Enamine search timed out after ${Math.round(timeoutMs / 1000)}s. ` +
        "Lower the distance (try 4) or search onepot only."
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
