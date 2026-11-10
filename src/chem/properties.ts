/**
 * Descriptors, drug-likeness rules, QED, a synthetic-accessibility heuristic and structural alerts.
 *
 * Honest labelling matters here: QED follows the published Bickerton desirability functions, but
 * the H-bond donor/acceptor and alert counts come from OpenChemLib and the alert list below rather
 * than from RDKit's exact definitions, so values can differ slightly from an RDKit QED. The
 * synthetic accessibility number is a documented heuristic of our own — it is NOT Ertl's published
 * SA score, and it is named `saScoreHeuristic` everywhere to keep that clear.
 */
import {
  Mol,
  aromaticRingCount,
  formalCharge,
  fractionCsp3,
  heavyAtomCount,
  matchesSmarts,
  molecularWeight,
  oclProperties,
  ringCount,
  Molecule,
} from "./mol";

export interface Descriptors {
  mw: number;
  logP: number;
  logS: number;
  tpsa: number;
  hbd: number;
  hba: number;
  rotatableBonds: number;
  aromaticRings: number;
  rings: number;
  heavyAtoms: number;
  fractionCsp3: number;
  formalCharge: number;
  stereoCenters: number;
}

export interface RuleVerdict {
  name: string;
  pass: boolean;
  violations: string[];
}

export interface Assessment {
  descriptors: Descriptors;
  qed: number;
  saScoreHeuristic: number;
  alerts: string[];
  rules: RuleVerdict[];
  lipinskiPass: boolean;
}

/* ---------------------------------------------------------------- descriptors */

export function descriptors(m: Mol): Descriptors {
  const p = oclProperties(m);
  return {
    mw: molecularWeight(m),
    logP: p.logP,
    logS: p.logS,
    tpsa: p.tpsa,
    hbd: p.hbd,
    hba: p.hba,
    rotatableBonds: p.rotatableBonds,
    aromaticRings: aromaticRingCount(m),
    rings: ringCount(m),
    heavyAtoms: heavyAtomCount(m),
    fractionCsp3: fractionCsp3(m),
    formalCharge: formalCharge(m),
    stereoCenters: p.stereoCenters,
  };
}

/* ----------------------------------------------------------------- rule panels */

export function evaluateRules(d: Descriptors): RuleVerdict[] {
  const lipinski: string[] = [];
  if (d.mw > 500) lipinski.push("MW > 500");
  if (d.logP > 5) lipinski.push("cLogP > 5");
  if (d.hbd > 5) lipinski.push("HBD > 5");
  if (d.hba > 10) lipinski.push("HBA > 10");

  const veber: string[] = [];
  if (d.rotatableBonds > 10) veber.push("Rotatable bonds > 10");
  if (d.tpsa > 140) veber.push("TPSA > 140 Å²");

  const ghose: string[] = [];
  if (d.mw < 160 || d.mw > 480) ghose.push("MW outside 160–480");
  if (d.logP < -0.4 || d.logP > 5.6) ghose.push("cLogP outside −0.4–5.6");
  if (d.heavyAtoms < 20 || d.heavyAtoms > 70) ghose.push("Heavy atoms outside 20–70");

  const lead: string[] = [];
  if (d.mw > 350) lead.push("MW > 350");
  if (d.logP > 3.5) lead.push("cLogP > 3.5");
  if (d.rotatableBonds > 7) lead.push("Rotatable bonds > 7");

  return [
    { name: "Lipinski Ro5", pass: lipinski.length <= 1, violations: lipinski },
    { name: "Veber", pass: veber.length === 0, violations: veber },
    { name: "Ghose", pass: ghose.length === 0, violations: ghose },
    { name: "Lead-likeness", pass: lead.length === 0, violations: lead },
  ];
}

/* ------------------------------------------------------------ structural alerts */

interface Alert {
  name: string;
  /** Matches if ANY of these patterns hit. */
  any: string[];
  /** Suppressed if any of these also hit (e.g. a nitro group contains a C–N=O). */
  unless?: string[];
  note: string;
}

const NITRO = ["[N+](=O)[O-]", "N(=O)=O"];

/**
 * A compact reactive / promiscuity alert set. These are flags for triage, not verdicts — plenty of
 * approved drugs carry one.
 *
 * The patterns are written against OpenChemLib's SMARTS support, which handles D/X/H primitives and
 * atom lists but not recursive `$(...)` expressions, so each alert is a list of plain patterns.
 */
