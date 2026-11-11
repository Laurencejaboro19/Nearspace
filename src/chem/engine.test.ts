import { describe, expect, it } from "vitest";
import { Molecule } from "openchemlib";
import { analyseSites, desalt, depict, fingerprint, fromSmiles, isValid, murckoScaffold, tanimoto, toSmiles } from "./mol";
import { assess, qed } from "./properties";
import { generate } from "./generate";
import { FRAGMENTS } from "./transforms";
import { analogRecord, toCSV } from "./export";

const DRUGS: Record<string, string> = {
  aspirin: "CC(=O)Oc1ccccc1C(=O)O",
  celecoxib: "CC1=CC=C(C=C1)C1=CC(=NN1C1=CC=C(C=C1)S(N)(=O)=O)C(F)(F)F",
  imatinib: "CC1=C(C=C(C=C1)NC(=O)C1=CC=C(CN2CCN(C)CC2)C=C1)NC1=NC=CC(=N1)C1=CN=CC=C1",
  sildenafil: "CCCC1=NN(C)C2=C1N=C(NC2=O)C1=CC(=CC=C1OCC)S(=O)(=O)N1CCN(C)CC1",
  ciprofloxacin: "OC(=O)C1=CN(C2CC2)C2=CC(=C(F)C=C2C1=O)N1CCNCC1",
  paracetamol: "CC(=O)Nc1ccc(O)cc1",
  ibuprofen: "CC(C)Cc1ccc(cc1)C(C)C(O)=O",
  losartan: "CCCCC1=NC(Cl)=C(CO)N1CC1=CC=C(C=C1)C1=CC=CC=C1C1=NN=NN1",
  fluconazole: "OC(Cn1cncn1)(Cn1cncn1)c1ccc(F)cc1F",
  metformin: "CN(C)C(=N)NC(N)=N",
};

describe("structure handling", () => {
  it("round-trips real drug SMILES", () => {
    for (const [name, smiles] of Object.entries(DRUGS)) {
      const m = fromSmiles(smiles);
      expect(m.getAllAtoms(), name).toBeGreaterThan(3);
      expect(isValid(m), name).toBe(true);
      const again = fromSmiles(toSmiles(m));
      expect(again.getIDCode(), name).toBe(m.getIDCode());
    }
  });

  it("strips counter-ions", () => {
    const salt = fromSmiles("CC(=O)Oc1ccccc1C(=O)[O-].[Na+]");
    expect(desalt(salt).getAllAtoms()).toBeLessThan(salt.getAllAtoms());
  });

  it("extracts a Bemis–Murcko scaffold", () => {
    const cele = murckoScaffold(fromSmiles(DRUGS.celecoxib)).scaffold;
    // Celecoxib's scaffold is the pyrazole plus its two aryl rings: 3 rings, no CF3 / sulfonamide.
    expect(cele.getRingSet().getSize()).toBe(3);
    expect(cele.toSmiles()).not.toContain("F");
    expect(cele.toSmiles()).not.toContain("S");

    const para = murckoScaffold(fromSmiles(DRUGS.paracetamol)).scaffold;
    expect(para.getRingSet().getSize()).toBe(1);
  });

  it("finds substituent and growth sites", () => {
    const sites = analyseSites(fromSmiles(DRUGS.celecoxib));
    expect(sites.rsites.length).toBeGreaterThanOrEqual(3);
    expect(sites.aromaticCH.length).toBeGreaterThan(3);
    for (const r of sites.rsites) expect(r.smiles).not.toBe("?");
  });

  it("renders SVG depictions", () => {
    const svg = depict(fromSmiles(DRUGS.imatinib), { width: 300, height: 220 });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("</svg>");
  });

  it("draws nothing in pure black on the dark canvas", () => {
    // OpenChemLib draws for paper and emits rgb(0,0,0) bonds, which are invisible on a near-black
    // background. Every depiction must be remapped; this caught a real regression.
    const dark = depict(fromSmiles(DRUGS.celecoxib), { dark: true });
    expect(dark).not.toMatch(/rgb\(0,\s*0,\s*0\)/);
    expect(dark).not.toContain("#000000");
    expect(dark).toContain("rgb(201,214,238)");

    // Light mode must keep the original, legible-on-white palette.
    const light = depict(fromSmiles(DRUGS.celecoxib), { dark: false });
    expect(light).toMatch(/rgb\(0,\s*0,\s*0\)/);
  });

  it("keeps heteroatom colours distinguishable in dark mode", () => {
    const svg = depict(fromSmiles("OC(=O)c1ccccc1NS(=O)(=O)CF"), { dark: true });
    // nitrogen and oxygen must not collapse into the bond colour
    expect(svg).toContain("rgb(125,163,255)");
    expect(svg).toContain("rgb(255,112,112)");
  });

  it("scores similarity sensibly", () => {
    const a = fingerprint(fromSmiles(DRUGS.celecoxib));
    const b = fingerprint(fromSmiles("CC1=CC=C(C=C1)C1=CC(=NN1C1=CC=C(C=C1)S(N)(=O)=O)C(F)F"));
    const c = fingerprint(fromSmiles(DRUGS.metformin));
    expect(tanimoto(a, b)).toBeGreaterThan(0.8);
    expect(tanimoto(a, c)).toBeLessThan(0.2);
  });
});

