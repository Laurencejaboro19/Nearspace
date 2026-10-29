/**
 * Enamine REAL search, via the SmallWorld server at sw.docking.org.
 *
 * REAL Space is tens of billions of make-on-demand compounds, so the search is
 * delegated: SmallWorld (NextMove's engine, hosted at UCSF by John Irwin,
 * Brian Shoichet and colleagues) does the billion-scale neighbour lookup and we
 * only ever handle the few hundred hits it returns.
 *
 * That server is an academic community resource somebody else pays for. This
 * module caches every query and never fans out.
 *
 * API shape, per wiki.docking.org/index.php/How_to_use_SmallWorld_API:
 *
 *   GET /search/maps                      list the available databases
 *   GET /search/view?smi=...&db=...       run a search AND return its results
 *
 * There is NO separate submit endpoint and no hit-list round trip — calling
 * /search/view with `smi` and `db` starts the search, and with async omitted
 * (the default) it waits for the result and returns it in one response.
 * `fmt=tsv` gives tabular output; JSON is for async polling, which we avoid
 * because a serverless function cannot sit through a long poll anyway.
 */

import { cacheGet, cacheSet } from "./cache.js";

const BASE = "https://sw.docking.org";
const UA = "Nearspace/0.1 (academic; https://github.com/Laurencejaboro19/Nearspace)";

/**
 * Network failures surface from Node's fetch as a bare "fetch failed", which
 * tells you nothing. The useful detail hides in err.cause. Unwrap it so a DNS
 * failure, a refused connection, a TLS problem and a timeout are
 * distinguishable in the UI instead of all looking identical.
 */
export function describeFetchError(err) {
  const cause = err?.cause;
  const code = cause?.code || err?.code;
  const detail = cause?.message || err?.message || String(err);

  const known = {
    ENOTFOUND: "DNS lookup failed — the host could not be resolved",
    EAI_AGAIN: "DNS lookup timed out",
    ECONNREFUSED: "connection refused by the server",
    ECONNRESET: "connection reset by the server",
    ETIMEDOUT: "connection timed out",
    UND_ERR_CONNECT_TIMEOUT: "connection timed out while opening the socket",
    UND_ERR_HEADERS_TIMEOUT: "server accepted the connection but sent no response in time",
    UND_ERR_SOCKET: "socket closed unexpectedly",
    CERT_HAS_EXPIRED: "the server's TLS certificate has expired",
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: "the server's TLS certificate could not be verified",
    DEPTH_ZERO_SELF_SIGNED_CERT: "the server is using a self-signed TLS certificate",
  };

  const plain = known[code];
  if (plain) return `${plain} (${code})`;
  if (code) return `${detail} (${code})`;
  return detail;
}

async function getText(url, { timeoutMs = 50000, accept = "text/plain" } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: accept },
      cache: "no-store",
      signal: controller.signal,
      redirect: "follow",
    });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error(`SmallWorld did not respond within ${Math.round(timeoutMs / 1000)}s`);
    }
    throw new Error(`could not reach sw.docking.org: ${describeFetchError(err)}`);
  } finally {
    clearTimeout(timer);
  }
}

/** Database names the server currently offers. */
export async function listDatabases() {
  const cacheKey = "sw:dbs:v2";
  const cached = await cacheGet(cacheKey);
  if (cached) return cached;

  const { ok, status, body } = await getText(`${BASE}/search/maps`, {
    accept: "application/json",
  });
  if (!ok) throw new Error(`SmallWorld /search/maps returned HTTP ${status}`);

  let names;
  try {
    const data = JSON.parse(body);
    names = Array.isArray(data) ? data.map(String) : Object.keys(data || {});
  } catch {
    throw new Error("SmallWorld /search/maps did not return JSON");
  }

  if (names.length) await cacheSet(cacheKey, names, 60 * 60 * 24);
  return names;
}

/**
 * Pick a REAL database that exists on the server right now.
 *
 * Names drift between releases (REAL_Space, REAL_Space_21Q3_2B, ...), so match
 * loosely rather than hard-coding a name that will rot.
 */
