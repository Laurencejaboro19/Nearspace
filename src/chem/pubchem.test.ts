import { afterEach, describe, expect, it, vi } from "vitest";
import { Molecule } from "openchemlib";
import {
  LookupError,
  classifyQuery,
  describeCids,
  findCids,
  resolveCid,
  searchByName,
  structureForCid,
  suggestNames,
} from "./pubchem";
import { fromSmiles } from "./mol";

const ASPIRIN = "CC(=O)Oc1ccccc1C(=O)O";

/** A real 2D SD record, built the same way PubChem serves one. */
function sdRecord(smiles: string): string {
  return `${Molecule.fromSmiles(smiles).toMolfile()}\n>  <PUBCHEM_COMPOUND_CID>\n2244\n\n$$$$\n`;
}

type Route = { match: RegExp; status?: number; json?: unknown; text?: string };

function mockFetch(routes: Route[]) {
  const calls: string[] = [];
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    const route = routes.find((r) => r.match.test(url));
    if (!route) return new Response("not found", { status: 404 });
    if (route.status && route.status >= 400) return new Response("err", { status: route.status });
    if (route.text !== undefined) return new Response(route.text, { status: 200 });
    return new Response(JSON.stringify(route.json), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", spy);
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("query classification", () => {
  it("tells names, CIDs and InChIKeys apart", () => {
    expect(classifyQuery("celecoxib")).toEqual({ kind: "name", value: "celecoxib" });
    expect(classifyQuery("  Imatinib mesylate ")).toEqual({ kind: "name", value: "Imatinib mesylate" });
    expect(classifyQuery("2244")).toEqual({ kind: "cid", value: "2244" });
    expect(classifyQuery("CID 2244")).toEqual({ kind: "cid", value: "2244" });
    expect(classifyQuery("cid:2244")).toEqual({ kind: "cid", value: "2244" });
    expect(classifyQuery("BSYNRYMUTXBXSQ-UHFFFAOYSA-N")).toEqual({
      kind: "inchikey",
      value: "BSYNRYMUTXBXSQ-UHFFFAOYSA-N",
    });
    // A name that merely looks numeric-ish stays a name.
    expect(classifyQuery("vitamin b12").kind).toBe("name");
  });
});

describe("finding compounds", () => {
  it("resolves a name to CIDs", async () => {
    mockFetch([{ match: /\/compound\/name\/.*\/cids/, json: { IdentifierList: { CID: [2244, 999] } } }]);
    expect(await findCids("aspirin")).toEqual([2244, 999]);
  });

  it("short-circuits a CID query without calling the network", async () => {
    const calls = mockFetch([]);
    expect(await findCids("CID 2244")).toEqual([2244]);
    expect(calls).toHaveLength(0);
  });

  it("uses the InChIKey endpoint for an InChIKey", async () => {
    const calls = mockFetch([{ match: /\/compound\/inchikey\//, json: { IdentifierList: { CID: [2244] } } }]);
    expect(await findCids("BSYNRYMUTXBXSQ-UHFFFAOYSA-N")).toEqual([2244]);
    expect(calls[0]).toContain("/compound/inchikey/");
  });

  it("reports an unknown name as not-found", async () => {
    mockFetch([{ match: /cids/, status: 404 }]);
    await expect(findCids("notadrugatall")).rejects.toMatchObject({ kind: "not-found" });
  });

  it("reports an empty result as not-found rather than returning nothing", async () => {
    mockFetch([{ match: /cids/, json: { IdentifierList: { CID: [] } } }]);
    await expect(findCids("ghost")).rejects.toBeInstanceOf(LookupError);
  });

  it("reports a dead connection as a network problem", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(findCids("aspirin")).rejects.toMatchObject({ kind: "network" });
  });

  it("rejects an empty query before calling out", async () => {
    const calls = mockFetch([]);
    await expect(findCids("   ")).rejects.toMatchObject({ kind: "bad-input" });
    expect(calls).toHaveLength(0);
  });
});

describe("structure resolution", () => {
  it("parses the SDF record into a usable SMILES", async () => {
    mockFetch([{ match: /record\/SDF/, text: sdRecord(ASPIRIN) }]);
    const smiles = await structureForCid(2244);
    expect(Molecule.fromSmiles(smiles).getIDCode()).toBe(fromSmiles(ASPIRIN).getIDCode());
  });

  it("asks for the 2D record, so no property field name is involved", async () => {
    const calls = mockFetch([{ match: /record\/SDF/, text: sdRecord(ASPIRIN) }]);
    await structureForCid(2244);
    expect(calls[0]).toContain("record_type=2d");
    expect(calls.join(" ")).not.toContain("CanonicalSMILES");
  });

  it("surfaces an unreadable record instead of returning junk", async () => {
    mockFetch([{ match: /record\/SDF/, text: "this is not a molfile\n$$$$\n" }]);
    await expect(structureForCid(2244)).rejects.toBeInstanceOf(LookupError);
  });
});

describe("metadata", () => {
  it("labels candidates with title and formula", async () => {
    mockFetch([
      {
        match: /property\/Title,MolecularFormula/,
        json: {
          PropertyTable: {
            Properties: [
              { CID: 2244, Title: "Aspirin", MolecularFormula: "C9H8O4" },
              { CID: 999, Title: "Other", MolecularFormula: "C2H6" },
            ],
          },
        },
      },
    ]);
    const out = await describeCids([2244, 999]);
    expect(out[0]).toEqual({ cid: 2244, title: "Aspirin", formula: "C9H8O4" });
  });

  it("still returns candidates when the property endpoint fails", async () => {
    mockFetch([{ match: /property/, status: 400 }]);
    const out = await describeCids([2244, 999]);
    expect(out).toEqual([{ cid: 2244 }, { cid: 999 }]);
  });

  it("resolves a CID fully, tolerating missing optional fields", async () => {
    mockFetch([
      { match: /record\/SDF/, text: sdRecord(ASPIRIN) },
      { match: /property\/Title,MolecularFormula/, json: { PropertyTable: { Properties: [{ CID: 2244, Title: "Aspirin", MolecularFormula: "C9H8O4" }] } } },
      { match: /synonyms/, json: { InformationList: { Information: [{ Synonym: ["Aspirin", "acetylsalicylic acid"] }] } } },
      { match: /property\/IUPACName/, status: 400 },
    ]);
    const hit = await resolveCid(2244);
    expect(hit.title).toBe("Aspirin");
    expect(hit.formula).toBe("C9H8O4");
    expect(hit.synonyms).toContain("acetylsalicylic acid");
    expect(hit.iupacName).toBeUndefined();
    expect(Molecule.fromSmiles(hit.smiles).getAllAtoms()).toBeGreaterThan(5);
  });
});

describe("search", () => {
  it("returns a structure and no alternatives for an unambiguous name", async () => {
    mockFetch([
      { match: /\/compound\/name\/.*\/cids/, json: { IdentifierList: { CID: [2244] } } },
      { match: /record\/SDF/, text: sdRecord(ASPIRIN) },
      { match: /property\/Title,MolecularFormula/, json: { PropertyTable: { Properties: [{ CID: 2244, Title: "Aspirin" }] } } },
      { match: /synonyms/, json: { InformationList: { Information: [{ Synonym: ["Aspirin"] }] } } },
      { match: /property\/IUPACName/, json: { PropertyTable: { Properties: [{ IUPACName: "2-acetyloxybenzoic acid" }] } } },
    ]);
    const { resolved, alternatives } = await searchByName("aspirin");
    expect(resolved.title).toBe("Aspirin");
    expect(resolved.iupacName).toBe("2-acetyloxybenzoic acid");
    expect(alternatives).toEqual([]);
  });

  it("offers alternatives when a name is ambiguous", async () => {
    mockFetch([
      { match: /\/compound\/name\/.*\/cids/, json: { IdentifierList: { CID: [1, 2, 3] } } },
      { match: /record\/SDF/, text: sdRecord(ASPIRIN) },
      { match: /property\/Title,MolecularFormula/, json: { PropertyTable: { Properties: [{ CID: 1, Title: "A" }, { CID: 2, Title: "B" }, { CID: 3, Title: "C" }] } } },
      { match: /synonyms/, json: { InformationList: { Information: [{ Synonym: ["A"] }] } } },
      { match: /property\/IUPACName/, json: { PropertyTable: { Properties: [{ IUPACName: "x" }] } } },
    ]);
    const { alternatives } = await searchByName("statin");
    expect(alternatives.map((a) => a.cid)).toEqual([1, 2, 3]);
  });

  it("feeds the generator a structure it can actually use", async () => {
    mockFetch([
      { match: /\/compound\/name\/.*\/cids/, json: { IdentifierList: { CID: [2244] } } },
      { match: /record\/SDF/, text: sdRecord(ASPIRIN) },
      { match: /property/, status: 400 },
      { match: /synonyms/, status: 400 },
    ]);
    const { resolved } = await searchByName("aspirin");
    const { generate } = await import("./generate");
    const result = generate({ smiles: resolved.smiles, mode: "explore", count: 5 });
    expect(result.analogs).toHaveLength(5);
  });
});

describe("suggestions", () => {
  it("returns type-ahead terms", async () => {
    mockFetch([{ match: /autocomplete/, json: { dictionary_terms: { compound: ["celecoxib", "celecoxib sodium"] } } }]);
    expect(await suggestNames("celec")).toEqual(["celecoxib", "celecoxib sodium"]);
  });

  it("never throws, so typing is never blocked", async () => {
    mockFetch([{ match: /autocomplete/, status: 500 }]);
    expect(await suggestNames("celec")).toEqual([]);
  });

  it("skips very short queries without calling out", async () => {
    const calls = mockFetch([]);
    expect(await suggestNames("c")).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