describe("transform library", () => {
  it("has a usable size and no duplicate ids", () => {
    expect(FRAGMENTS.length).toBeGreaterThanOrEqual(120);
    const ids = new Set(FRAGMENTS.map((f) => f.id));
    expect(ids.size).toBe(FRAGMENTS.length);
  });

  it("every fragment parses and cites an approved drug", () => {
    const broken: string[] = [];
    for (const f of FRAGMENTS) {
      try {
        const m = Molecule.fromSmiles(f.smiles);
        if (m.getAllAtoms() === 0) broken.push(`${f.id} (empty)`);
      } catch {
        broken.push(`${f.id} (${f.smiles})`);
      }
      expect(f.drugs.length, f.id).toBeGreaterThan(0);
    }
    expect(broken).toEqual([]);
  });
});

describe("properties", () => {
  it("puts approved drugs in a sane QED range", () => {
    for (const name of ["aspirin", "paracetamol", "ibuprofen", "celecoxib"]) {
      const a = assess(fromSmiles(DRUGS[name]));
      expect(a.qed, name).toBeGreaterThan(0.4);
      expect(a.qed, name).toBeLessThanOrEqual(1);
    }
  });

  it("gives simple molecules a low synthetic-accessibility penalty", () => {
    const easy = assess(fromSmiles(DRUGS.aspirin)).saScoreHeuristic;
    const hard = assess(fromSmiles("CC1OC(CC(O)C1O)OC1CC(O)C(O)C(C)O1")).saScoreHeuristic;
    expect(easy).toBeLessThan(hard);
    expect(easy).toBeGreaterThanOrEqual(1);
  });

  it("flags a nitroaromatic and leaves a clean drug alone", () => {
    expect(assess(fromSmiles("O=[N+]([O-])c1ccccc1")).alerts).toContain("Nitroaromatic");
    expect(assess(fromSmiles(DRUGS.celecoxib)).alerts).toEqual([]);
  });

  it("QED falls when alerts pile up", () => {
    const d = assess(fromSmiles(DRUGS.aspirin)).descriptors;
    expect(qed(d, 0)).toBeGreaterThan(qed(d, 4));
  });
});

