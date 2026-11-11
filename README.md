# Nearspace

Type a drug name, or give it a structure. Nearspace finds the scaffold, keeps it, and generates up
to 1000 analogs by swapping functional groups and growing side chains taken from clinically approved
drugs — each one named, drawn in 2D and 3D, scored, and exported as a docking-ready SDF.

Built for SAR: generate a series, filter it, download the SDF, dock it against your target.

```
drug name · SMILES · SDF / MOL in
      ↓  Bemis–Murcko scaffold + R-group and open-position detection
      ↓  edit space: R-group swaps · bioisosteres · nitrogen scan · side-chain growth
      ↓  sanitisation, InChI-free canonical dedupe, descriptors, QED, SA proxy, alerts
   1–1000 ranked analogs
      ↓  2D depiction · interactive 3D · CSV · SMILES · ZIP
   multi-molecule SDF with every property as an SD tag → AutoDock Vina
```

Everything runs in the browser. No account, no API keys, nothing uploaded, no server-side
chemistry — which is also why it costs nothing to host.

## What it actually does

**Name search.** If you do not have a structure to hand, type the drug's name. Nearspace resolves it
against PubChem from the browser, with type-ahead suggestions, and shows you the structure it found
before anything is generated. The box also takes a PubChem CID (`2244`, `CID 2244`) or an InChIKey.
When a name is ambiguous it lists the matching entries with their structures and formulas so you can
pick the one you meant, rather than silently guessing.

**3D on every compound.** Each result card has a **3D** button that opens an interactive viewer —
drag to rotate, scroll to zoom, right-drag to pan — with stick, ball-and-stick, spacefill and van
der Waals surface styles, a spin toggle and a reset. The same viewer is in the full compound drawer.
3Dmol.js is bundled rather than loaded from a CDN, so it still works on networks that block them.

**Scaffold detection.** The Bemis–Murcko core is found by iteratively stripping terminal non-ring
atoms. What remains is the ring systems and their linkers. Every acyclic substituent hanging off
that core becomes a numbered R-site (R1, R2 …) you can see and lock.

**Generation modes.**

| Mode | What it changes |
|---|---|
| Conservative | One R-group swap per analog. The ring framework is untouched. |
| Explore | Up to two simultaneous changes, plus a nitrogen scan (aromatic C–H → N) of the rings. |
| Grow | Adds whole new side chains at ring positions that still carry a hydrogen. |

**The transform library** is ~160 curated fragments, each one present in at least one approved
drug, and each one listing those drugs in the UI so you can see where a change comes from.
Halogens and fluorine patterns, alkyls and small rings, ethers and alcohols, amines and saturated
N-heterocycles, acids and their classic bioisosteres (COOH ↔ tetrazole ↔ acylsulfonamide ↔
oxadiazolone ↔ hydroxamic acid), amides and carbamates, sulfonyls, nitriles, aromatic and fused
aromatic rings, and larger approved-drug side chains. See `src/chem/transforms.ts`.

**Every analog is checked** — valence-validated, round-tripped through the parser, deduplicated on
a canonical identifier, and never equal to the query.

**Every analog is named.** A stable code (`NS-<series>-0001`) plus a descriptive name built from the
edits actually applied ("R1 → morpholin-4-yl, aza-scan analog of celecoxib"). There is a per-compound
PubChem lookup that returns a real IUPAC name *only* if the structure already exists there.
Nothing is invented: a novel analog is reported as novel.

## Ranking

A composite 0–1 score with every component visible in the compound drawer, so the ranking is always
explainable. Weights live in `WEIGHTS` in `src/chem/score.ts` and are meant to be edited.

| Component | Weight | What it captures |
|---|---|---|
| Similarity | 0.40 | Tanimoto to the parent. This is a SAR tool, so relatedness dominates. |
| QED | 0.25 | Drug-likeness, via the published Bickerton desirability functions. |
| Synthesis | 0.20 | Inverted synthetic-accessibility heuristic. |
| Cleanliness | 0.15 | Absence of reactive / promiscuity alerts. |

## Being honest about the numbers

- **QED** implements the published asymmetric double-sigmoid desirability functions and weights.
  The H-bond donor/acceptor and alert counts come from OpenChemLib and the alert list in this repo
  rather than RDKit's exact definitions, so values can differ slightly from an RDKit QED.
- **SA score** is a documented heuristic built from size, ring complexity, fusion and bridging,
  stereocentres, macrocycles and rare elements. It is **not** Ertl's published fragment-based score,
  and it is called `saScoreHeuristic` throughout the code so it cannot be mistaken for it.