export async function resolveDb() {
  const preferred = process.env.SMALLWORLD_DB?.trim();
  const names = await listDatabases();

  if (preferred) {
    if (names.includes(preferred)) return preferred;
    throw new Error(
      `SMALLWORLD_DB is set to "${preferred}", which the server does not offer. ` +
      `Available: ${names.slice(0, 8).join(", ")}${names.length > 8 ? "…" : ""}`
    );
  }

  const real = names.filter((n) => n.toUpperCase().includes("REAL"));
  if (!real.length) {
    throw new Error(
      `No Enamine REAL database found on the server. Available: ${names.slice(0, 8).join(", ")}`
    );
  }
  // longest name is usually the newest and largest space
  return real.sort((a, b) => b.length - a.length)[0];
}

/**
 * Parse the tabular response.
 *
 * Column names are not contractually fixed, so locate them by meaning rather
 * than position — a layout change should cost us a column, not every hit.
 */
function parseTable(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];

  const delimiter = lines[0].includes("\t") ? "\t" : ",";
  const split = (line) => line.split(delimiter).map((c) => c.trim().replace(/^"|"$/g, ""));

  const header = split(lines[0]).map((h) => h.toLowerCase());
  const findCol = (...needles) =>
    header.findIndex((h) => needles.some((n) => h.includes(n)));

  let smilesCol = findCol("smiles", "smi");
  const idCol = findCol("alias", "id", "code", "zinc");
  const distCol = findCol("dist");

  // No recognisable header? Fall back to treating every line as data — but
  // carefully. A server that returns an error page or a plain-text message
  // with HTTP 200 would otherwise be parsed into invented compounds, and a
  // fabricated hit is far worse than a missed one.
  const headerIsData = smilesCol === -1;
  const rows = [];

  for (const line of lines.slice(headerIsData ? 0 : 1)) {
    const cells = split(line);
    if (!cells.length) continue;

    let smiles;
    if (headerIsData) {
      smiles = cells[0]?.split(/\s+/)[0];
      // Only trust a headerless row if it is tabular, or the token actually
      // looks like a structure rather than a word of prose.
      const structural = /[0-9()=#@[\]]/.test(smiles || "");
      if (cells.length < 2 && !structural) continue;
    } else {
      smiles = cells[smilesCol]?.split(/\s+/)[0];
    }
    if (!smiles || smiles.length < 2) continue;
    // Reject anything containing characters SMILES never uses.
    if (!/^[A-Za-z0-9@+\-[\]()=#$:/\\%.*]+$/.test(smiles)) continue;

    const dist = distCol >= 0 ? Number(cells[distCol]) : NaN;
    rows.push({
      smiles,
      catalogId: idCol >= 0 ? cells[idCol] || null : null,
      vendorScore: Number.isFinite(dist) ? dist : null,
    });
  }
  return rows;
}

/**
 * Neighbours of `smiles` in Enamine REAL.
 *
 * `dist` is graph edit distance, not Tanimoto: 4 is tight, 5 is a sensible
 * default for a web request, and anything much looser risks outliving the
 * serverless function's time limit.
 */
export async function searchEnamine(smiles, { dist = 5, maxResults = 300, timeoutMs = 45000 } = {}) {
  const db = await resolveDb();
  const cacheKey = `sw:hits:v2:${db}:${dist}:${maxResults}:${smiles}`;

  const cached = await cacheGet(cacheKey);
  if (cached) return { hits: cached, cached: true, db };

  const params = new URLSearchParams({
    smi: smiles,
    db,
    fmt: "tsv",
    start: "0",
    length: String(maxResults),
    // `top` caps the work the server does before ranking, which keeps us well
    // inside the function timeout and is kinder to a shared machine.
    top: String(Math.min(maxResults * 2, 1000)),
    dist: String(dist),
    sdist: String(dist),
  });

  const url = `${BASE}/search/view?${params}`;
  const { ok, status, body } = await getText(url, { timeoutMs });

  if (!ok) {
    throw new Error(
      `SmallWorld returned HTTP ${status}${body ? `: ${body.slice(0, 160)}` : ""}`
    );
  }

  const hits = parseTable(body).map((row) => ({
    smiles: row.smiles,
    source: "enamine",
    catalogId: row.catalogId,
    vendorScore: row.vendorScore,
    vendorMetric: "graph edit distance",
    priceUsd: null,
    extra: { smallworldDb: db },
  }));

  if (hits.length) await cacheSet(cacheKey, hits);
  return { hits, cached: false, db };
}