describe("generation", () => {
  it("generates the requested number of unique, valid analogs", () => {
    const result = generate({ smiles: DRUGS.celecoxib, mode: "explore", count: 120, parentName: "celecoxib" });
    expect(result.analogs.length).toBe(120);

    const unique = new Set(result.analogs.map((a) => a.canonical));
    expect(unique.size).toBe(result.analogs.length);

    for (const analog of result.analogs) {
      expect(isValid(fromSmiles(analog.smiles)), analog.smiles).toBe(true);
      expect(analog.code).toMatch(/^NS-[A-Z2-9]{6}-\d{4}$/);
      expect(analog.name.length).toBeGreaterThan(5);
      expect(analog.transforms.length).toBeGreaterThan(0);
      expect(analog.score.total).toBeGreaterThanOrEqual(0);
      expect(analog.score.total).toBeLessThanOrEqual(1);
    }
  });

  it("never returns the parent itself", () => {
    const parentId = fromSmiles(DRUGS.ibuprofen).getIDCode();
    const result = generate({ smiles: DRUGS.ibuprofen, mode: "explore", count: 60 });
    expect(result.analogs.some((a) => a.canonical === parentId)).toBe(false);
  });

  it("keeps the scaffold in conservative mode", () => {
    const parentScaffold = murckoScaffold(fromSmiles(DRUGS.celecoxib)).scaffold.getIDCode();
    const result = generate({ smiles: DRUGS.celecoxib, mode: "conservative", count: 40 });
    expect(result.analogs.length).toBeGreaterThan(10);
    for (const a of result.analogs) {
      // Conservative edits only touch acyclic R-groups, so the ring framework is untouched unless
      // the swapped-in fragment itself carries a ring.
      const scaffold = murckoScaffold(fromSmiles(a.smiles)).scaffold.getIDCode();
      const introducedRing = a.transforms.some((t) => /yl$|phenyl|morpholin|piperaz|piperid|pyrrolidin|azetidin|thiophen|pyridin|pyrimidin|indol|tetrazol|triazol|imidazol|pyrazol|oxazol|furan|thiazol|naphthalen|quinolin|benz|cyclo|oxetan|bicyclo|pyrazin|pyridazin|pyrrol/i.test(t.fragmentName));
      if (!introducedRing) expect(scaffold).toBe(parentScaffold);
    }
  });

  it("is deterministic for a fixed seed", () => {
    const a = generate({ smiles: DRUGS.paracetamol, mode: "explore", count: 25, seed: 7 });
    const b = generate({ smiles: DRUGS.paracetamol, mode: "explore", count: 25, seed: 7 });
    expect(a.analogs.map((x) => x.canonical)).toEqual(b.analogs.map((x) => x.canonical));
  });

  it("reports honestly when the space is smaller than the request", () => {
    const result = generate({ smiles: "c1ccccc1", mode: "conservative", count: 500 });
    expect(result.exhausted).toBe(true);
    expect(result.analogs.length).toBeLessThan(500);
  });

  it("grows side chains onto ring positions", () => {
    const result = generate({ smiles: DRUGS.paracetamol, mode: "grow", count: 30 });
    expect(result.analogs.length).toBeGreaterThan(5);
    expect(result.analogs.some((a) => a.transforms.some((t) => t.kind === "grow"))).toBe(true);
  });

  it("respects locked atoms", () => {
    const parent = fromSmiles(DRUGS.celecoxib);
    const sites = analyseSites(parent);
    const locked = sites.rsites[0].atoms;
    const result = generate({ smiles: DRUGS.celecoxib, mode: "conservative", count: 40, lockedAtoms: locked });
    expect(result.analogs.every((a) => !a.transforms.some((t) => t.site === sites.rsites[0].label))).toBe(true);
  });
});

describe("export", () => {
  it("writes an SDF record that parses back", () => {
    const result = generate({ smiles: DRUGS.aspirin, mode: "explore", count: 3, parentName: "aspirin" });
    const record = analogRecord(result.analogs[0], { threeD: false, parentSmiles: result.parent.smiles });
    expect(record).toContain("$$$$");
    expect(record).toContain(">  <NEARSPACE_SCORE>");
    expect(record).toContain(">  <SA_SCORE_HEURISTIC>");
    const molfile = record.split(">  <")[0];
    const back = Molecule.fromMolfile(molfile);
    expect(back.getAllAtoms()).toBeGreaterThan(5);
  });

  it("writes a CSV with one row per analog", () => {
    const result = generate({ smiles: DRUGS.aspirin, mode: "explore", count: 5 });
    const csv = toCSV(result.analogs).trim().split("\n");
    expect(csv.length).toBe(result.analogs.length + 1);
    expect(csv[0]).toContain("nearspace_score");
  });
});
