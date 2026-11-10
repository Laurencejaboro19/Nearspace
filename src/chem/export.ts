/**
 * Export: docking-ready SDF (3D where possible), CSV, SMILES and a ZIP of individual records.
 *
 * The multi-molecule SDF is the main deliverable — every property Nearspace computed is written as
 * an SD tag, so the file carries its own provenance into Open Babel / AutoDock Vina.
 */
import { ConformerGenerator, Resources } from "openchemlib";
import { Mol, fromSmiles } from "./mol";
import type { Analog } from "./generate";

let resourcesReady: Promise<void> | null = null;

/** OCL's 3D engine needs its parameter tables registered once before any conformer is built. */
export function ensure3DResources(url = `${import.meta.env.BASE_URL ?? "/"}ocl-resources.json`): Promise<void> {
  if (!resourcesReady) {
    resourcesReady = Resources.registerFromUrl(url).then(
      () => undefined,
      (error: unknown) => {
        resourcesReady = null;
        throw error;
      },
    );
  }
  return resourcesReady;
}

export interface SdfOptions {
  threeD: boolean;
  parentSmiles: string;
}

/** Build a 3D conformer. Returns null when embedding fails, so the caller can fall back to 2D. */
export function conformer3D(mol: Mol, seed = 12345): Mol | null {
  try {
    const generator = new ConformerGenerator(seed);
    generator.initializeConformers(mol);
    const c = generator.getNextConformerAsMolecule();
    return c && c.getAllAtoms() > 0 ? c : null;
  } catch {
    return null;
  }
}

function sdTag(name: string, value: string | number): string {
  return `>  <${name}>\n${value}\n\n`;
}

export function analogRecord(analog: Analog, options: SdfOptions): string {
  const mol = fromSmiles(analog.smiles);
  let coords: "3D" | "2D" = "2D";
  let molfile: string;

  if (options.threeD) {
    const embedded = conformer3D(mol, analog.index * 7919 + 13);
    if (embedded) {
      coords = "3D";
      molfile = embedded.toMolfile();
    } else {
      molfile = mol.toMolfile();
    }
  } else {
    molfile = mol.toMolfile();
  }

  // Put the compound code on the molfile title line.
  const lines = molfile.split("\n");
  lines[0] = analog.code;
  molfile = lines.join("\n");

  const d = analog.assessment.descriptors;
  return (
    molfile.replace(/\n*$/, "\n") +
    sdTag("NAME", analog.name) +
    sdTag("CODE", analog.code) +
    sdTag("SMILES", analog.smiles) +
    sdTag("PARENT_SMILES", options.parentSmiles) +
    sdTag("COORDS", coords) +
    sdTag("MW", d.mw.toFixed(2)) +
    sdTag("CLOGP", d.logP.toFixed(2)) +
    sdTag("TPSA", d.tpsa.toFixed(1)) +
    sdTag("HBD", d.hbd) +
    sdTag("HBA", d.hba) +
    sdTag("ROTB", d.rotatableBonds) +
    sdTag("HEAVY_ATOMS", d.heavyAtoms) +
    sdTag("FRACTION_CSP3", d.fractionCsp3.toFixed(3)) +
    sdTag("QED", analog.assessment.qed.toFixed(3)) +
    sdTag("SA_SCORE_HEURISTIC", analog.assessment.saScoreHeuristic.toFixed(2)) +
    sdTag("TANIMOTO_TO_PARENT", analog.similarity.toFixed(3)) +
    sdTag("NEARSPACE_SCORE", analog.score.total.toFixed(3)) +
    sdTag("LIPINSKI", analog.assessment.lipinskiPass ? "pass" : "fail") +
    sdTag("TRANSFORMS", analog.transforms.map((t) => `${t.site}: ${t.fragmentName}`).join("; ") || "none") +
    sdTag("ALERTS", analog.assessment.alerts.join("; ") || "none") +
    (analog.pubchem?.cid ? sdTag("PUBCHEM_CID", analog.pubchem.cid) : "") +
    (analog.pubchem?.iupacName ? sdTag("PUBCHEM_IUPAC_NAME", analog.pubchem.iupacName) : "") +
    "$$$$\n"
  );
}

export async function toSDF(
  analogs: Analog[],
  options: SdfOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<string> {
  if (options.threeD) await ensure3DResources();
  let out = "";
  for (let i = 0; i < analogs.length; i++) {
    out += analogRecord(analogs[i], options);
    if (onProgress && i % 5 === 0) {
      onProgress(i + 1, analogs.length);
      // Yield so a 1000-compound export does not freeze the page.
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  onProgress?.(analogs.length, analogs.length);
  return out;
}

export function toCSV(analogs: Analog[]): string {
  const header = [
    "code", "name", "smiles", "mw", "clogp", "tpsa", "hbd", "hba", "rotb", "heavy_atoms",
    "fraction_csp3", "aromatic_rings", "qed", "sa_score_heuristic", "tanimoto_to_parent",
    "nearspace_score", "lipinski", "transforms", "alerts", "pubchem_cid",
  ];
  const rows = analogs.map((a) => {
    const d = a.assessment.descriptors;
    return [
      a.code,
      a.name,
      a.smiles,
      d.mw.toFixed(2),
      d.logP.toFixed(2),
      d.tpsa.toFixed(1),
      d.hbd,
      d.hba,
      d.rotatableBonds,
      d.heavyAtoms,
      d.fractionCsp3.toFixed(3),
      d.aromaticRings,
      a.assessment.qed.toFixed(3),
      a.assessment.saScoreHeuristic.toFixed(2),
      a.similarity.toFixed(3),
      a.score.total.toFixed(3),
      a.assessment.lipinskiPass ? "pass" : "fail",
      a.transforms.map((t) => `${t.site}: ${t.fragmentName}`).join("; "),
      a.assessment.alerts.join("; "),
      a.pubchem?.cid ?? "",
    ].map(csvCell).join(",");
  });
  return [header.join(","), ...rows].join("\n") + "\n";
}

function csvCell(value: unknown): string {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toSMI(analogs: Analog[]): string {
  return analogs.map((a) => `${a.smiles}\t${a.code}`).join("\n") + "\n";
}

export async function toZip(analogs: Analog[], options: SdfOptions): Promise<Blob> {
  const { default: JSZip } = await import("jszip");
  if (options.threeD) await ensure3DResources();
  const zip = new JSZip();
  const folder = zip.folder("nearspace-analogs");
  for (const analog of analogs) {
    folder?.file(`${analog.code}.sdf`, analogRecord(analog, options));
  }
  zip.file("nearspace-analogs.csv", toCSV(analogs));
  zip.file(
    "README.txt",
    [
      "Nearspace analog set",
      "",
      "Each .sdf holds one generated analog with its properties as SD tags.",
      "nearspace-analogs.csv holds the same data as a table.",
      "",
      "These are computationally generated hypotheses. They have not been made or tested.",
      "Check synthetic feasibility before ordering anything.",
      "",
      "To prepare them for AutoDock Vina:",
      "  obabel nearspace-analogs.sdf -O ligands.pdbqt -m --partialcharge gasteiger",
      "  vina --receptor target.pdbqt --ligand NS-XXXXXX-0001.pdbqt \\",
      "       --center_x 0 --center_y 0 --center_z 0 --size_x 20 --size_y 20 --size_z 20 \\",
      "       --exhaustiveness 8 --out docked.pdbqt",
      "",
    ].join("\n"),
  );
  return zip.generateAsync({ type: "blob" });
}

export function download(filename: string, content: string | Blob, mime = "text/plain") {
  const blob = typeof content === "string" ? new Blob([content], { type: mime }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
