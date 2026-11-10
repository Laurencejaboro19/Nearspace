# Nearspace

Give it a structure. It asks **Enamine REAL** which nearby compounds can
actually be made, scores and ranks them, and pulls free **ADMET predictions**
for the shortlist.

Runs on Vercel's free tier. No GPU, no docking binaries, no API bills.

```
SMILES or SDF
   ├── Enamine REAL   (SmallWorld — free, no key)
   └── onepot CORE    (optional — set ONEPOT_API_KEY)
          ↓  InChIKey dedupe, ECFP4 re-score, 43 RDKit descriptors — in your browser
     top 100, ranked
          ↓  ADMETlab 3.0 — 119 properties, free
     re-ranked with predicted liabilities → CSV
```

## The ranking algorithm

Vendor scores can't be ranked against each other — SmallWorld returns a graph
*edit distance*, onepot returns its own Tanimoto — and neither tells you whether
a compound is worth pursuing. So Nearspace scores every candidate itself, from
four components, each 0–1 and higher-is-better:

| Component | Weight | What it catches |
|---|---|---|
| **similarity** | 60% | ECFP4 Tanimoto to the query. This is a SAR tool, so structural relatedness dominates. |
| **sizeFit** | 10% | Heavy-atom closeness. Fingerprints tolerate large appendages, so a 37-atom hit can score 0.5 against a 13-atom query while being a different series entirely. |
| **drugLike** | 30% | Lipinski and Veber penalties from local RDKit descriptors, plus sanity limits on tiny fragments and very greasy or very polar compounds. |
| **admet** | 25% | Predicted hERG, Ames, DILI, hepatotoxicity, carcinogenicity, HIA, Caco-2 and CYP3A4 inhibition. Folded in only once ADMET is fetched; the other three weights are rescaled to make room so scores stay on one 0–1 scale. |

Weights live in `WEIGHTS` in `lib/score.js` and are meant to be edited for your
project. Every sub-score is kept on the row and shown when you hover a score —
the ranking is auditable, not a black box.

Two deliberate choices in there:

- **Missing is not safe.** A compound with no hERG prediction is skipped from
  the ADMET term rather than scored as probability zero. `Number(null)` is `0`
  in JavaScript, so getting this wrong ranks untested compounds above ones
  predicted clean.
- **Soft scores, not filters.** An early hit list is the wrong place to
  hard-exclude anything. Nothing is dropped; poor compounds just sink.

## Why it's free to run

| Job | Where | Cost |
|---|---|---|
| Billion-scale neighbour search | Enamine's SmallWorld | free |
| Fingerprints, dedupe, descriptors, drawings, SDF parsing | the visitor's browser (RDKit WASM) | $0 |
| ADMET prediction | ADMETlab 3.0 | $0 |
| Everything else | one Vercel function | free tier |

Nothing heavy runs on the server, which is why this fits in a serverless
function. RDKit via Python needs a container and torch-class ADMET models blow
past the 250 MB function limit — doing the chemistry client-side sidesteps both,
and means MW, cLogP, TPSA and the rest appear instantly with no network call.

## Deploy

```bash
npm install
npm run dev          # http://localhost:3000
```

Import the repo on Vercel and it builds as-is. Optional environment variables:

| Variable | Needed? | What it does |
|---|---|---|
| `ONEPOT_API_KEY` | optional | Enables onepot CORE. Without it the checkbox stays off and Enamine runs alone. |
| `SMALLWORLD_DB` | optional | Pin a REAL database name. Blank = auto-detect the newest. |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | **before going public** | Vercel KV, so the cache is shared across function instances. |

## Read this before you make it public

**The in-memory cache is not enough on its own.** Every cold serverless instance
starts empty, so without KV a popular page re-runs searches against UCSF's
server for every visitor. `sw.docking.org` is run by John Irwin, Brian Shoichet
and colleagues as a service to the field, on somebody else's budget. Add KV,
keep the rate limit, and don't be the reason it goes away.

**ADMETlab asks for under 5 requests/second** and its prediction endpoint takes
one molecule per call. `lib/admetlab.js` is sequential and throttled on purpose.
Do not parallelise it — the authors note that web-interface traffic takes
precedence over the API, so being greedy gets you throttled and degrades a free
resource for everyone. 100 compounds takes about 20 seconds, chunked 20 at a
time so you see progress.

Rate limits are per-IP, in-process, and scoped per route so fetching ADMET
cannot eat your search budget. They're a speed bump, not a wall — for a real
public deployment move them to KV or put auth in front.

## What the numbers mean

- **Similarity** is ECFP4 Tanimoto recomputed locally for every hit, which is
  the only way a merged multi-vendor ranking means anything.
- **Local columns** (MW, cLogP, TPSA, HBD/HBA, RotB, Heavy) are RDKit
  descriptors — computed, exact, free.
- **ADMET columns** are model *predictions*. Good for triage and for cutting
  obvious liabilities; not evidence. Cite ADMETlab if you publish.
- **Dedupe is by InChIKey**, so a compound offered by both vendors appears once,
  keeping the priced entry and recording the other's catalogue ID.

## Ordering

onepot has a real ordering API — `orderOnepot()` in `lib/onepot.js` wraps it,
but no UI is wired to it deliberately: that call spends real money and deserves
an explicit confirmation step.

Enamine has no ordering API. Export the SMILES and catalogue IDs and email
`orders@enamine.net` for a quote.

## Layout

```
app/page.js               UI: input, search, scoring table, ADMET, CSV export
app/api/search/route.js   merges vendor searches, per-IP limited
app/api/admet/route.js    chunked, cached, throttled ADMETlab proxy
lib/score.js              the ranking algorithm — weights and sub-scores
lib/chem.js               RDKit WASM: fingerprints, InChIKey, descriptors, SDF, SVG
lib/smallworld.js         Enamine REAL (SSE submit + paged view)
lib/onepot.js             onepot CORE search + ordering
lib/admetlab.js           ADMETlab 3.0 client, throttled
lib/cache.js              KV-or-memory cache + scoped per-IP rate limiting
```

Docking is intentionally absent: it needs minutes of CPU per ligand and belongs
on a real machine, not a serverless function. A companion CLI does that part
with AutoDock Vina.

## Credit

- Enamine REAL via [SmallWorld](https://sw.docking.org) (NextMove Software's
  engine, hosted at UCSF).
- [onepot](https://onepot.ai) CORE for synthesizable analogs and pricing.
- ADMET from [ADMETlab 3.0](https://admetlab3.scbdd.com) — Xiong et al.,
  *Nucleic Acids Research* 52:W422, 2024.
- Cheminformatics by [RDKit](https://www.rdkit.org) MinimalLib.

## Licence

MIT.