export const ALERTS: Alert[] = [
  { name: "Nitroaromatic", any: ["c[N+](=O)[O-]", "cN(=O)=O"], note: "Mutagenicity and nitroreduction liabilities" },
  { name: "Aliphatic nitro", any: ["[CX4][N+](=O)[O-]", "[CX4]N(=O)=O"], note: "Reactive / mutagenic potential" },
  { name: "Nitroso", any: ["[#6]N=O"], unless: NITRO, note: "Strongly associated with mutagenicity" },
  { name: "Michael acceptor", any: ["[CX3]=[CX3][CX3]=[OX1]"], note: "Covalent reactivity with thiols" },
  { name: "Epoxide", any: ["C1OC1"], note: "Alkylating / genotoxic" },
  { name: "Aziridine", any: ["C1NC1"], note: "Alkylating" },
  { name: "Aldehyde", any: ["[CX3H1](=O)[#6]"], note: "Reactive, covalent protein binding" },
  { name: "Acyl halide", any: ["[CX3](=O)[F,Cl,Br,I]"], note: "Hydrolytically unstable" },
  { name: "Anhydride", any: ["[CX3](=O)O[CX3]=O"], note: "Hydrolytically unstable" },
  { name: "Azide", any: ["[N;D1]=[N;D2]=[N;D2]", "[N-]=[N+]=N"], note: "Energetic / unstable" },
  { name: "Hydrazine", any: ["[NX3][NX3]"], note: "Hepatotoxicity and mutagenicity signals" },
  { name: "Free thiol", any: ["[SX2H]"], note: "Oxidation and promiscuous binding" },
  { name: "Disulfide", any: ["[SX2][SX2]"], note: "Redox instability" },
  { name: "Quinone", any: ["O=C1C=CC(=O)C=C1", "O=C1C=CC(=O)C1"], note: "Redox cycling, classic PAINS" },
  { name: "Catechol", any: ["c1cc(O)c(O)cc1"], note: "Redox cycling, classic PAINS" },
  { name: "Reactive alkyl halide", any: ["[CX4][Cl,Br,I]"], note: "Alkylating potential" },
  { name: "Sulfonate ester", any: ["[SX4](=O)(=O)O[CX4]"], note: "Alkylating / genotoxic impurity class" },
  { name: "Thiocarbonyl", any: ["[CX3]=[SX1]"], note: "Metabolic liability" },
  { name: "Peroxide", any: ["[OX2][OX2]"], note: "Unstable / energetic" },
  { name: "Phosphoramide", any: ["[PX4](=O)N"], note: "Alkylating prodrug class" },
];

export function structuralAlerts(m: Mol): string[] {
  const hits: string[] = [];
  for (const alert of ALERTS) {
    if (!alert.any.some((p) => matchesSmarts(m, p))) continue;
    if (alert.unless?.some((p) => matchesSmarts(m, p))) continue;
    hits.push(alert.name);
  }
  return hits;
}

export const ALERT_NOTES = new Map(ALERTS.map((a) => [a.name, a.note]));

/* ------------------------------------------------------------------------- QED */

/**
 * Bickerton et al., "Quantifying the chemical beauty of drugs", Nat. Chem. 2012.
 * Asymmetric double sigmoidal desirability functions, weighted geometric mean (QED weighted).
 */
interface ADS {
  a: number; b: number; c: number; d: number; e: number; f: number; dmax: number;
}

const ADS_PARAMS: Record<string, ADS> = {
  MW:     { a: 2.817065973, b: 392.5754953, c: 290.7489764, d: 2.419764353, e: 49.22325677, f: 65.37051707, dmax: 104.9805561 },
  ALOGP:  { a: 3.172690585, b: 137.8624751, c: 2.534937431, d: 4.581497897, e: 0.822739154, f: 0.576295591, dmax: 131.3186604 },
  HBA:    { a: 2.948620388, b: 160.4605972, c: 3.615294657, d: 4.435986202, e: 0.290141953, f: 1.300669958, dmax: 148.7763046 },
  HBD:    { a: 1.618662227, b: 1010.051101, c: 0.985094388, d: 0.000000001, e: 0.713820843, f: 0.920922555, dmax: 258.1632616 },
  PSA:    { a: 1.876861559, b: 125.2232657, c: 62.90773554, d: 87.83366614, e: 12.01999824, f: 28.51324732, dmax: 104.5686167 },
  ROTB:   { a: 0.010000000, b: 272.4121427, c: 2.558379970, d: 1.565547684, e: 1.271567166, f: 2.758063707, dmax: 105.4420403 },
  AROM:   { a: 3.217788970, b: 957.7374108, c: 2.274627939, d: 0.000000001, e: 1.317690384, f: 0.375760881, dmax: 312.3372610 },
  ALERTS: { a: 0.010000000, b: 1199.094025, c: -0.09002883, d: 0.000000001, e: 0.185904477, f: 0.875193782, dmax: 417.7253140 },
};

