"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  canonical,
  descriptors,
  loadRDKit,
  rankHits,
  sdfToSmiles,
  svg,
} from "../lib/chem.js";
import { WEIGHTS, scoreAndSort } from "../lib/score.js";

const ADMET_CHUNK = 20;

// Computed in the browser from RDKit, so these appear the moment a search
// returns — no network call, no waiting.
const LOCAL_COLUMNS = [
  { key: "amw", label: "MW", digits: 1 },
  { key: "CrippenClogP", label: "cLogP", digits: 2 },
  { key: "tpsa", label: "TPSA", digits: 1 },
  { key: "lipinskiHBD", label: "HBD", digits: 0 },
  { key: "lipinskiHBA", label: "HBA", digits: 0 },
  { key: "NumRotatableBonds", label: "RotB", digits: 0 },
  { key: "NumHeavyAtoms", label: "Heavy", digits: 0 },
];

// Fetched from ADMETlab 3.0 on demand.
const ADMET_COLUMNS = [
  { key: "caco2", label: "Caco-2" },
  { key: "hia", label: "HIA" },
  { key: "bbb", label: "BBB" },
  { key: "ppb", label: "PPB" },
  { key: "cyp3a4inh", label: "CYP3A4" },
  { key: "herg", label: "hERG" },
  { key: "ames", label: "Ames" },
  { key: "dili", label: "DILI" },
];

function fmt(value, digits = 2) {
  if (value == null || value === "") return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return n.toFixed(digits);
}

/** Red for a high predicted liability, green for a low one. */
function riskClass(key, value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  const liabilities = ["herg", "ames", "dili", "cyp3a4inh"];
  if (liabilities.includes(key)) {
    if (n >= 0.7) return "bad";
    if (n <= 0.3) return "good";
  }
  if (key === "hia" && n >= 0.7) return "good";
  return "";
}