- **Properties** are calculated descriptors and rule-based filters, not trained ADMET models.
- **Structural alerts** are triage flags, not verdicts. Plenty of approved drugs carry one.
- **3D coordinates** are a single distance-geometry conformer — a starting geometry, not a
  conformational search. Vina will generate its own.
- **Generated compounds are hypotheses.** None of them have been made or tested. Check synthetic
  feasibility and novelty before acting on anything.

## Docking the output

```bash
# split the multi-SDF into one PDBQT per ligand
obabel nearspace-XXXXXX-3d.sdf -O lig.pdbqt -m --partialcharge gasteiger

# prepare the receptor once
obabel target.pdb -O target.pdbqt -xr

# dock
vina --receptor target.pdbqt --ligand lig1.pdbqt \
     --center_x 0 --center_y 0 --center_z 0 \
     --size_x 20 --size_y 20 --size_z 20 \
     --exhaustiveness 8 --out lig1_out.pdbqt
```

Every SDF record carries `NAME`, `CODE`, `SMILES`, `PARENT_SMILES`, `COORDS`, `MW`, `CLOGP`,
`TPSA`, `HBD`, `HBA`, `ROTB`, `HEAVY_ATOMS`, `FRACTION_CSP3`, `QED`, `SA_SCORE_HEURISTIC`,
`TANIMOTO_TO_PARENT`, `NEARSPACE_SCORE`, `LIPINSKI`, `TRANSFORMS` and `ALERTS` as SD tags, so the
provenance travels with the file.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
npm run test     # chemistry + UI tests
npm run build    # static output in dist/
```

Deploys to Vercel as a static site with no configuration beyond the Vite preset.

## How it's put together

```
src/chem/
  mol.ts          parsing, cloning, scaffold, edits, depiction, similarity, SMARTS
  pubchem.ts      name / CID / InChIKey lookup and structure resolution
  transforms.ts   the approved-drug fragment library and the nitrogen scan
  properties.ts   descriptors, rule panels, QED, SA heuristic, structural alerts
  score.ts        the composite ranking and its weights
  naming.ts       series codes, descriptive names, PubChem lookup
  generate.ts     the engine: edit space → seeded sampling → validation → scoring
  export.ts       SDF (2D/3D), CSV, SMILES, ZIP
src/workers/      generation runs off the main thread
src/components/   input, name search, results grid, detail drawer, 3D viewer, filters
```

Chemistry is [OpenChemLib](https://github.com/cheminfo/openchemlib-js) (pure JavaScript — structure
editing, depiction, descriptors, SMARTS, conformers). 3D display is
[3Dmol.js](https://3dmol.csb.pitt.edu/), bundled as a lazy chunk so its weight is only paid when a
3D view is actually opened. Generation is deterministic for a given query, mode, count
and seed.

### A note on depiction colours

OpenChemLib draws for paper: bonds and carbon labels come out as `rgb(0,0,0)`, which is invisible on
the dark canvas. `depict()` remaps the palette after rendering, and `Structure` follows the live
theme through a small store rather than a prop drilled through every list and drawer, so a depiction
rendered after a theme change is still correct. There are tests asserting that no pure black
survives in dark mode and that light mode keeps the original palette — this was a real bug.

### A note on the PubChem integration

PubChem has renamed its SMILES *properties* over time (`CanonicalSMILES` → `ConnectivitySMILES`,
`IsomericSMILES` → `SMILES`), and asking PUG-REST for a property it no longer recognises fails the
whole request. So structure resolution never goes through the property endpoint: it fetches the 2D
SDF record and parses it locally with the same code path that reads an uploaded file. Property calls
are used only for human-facing labels (title, formula, IUPAC name), and every one of them is allowed
to fail without breaking a search. Lookups by SMILES are sent as POST form bodies, because SMILES
routinely contain `/`, `\\`, `#` and `+`, which PUG-REST mis-reads in a URL path even percent-encoded.

### A note on why the chemistry is written this way

RDKit's WASM build cannot edit molecules — it has no atom/bond mutation API — so a generator built
on it would have to do SMILES string surgery. OpenChemLib exposes real editing (`addMolecule`,
`deleteAtoms`, `setAtomicNo`) along with depiction, descriptors and conformers in one pure-JS
package, which is why it carries the whole pipeline here. One caveat worth knowing if you extend
this: `getIDCode()` round-trips renumber atoms, so cloning for an edit must use `getCompactCopy()`
or every atom index you were holding becomes wrong.

## The earlier Nearspace

The original Nearspace — a Next.js app that searched Enamine REAL via SmallWorld and pulled ADMETlab
predictions — is preserved under [`legacy-nextjs/`](legacy-nextjs/). It answers a different question
(*what can I buy that's nearby?*) from this one (*what should I make next?*).

## Licence

MIT — see [LICENSE](LICENSE).