/** Weights for "QED weighted" as published. */
const QED_WEIGHTS: Record<string, number> = {
  MW: 0.66, ALOGP: 0.46, HBA: 0.05, HBD: 0.61, PSA: 0.06, ROTB: 0.65, AROM: 0.48, ALERTS: 0.95,
};

function ads(x: number, p: ADS): number {
  const left = 1 / (1 + Math.exp(-(x - p.c + p.d / 2) / p.e));
  const right = 1 - 1 / (1 + Math.exp(-(x - p.c - p.d / 2) / p.f));
  return (p.a + p.b * left * right) / p.dmax;
}

export function qed(d: Descriptors, alertCount: number): number {
  const values: Record<string, number> = {
    MW: d.mw,
    ALOGP: d.logP,
    HBA: d.hba,
    HBD: d.hbd,
    PSA: d.tpsa,
    ROTB: d.rotatableBonds,
    AROM: d.aromaticRings,
    ALERTS: alertCount,
  };
  let weighted = 0;
  let total = 0;
  for (const key of Object.keys(ADS_PARAMS)) {
    const desirability = Math.max(ads(values[key], ADS_PARAMS[key]), 1e-9);
    weighted += QED_WEIGHTS[key] * Math.log(desirability);
    total += QED_WEIGHTS[key];
  }
  const value = Math.exp(weighted / total);
  return Math.min(1, Math.max(0, value));
}

/* --------------------------------------------- synthetic accessibility heuristic */

/**
 * A 1–10 "how hard would this be to make" heuristic (1 = easy). It is built from size, ring
 * complexity, stereochemistry and unusual-element penalties — the same ingredients Ertl's published
 * SA score uses, but WITHOUT his fragment-frequency table, which is why this is a proxy and is
 * named as one. Treat it as a coarse triage signal, not a published metric.
 */
export function saScoreHeuristic(m: Mol, d: Descriptors): number {
  m.ensureHelperArrays(Molecule.cHelperRings);

  let penalty = 0;

  // Size: large molecules are harder.
  penalty += Math.max(0, (d.heavyAtoms - 20) / 12);

  // Stereocentres compound quickly.
  penalty += d.stereoCenters * 0.55;

  const ringSet = m.getRingSet();
  const ringSizes: number[] = [];
  for (let r = 0; r < ringSet.getSize(); r++) ringSizes.push(ringSet.getRingSize(r));

  // Unusual ring sizes (3, 4 and anything above 7) are harder than 5/6-rings.
  for (const size of ringSizes) {
    if (size <= 4) penalty += 0.5;
    else if (size === 7) penalty += 0.4;
    else if (size > 7) penalty += 1.2;
  }

  // Ring fusion / bridging: atoms shared by more than one ring.
  let fusionAtoms = 0;
  let bridgeAtoms = 0;
  for (let a = 0; a < m.getAllAtoms(); a++) {
    const rings = m.getAtomRingCount(a, 7);
    if (rings >= 2) fusionAtoms++;
    if (m.getAtomRingBondCount(a) >= 3) bridgeAtoms++;
  }
  penalty += fusionAtoms * 0.18;
  penalty += bridgeAtoms * 0.6;

  // Macrocycles are a step change in difficulty.
  if (ringSizes.some((s) => s >= 12)) penalty += 2.5;

  // Rare elements.
  for (let a = 0; a < m.getAllAtoms(); a++) {
    const z = m.getAtomicNo(a);
    if (z === 53) penalty += 0.5;
    else if (z === 34 || z === 15 || z === 14 || z === 5) penalty += 0.8;
    else if (![1, 6, 7, 8, 9, 16, 17, 35].includes(z)) penalty += 1.5;
  }

  // Dense sp3 content with many stereocentres is the classic "hard to make" signature.
  if (d.fractionCsp3 > 0.6 && d.stereoCenters >= 2) penalty += 0.8;

  return Math.min(10, Math.max(1, 1 + penalty));
}

/* -------------------------------------------------------------------- assemble */

export function assess(m: Mol): Assessment {
  const d = descriptors(m);
  const alerts = structuralAlerts(m);
  const rules = evaluateRules(d);
  return {
    descriptors: d,
    qed: qed(d, alerts.length),
    saScoreHeuristic: saScoreHeuristic(m, d),
    alerts,
    rules,
    lipinskiPass: rules[0].pass,
  };
}
