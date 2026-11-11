import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import App from "./App";
import Structure from "./components/Structure";
import AnalogCard from "./components/AnalogCard";
import Filters, { DEFAULT_FILTERS, applyFilters } from "./components/Filters";
import NameSearch from "./components/NameSearch";
import InputPanel from "./components/InputPanel";
import { generate } from "./chem/generate";

describe("ui smoke", () => {
  it("renders the app shell", () => {
    const html = renderToString(<App />);
    expect(html).toContain("NEARSPACE");
    expect(html).toContain("Keep the scaffold");
    expect(html).toContain("Generate");
  });

  it("offers name search as the default way in", () => {
    const html = renderToString(<App />);
    expect(html).toContain("Search by name");
    expect(html).toContain("Paste or upload");
    expect(html).toContain("celecoxib");
  });

  it("renders the name search box with its suggestions", () => {
    const html = renderToString(<NameSearch onResolved={() => {}} />);
    expect(html).toContain("Search by name");
    expect(html).toContain("CID or InChIKey");
    expect(html).toContain("Imatinib");
  });

  it("renders the input panel on the structure tab with a parsed query", () => {
    const html = renderToString(
      <InputPanel
        smiles="CC(=O)Oc1ccccc1C(=O)O"
        onSmiles={() => {}}
        parentName="aspirin"
        onParentName={() => {}}
        mode="explore"
        onMode={() => {}}
        count={100}
        onCount={() => {}}
        lockedSites={[]}
        onToggleLock={() => {}}
        onGenerate={() => {}}
        busy={false}
      />,
    );
    expect(html).toContain("Detected scaffold");
    expect(html).toContain("Generate 100 analogs");
  });

  it("renders a structure to inline SVG", () => {
    const html = renderToString(<Structure smiles="CC(=O)Oc1ccccc1C(=O)O" />);
    expect(html).toContain("<svg");
  });

  it("renders an analog card with real generated data", () => {
    const result = generate({ smiles: "CC(=O)Nc1ccc(O)cc1", mode: "explore", count: 3, parentName: "paracetamol" });
    const html = renderToString(
      <AnalogCard
        analog={result.analogs[0]}
        selected={false}
        onSelect={() => {}}
        onOpen={() => {}}
        onOpen3D={() => {}}
      />,
    );
    expect(html).toContain(result.analogs[0].code);
    expect(html).toContain("QED");
    // the 3D affordance must be on the card itself, not buried in the drawer
    expect(html).toContain(`View ${result.analogs[0].code} in 3D`);
  });

  it("renders the filter panel", () => {
    const html = renderToString(
      <Filters value={DEFAULT_FILTERS} onChange={() => {}} sort="score" onSort={() => {}} shown={5} total={9} />,
    );
    expect(html).toContain("Max MW");
    expect(html).toContain("Nearspace score");
  });

  it("filters on every criterion", () => {
    const result = generate({ smiles: "CC1=CC=C(C=C1)C1=CC(=NN1C1=CC=C(C=C1)S(N)(=O)=O)C(F)(F)F", mode: "explore", count: 60 });
    expect(applyFilters(result.analogs, DEFAULT_FILTERS).length).toBe(result.analogs.length);
    const strict = applyFilters(result.analogs, { ...DEFAULT_FILTERS, mwMax: 350, lipinskiOnly: true, noAlerts: true });
    expect(strict.length).toBeLessThan(result.analogs.length);
    expect(strict.every((a) => a.assessment.descriptors.mw <= 350 && a.assessment.lipinskiPass)).toBe(true);
  });
});