export default function Page() {
  const [rdkit, setRdkit] = useState(null);
  const [rdkitError, setRdkitError] = useState(null);

  const [smiles, setSmiles] = useState("CC(=O)Oc1ccccc1C(=O)O");
  const [useEnamine, setUseEnamine] = useState(true);
  const [useOnepot, setUseOnepot] = useState(false);
  const [dist, setDist] = useState(5);
  const [top, setTop] = useState(100);
  const [sortBy, setSortBy] = useState("score");

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [rows, setRows] = useState([]);
  const [queryHeavy, setQueryHeavy] = useState(null);
  const [admet, setAdmet] = useState({});
  const [admetBusy, setAdmetBusy] = useState(false);

  const fileRef = useRef(null);

  useEffect(() => {
    loadRDKit()
      .then(setRdkit)
      .catch((err) => setRdkitError(String(err.message || err)));
  }, []);

  const handleSdf = useCallback(
    async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      if (!rdkit) {
        setError("Structure parsing is still loading — try again in a moment.");
        return;
      }
      const text = await file.text();
      const found = sdfToSmiles(rdkit, text, 10);
      if (!found.length) {
        setError("No readable structures in that file.");
        return;
      }
      setSmiles(found[0]);
      setError(null);
      setStatus(
        found.length > 1
          ? `Loaded the first of ${found.length} structures from ${file.name}.`
          : `Loaded ${file.name}.`
      );
      if (fileRef.current) fileRef.current.value = "";
    },
    [rdkit]
  );

  const run = useCallback(async () => {
    const query = smiles.trim();
    if (!query) {
      setError("Enter a SMILES, or upload an SDF.");
      return;
    }
    if (!useEnamine && !useOnepot) {
      setError("Pick at least one library to search.");
      return;
    }
    if (rdkit && !canonical(rdkit, query)) {
      setError("That structure could not be parsed. Check the SMILES.");
      return;
    }

    setBusy(true);
    setError(null);
    setWarnings([]);
    setRows([]);
    setAdmet({});
    setStatus("Searching…");

    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          smiles: query,
          enamine: useEnamine,
          onepot: useOnepot,
          dist: Number(dist),
          perSource: 300,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Search failed (${res.status}).`);

      const notes = [];
      for (const [name, info] of Object.entries(data.sources || {})) {
        if (info.error) notes.push(`${name}: ${info.error}`);
        else if (info.unavailable) notes.push(`${name}: ${info.unavailable}`);
      }

      if (!data.hits?.length) {
        setWarnings(notes);
        setStatus("");
        setError("No hits returned. Try a looser edit distance, or another structure.");
        return;
      }

      setStatus(`${data.hits.length} raw hits — deduplicating, scoring and ranking…`);

      let ranked;
      let heavy = null;
      if (rdkit) {
        const qd = descriptors(rdkit, query);
        heavy = qd?.NumHeavyAtoms ?? null;
        const deduped = rankHits(rdkit, query, data.hits, { top: Number(top) });
        ranked = scoreAndSort(deduped, { queryHeavy: heavy });
      } else {
        notes.push(
          "Structure engine unavailable, so hits are in vendor order: not deduplicated, scored or drawn."
        );
        ranked = data.hits.slice(0, Number(top)).map((h) => ({ ...h, similarity: null, score: null }));
      }

      setQueryHeavy(heavy);
      setWarnings(notes);
      setRows(ranked);
      setStatus(
        `${ranked.length} unique compounds, scored on structure and local properties. ` +
        `Fetch ADMET to fold in predicted liabilities.`
      );
    } catch (err) {
      setStatus("");
      setError(String(err.message || err));
    } finally {
      setBusy(false);
    }
  }, [smiles, useEnamine, useOnepot, dist, top, rdkit]);

  const fetchAdmet = useCallback(async () => {
    if (!rows.length) return;
    setAdmetBusy(true);
    setError(null);

    const list = rows.map((r) => r.smiles);
    const collected = { ...admet };

    try {
      for (let i = 0; i < list.length; i += ADMET_CHUNK) {
        const chunk = list.slice(i, i + ADMET_CHUNK);
        setStatus(
          `ADMETlab 3.0: ${Math.min(i + chunk.length, list.length)} of ${list.length}…`
        );

        const res = await fetch("/api/admet", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ smiles: chunk }),
        });

        if (res.status === 429) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data?.error || "Rate limited — wait a moment and resume.");
        }
        if (!res.ok) throw new Error(`ADMET request failed (${res.status}).`);

        const data = await res.json();
        for (const row of data.results || []) collected[row.smiles] = row;
        setAdmet({ ...collected });
      }

      const failed = Object.values(collected).filter((r) => r.error).length;
      setStatus(
        failed
          ? `ADMET done — ${failed} compound(s) failed and are scored without it.`
          : "ADMET done. Scores now include predicted liabilities."
      );
    } catch (err) {
      setError(String(err.message || err));
      setStatus("ADMET stopped early. Partial results are shown and scored.");
    } finally {
      setAdmetBusy(false);
    }
  }, [rows, admet]);

  // Re-score whenever ADMET data arrives, then sort by the chosen key.
  const display = useMemo(() => {
    if (!rows.length) return [];
    let out = rows;
    if (rdkit && Object.keys(admet).length) {
      out = scoreAndSort(rows, { queryHeavy, admetBySmiles: admet });
    }
    const sorted = [...out];
    if (sortBy === "similarity") {
      sorted.sort((a, b) => (b.similarity ?? -1) - (a.similarity ?? -1));
    } else if (sortBy === "mw") {
      sorted.sort((a, b) => (a.descriptors?.amw ?? 1e9) - (b.descriptors?.amw ?? 1e9));
    } else {
      sorted.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    }
    return sorted;
  }, [rows, admet, rdkit, queryHeavy, sortBy]);

  const drawings = useMemo(() => {
    if (!rdkit || !display.length) return {};
    const out = {};
    for (const row of display.slice(0, 120)) {
      out[row.smiles] = svg(rdkit, row.smiles, 110, 72);
    }
    return out;
  }, [rdkit, display]);

  const downloadCsv = useCallback(() => {
    const headers = [
      "rank", "smiles", "score", "similarity", "size_fit", "drug_like", "admet_score",
      "source", "also_in", "catalog_id", "price_usd", "vendor_score", "vendor_metric",
      ...LOCAL_COLUMNS.map((c) => c.key),
      ...ADMET_COLUMNS.map((c) => `admet_${c.key}`),
    ];
    const lines = [headers.join(",")];

    display.forEach((row, i) => {
      const a = admet[row.smiles] || {};
      const p = row.scoreParts || {};
      const d = row.descriptors || {};
      const values = [
        i + 1,
        row.smiles,
        row.score == null ? "" : row.score.toFixed(4),
        row.similarity == null ? "" : row.similarity.toFixed(4),
        p.sizeFit == null ? "" : p.sizeFit.toFixed(4),
        p.drugLike == null ? "" : p.drugLike.toFixed(4),
        p.admet == null ? "" : p.admet.toFixed(4),
        row.source,
        (row.alsoIn || []).join("|"),
        row.catalogId ?? "",
        row.priceUsd ?? "",
        row.vendorScore ?? "",
        row.vendorMetric ?? "",
        ...LOCAL_COLUMNS.map((c) => (d[c.key] == null ? "" : d[c.key])),
        ...ADMET_COLUMNS.map((c) => a[c.key] ?? ""),
      ];
      lines.push(
        values
          .map((v) => {
            const s = String(v);
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
          })
          .join(",")
      );
    });

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "nearspace_results.csv";
    link.click();
    URL.revokeObjectURL(url);
  }, [display, admet]);

  const downloadSmiles = useCallback(() => {
    const text = display.map((r) => `${r.smiles}\t${r.catalogId ?? ""}`).join("\n");
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "nearspace_hits.smi";
    link.click();
    URL.revokeObjectURL(url);
  }, [display]);

  const hasAdmet = Object.keys(admet).length > 0;

  return (
    <div className="wrap">
      <header className="site">
        <h1>Nearspace</h1>
        <span className="tag">synthesizable neighbours, scored</span>
      </header>
      <p className="lede">
        Put in a structure. Nearspace asks Enamine REAL which nearby compounds it
        can actually make, collapses duplicates, scores every hit on structural
        similarity, size fit and drug-likeness, and will fold in predicted ADMET
        liabilities on request. The billion-scale search happens at the vendor;
        the chemistry happens in your browser.
      </p>

      {rdkitError && (
        <div className="notice bad">
          Structure engine failed to load ({rdkitError}). Search still works, but
          nothing can be deduplicated, scored or drawn, and SDF upload is off.
        </div>
      )}
      {warnings.map((w) => (
        <div className="notice" key={w}>{w}</div>
      ))}
      {error && <div className="notice bad">{error}</div>}

      <div className="panel">
        <label className="field" htmlFor="smiles">Query structure (SMILES)</label>
        <textarea
          id="smiles"
          value={smiles}
          onChange={(e) => setSmiles(e.target.value)}
          spellCheck={false}
          placeholder="CC(=O)Oc1ccccc1C(=O)O"
        />

        <div className="row">
          <div>
            <label className="field" htmlFor="sdf">…or upload SDF / MOL</label>
            <input
              id="sdf"
              ref={fileRef}
              type="file"
              accept=".sdf,.mol,.txt"
              onChange={handleSdf}
              disabled={!rdkit}
              style={{ fontFamily: "inherit", fontSize: 13 }}
            />
          </div>
          <div>
            <label className="field" htmlFor="dist">Edit distance</label>
            <select id="dist" value={dist} onChange={(e) => setDist(e.target.value)}>
              <option value={3}>3 — very tight</option>
              <option value={4}>4 — tight</option>
              <option value={5}>5 — balanced</option>
              <option value={6}>6 — loose, slower</option>
            </select>
          </div>
          <div>
            <label className="field" htmlFor="top">Keep top</label>
            <input
              id="top"
              type="number"
              min={10}
              max={300}
              value={top}
              onChange={(e) => setTop(e.target.value)}
            />
          </div>
          <div>
            <label className="field" htmlFor="sort">Sort by</label>
            <select id="sort" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="score">Nearspace score</option>
              <option value="similarity">Similarity only</option>
              <option value="mw">Molecular weight</option>
            </select>
          </div>
        </div>

        <div className="checks">
          <label>
            <input
              type="checkbox"
              checked={useEnamine}
              onChange={(e) => setUseEnamine(e.target.checked)}
            />
            Enamine REAL
          </label>
          <label title="Needs ONEPOT_API_KEY set on the server">
            <input
              type="checkbox"
              checked={useOnepot}
              onChange={(e) => setUseOnepot(e.target.checked)}
            />
            onepot CORE <span className="pill">needs API key</span>
          </label>
        </div>

        <div className="actions">
          <button className="primary" onClick={run} disabled={busy || admetBusy}>
            {busy ? "Searching…" : "Search"}
          </button>
          <button
            className="ghost"
            onClick={fetchAdmet}
            disabled={!rows.length || busy || admetBusy}
          >
            {admetBusy ? "Fetching ADMET…" : `Get ADMET (${rows.length})`}
          </button>
          <button className="ghost" onClick={downloadCsv} disabled={!display.length}>
            CSV
          </button>
          <button className="ghost" onClick={downloadSmiles} disabled={!display.length}>
            SMILES
          </button>
        </div>

        <div className="status">{status}</div>
      </div>

      {display.length > 0 && (
        <>
          <p className="lede" style={{ marginBottom: 12 }}>
            Score ={" "}
            {Math.round(WEIGHTS.similarity * 100)}% similarity +{" "}
            {Math.round(WEIGHTS.sizeFit * 100)}% size fit +{" "}
            {Math.round(WEIGHTS.drugLike * 100)}% drug-likeness
            {hasAdmet && <>, rescaled to make room for {Math.round(WEIGHTS.admet * 100)}% ADMET</>}
            . Hover a score to see its parts.
          </p>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  {rdkit && <th>Structure</th>}
                  <th>Score</th>
                  <th>Sim</th>
                  {LOCAL_COLUMNS.map((c) => <th key={c.key}>{c.label}</th>)}
                  {hasAdmet && ADMET_COLUMNS.map((c) => <th key={c.key}>{c.label}</th>)}
                  <th>Vendor</th>
                  <th>Catalogue ID</th>
                  <th>SMILES</th>
                </tr>
              </thead>
              <tbody>
                {display.map((row, i) => {
                  const a = admet[row.smiles] || {};
                  const d = row.descriptors || {};
                  const p = row.scoreParts || {};
                  const tip = [
                    `similarity ${fmt(p.similarity, 3)}`,
                    `size fit ${fmt(p.sizeFit, 3)}`,
                    `drug-likeness ${fmt(p.drugLike, 3)}`,
                    p.admet == null ? "ADMET not fetched" : `ADMET ${fmt(p.admet, 3)}`,
                  ].join(" · ");

                  return (
                    <tr key={row.inchiKey || row.smiles}>
                      <td className="num">{i + 1}</td>
                      {rdkit && (
                        <td
                          className="struct"
                          dangerouslySetInnerHTML={{ __html: drawings[row.smiles] || "" }}
                        />
                      )}
                      <td className="num" title={tip}>
                        {row.score == null ? (
                          <span className="pill">n/a</span>
                        ) : (
                          <strong>{row.score.toFixed(3)}</strong>
                        )}
                      </td>
                      <td className="num">
                        {row.similarity == null ? "" : row.similarity.toFixed(3)}
                      </td>
                      {LOCAL_COLUMNS.map((c) => (
                        <td className="num" key={c.key}>{fmt(d[c.key], c.digits)}</td>
                      ))}
                      {hasAdmet &&
                        ADMET_COLUMNS.map((c) => (
                          <td className={`num ${riskClass(c.key, a[c.key])}`} key={c.key}>
                            {fmt(a[c.key], 2)}
                          </td>
                        ))}
                      <td>
                        {row.source}
                        {row.alsoIn?.length ? (
                          <span className="pill" style={{ marginLeft: 6 }}>
                            + {row.alsoIn.join(", ")}
                          </span>
                        ) : null}
                      </td>
                      <td>{row.catalogId || ""}</td>
                      <td className="smiles" title={row.smiles}>{row.smiles}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <footer className="site">
        <p>
          Enamine REAL searched through{" "}
          <a href="https://sw.docking.org" rel="noreferrer noopener">SmallWorld</a>,
          hosted at UCSF — an academic resource, so queries are cached and rate
          limited here. ADMET predictions from{" "}
          <a href="https://admetlab3.scbdd.com" rel="noreferrer noopener">
            ADMETlab 3.0
          </a>{" "}
          (Xiong et al., <em>Nucleic Acids Research</em> 52:W422, 2024) — free,
          and throttled to stay inside their 5 requests/second guidance.
          Descriptors and fingerprints by{" "}
          <a href="https://www.rdkit.org" rel="noreferrer noopener">RDKit</a>,
          running in your browser.
        </p>
        <p>
          Similarity is ECFP4 Tanimoto, recomputed locally so it is comparable
          across vendors. ADMET values are model predictions, not measurements —
          use them to triage, not as evidence.
        </p>
      </footer>
    </div>
  );
}
