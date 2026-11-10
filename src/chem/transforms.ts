/**
 * Nearspace transform library.
 *
 * Every fragment here appears in at least one clinically approved drug. The SMILES is written so
 * that ATOM 0 IS THE ATTACHMENT ATOM — the generator bonds atom 0 of the fragment to the scaffold.
 *
 * `weight` is a rough prior for how commonly the group is used in medicinal chemistry (higher =
 * sampled more often). It is a sampling heuristic, not a measured frequency.
 */

export type FragmentCategory =
  | "halogen"
  | "alkyl"
  | "cycloalkyl"
  | "ether"
  | "alcohol"
  | "amine"
  | "n-heterocycle"
  | "acid-bioisostere"
  | "amide"
  | "sulfonyl"
  | "nitrile"
  | "aromatic"
  | "fused-aromatic"
  | "sidechain";

export interface Fragment {
  id: string;
  name: string;
  /** SMILES whose first atom is the attachment point. */
  smiles: string;
  category: FragmentCategory;
  /** Approved drugs that contain this fragment. */
  drugs: string[];
  weight: number;
  /** Fragments small enough to be grown onto a ring C–H without clashing. */
  growable: boolean;
}

export const FRAGMENTS: Fragment[] = [
  // ---------------------------------------------------------------- halogens
  { id: "F", name: "fluoro", smiles: "F", category: "halogen", drugs: ["Ciprofloxacin", "Celecoxib"], weight: 10, growable: true },
  { id: "Cl", name: "chloro", smiles: "Cl", category: "halogen", drugs: ["Loratadine", "Clopidogrel"], weight: 8, growable: true },
  { id: "Br", name: "bromo", smiles: "Br", category: "halogen", drugs: ["Bromhexine"], weight: 3, growable: true },
  { id: "I", name: "iodo", smiles: "I", category: "halogen", drugs: ["Amiodarone"], weight: 1, growable: true },
  { id: "CF3", name: "trifluoromethyl", smiles: "C(F)(F)F", category: "halogen", drugs: ["Celecoxib", "Fluoxetine"], weight: 9, growable: true },
  { id: "OCF3", name: "trifluoromethoxy", smiles: "OC(F)(F)F", category: "halogen", drugs: ["Riluzole"], weight: 5, growable: true },
  { id: "CHF2", name: "difluoromethyl", smiles: "C(F)F", category: "halogen", drugs: ["Pantoprazole"], weight: 4, growable: true },
  { id: "OCHF2", name: "difluoromethoxy", smiles: "OC(F)F", category: "halogen", drugs: ["Pantoprazole", "Roflumilast"], weight: 4, growable: true },
  { id: "CH2F", name: "fluoromethyl", smiles: "CF", category: "halogen", drugs: ["Fluticasone"], weight: 2, growable: true },

  // ------------------------------------------------------------------ alkyl
  { id: "Me", name: "methyl", smiles: "C", category: "alkyl", drugs: ["Celecoxib", "Ibuprofen"], weight: 10, growable: true },
  { id: "Et", name: "ethyl", smiles: "CC", category: "alkyl", drugs: ["Sildenafil", "Etodolac"], weight: 7, growable: true },
  { id: "nPr", name: "propyl", smiles: "CCC", category: "alkyl", drugs: ["Sildenafil"], weight: 4, growable: true },
  { id: "iPr", name: "isopropyl", smiles: "C(C)C", category: "alkyl", drugs: ["Ritonavir", "Atorvastatin"], weight: 6, growable: true },
  { id: "iBu", name: "isobutyl", smiles: "CC(C)C", category: "alkyl", drugs: ["Ibuprofen"], weight: 4, growable: false },
  { id: "tBu", name: "tert-butyl", smiles: "C(C)(C)C", category: "alkyl", drugs: ["Salbutamol", "Terbinafine"], weight: 5, growable: false },
  { id: "nBu", name: "butyl", smiles: "CCCC", category: "alkyl", drugs: ["Valsartan"], weight: 3, growable: false },
  { id: "vinyl", name: "vinyl", smiles: "C=C", category: "alkyl", drugs: ["Vinblastine"], weight: 2, growable: true },
  { id: "alkyne", name: "ethynyl", smiles: "C#C", category: "alkyl", drugs: ["Ethinylestradiol", "Efavirenz"], weight: 3, growable: true },
  { id: "allyl", name: "allyl", smiles: "CC=C", category: "alkyl", drugs: ["Naloxone"], weight: 2, growable: true },

  // ------------------------------------------------------------- cycloalkyl
  { id: "cPr", name: "cyclopropyl", smiles: "C1CC1", category: "cycloalkyl", drugs: ["Ciprofloxacin", "Efavirenz"], weight: 8, growable: true },
  { id: "cBu", name: "cyclobutyl", smiles: "C1CCC1", category: "cycloalkyl", drugs: ["Nalbuphine"], weight: 4, growable: false },
  { id: "cPent", name: "cyclopentyl", smiles: "C1CCCC1", category: "cycloalkyl", drugs: ["Ticagrelor"], weight: 4, growable: false },
  { id: "cHex", name: "cyclohexyl", smiles: "C1CCCCC1", category: "cycloalkyl", drugs: ["Glibenclamide"], weight: 4, growable: false },
  { id: "CH2cPr", name: "cyclopropylmethyl", smiles: "CC1CC1", category: "cycloalkyl", drugs: ["Buprenorphine"], weight: 3, growable: false },
  { id: "oxetanyl", name: "oxetan-3-yl", smiles: "C1COC1", category: "cycloalkyl", drugs: ["Crizotinib analogues"], weight: 3, growable: false },
  { id: "CF2cPr", name: "1-fluorocyclopropyl", smiles: "C1(F)CC1", category: "cycloalkyl", drugs: ["Sitafloxacin"], weight: 2, growable: false },
  { id: "bicyclopentyl", name: "bicyclo[1.1.1]pentan-1-yl", smiles: "C12CC(C1)C2", category: "cycloalkyl", drugs: ["Benzene bioisostere (clinical candidates)"], weight: 2, growable: false },

  // ------------------------------------------------------------------ ether
  { id: "OMe", name: "methoxy", smiles: "OC", category: "ether", drugs: ["Omeprazole", "Verapamil"], weight: 10, growable: true },
  { id: "OEt", name: "ethoxy", smiles: "OCC", category: "ether", drugs: ["Sildenafil"], weight: 6, growable: true },
  { id: "OiPr", name: "isopropoxy", smiles: "OC(C)C", category: "ether", drugs: ["Bisoprolol"], weight: 4, growable: false },
  { id: "OcPr", name: "cyclopropoxy", smiles: "OC1CC1", category: "ether", drugs: ["Roflumilast"], weight: 3, growable: false },
  { id: "OCH2CH2OMe", name: "2-methoxyethoxy", smiles: "OCCOC", category: "ether", drugs: ["Erlotinib"], weight: 3, growable: false },
  { id: "OPh", name: "phenoxy", smiles: "Oc1ccccc1", category: "ether", drugs: ["Fluoxetine", "Diphenhydramine"], weight: 4, growable: false },
  { id: "OBn", name: "benzyloxy", smiles: "OCc1ccccc1", category: "ether", drugs: ["Safinamide"], weight: 3, growable: false },
  { id: "OCH2CF3", name: "2,2,2-trifluoroethoxy", smiles: "OCC(F)(F)F", category: "ether", drugs: ["Flecainide", "Lansoprazole"], weight: 3, growable: false },
  { id: "THPyranyl", name: "tetrahydropyran-4-yl", smiles: "C1CCOCC1", category: "ether", drugs: ["Fostamatinib"], weight: 3, growable: false },
  { id: "THFuryl", name: "tetrahydrofuran-3-yl", smiles: "C1CCOC1", category: "ether", drugs: ["Nelfinavir analogues"], weight: 2, growable: false },
  { id: "OCH2CH2OH", name: "2-hydroxyethoxy", smiles: "OCCO", category: "ether", drugs: ["Gefitinib analogues"], weight: 2, growable: false },
  { id: "methylenedioxy", name: "methoxymethyl", smiles: "COC", category: "ether", drugs: ["Omeprazole"], weight: 3, growable: false },

  // ---------------------------------------------------------------- alcohol
  { id: "OH", name: "hydroxy", smiles: "O", category: "alcohol", drugs: ["Paracetamol", "Morphine"], weight: 9, growable: true },
  { id: "CH2OH", name: "hydroxymethyl", smiles: "CO", category: "alcohol", drugs: ["Salbutamol", "Zidovudine"], weight: 6, growable: true },
  { id: "CHOHCH3", name: "1-hydroxyethyl", smiles: "C(O)C", category: "alcohol", drugs: ["Meropenem"], weight: 4, growable: false },
  { id: "CMe2OH", name: "2-hydroxypropan-2-yl", smiles: "C(C)(C)O", category: "alcohol", drugs: ["Montelukast"], weight: 4, growable: false },
  { id: "CH2CH2OH", name: "2-hydroxyethyl", smiles: "CCO", category: "alcohol", drugs: ["Hydroxyzine"], weight: 4, growable: false },
  { id: "CF3OH", name: "1,1,1-trifluoro-2-hydroxypropan-2-yl", smiles: "C(O)(C)C(F)(F)F", category: "alcohol", drugs: ["Efavirenz-like motifs"], weight: 1, growable: false },

  // ------------------------------------------------------------------ amine
  { id: "NH2", name: "amino", smiles: "N", category: "amine", drugs: ["Sulfamethoxazole", "Procainamide"], weight: 8, growable: true },
  { id: "NHMe", name: "methylamino", smiles: "NC", category: "amine", drugs: ["Adrenaline", "Sumatriptan"], weight: 6, growable: true },
  { id: "NMe2", name: "dimethylamino", smiles: "N(C)C", category: "amine", drugs: ["Sumatriptan", "Doxycycline"], weight: 7, growable: false },
  { id: "NHEt", name: "ethylamino", smiles: "NCC", category: "amine", drugs: ["Propranolol analogues"], weight: 4, growable: false },
  { id: "NHiPr", name: "isopropylamino", smiles: "NC(C)C", category: "amine", drugs: ["Propranolol", "Salbutamol"], weight: 5, growable: false },
  { id: "NHcPr", name: "cyclopropylamino", smiles: "NC1CC1", category: "amine", drugs: ["Abacavir"], weight: 3, growable: false },
  { id: "CH2NH2", name: "aminomethyl", smiles: "CN", category: "amine", drugs: ["Tranexamic acid"], weight: 4, growable: true },
  { id: "CH2NMe2", name: "dimethylaminomethyl", smiles: "CN(C)C", category: "amine", drugs: ["Tramadol"], weight: 4, growable: false },
  { id: "NHAc", name: "acetamido", smiles: "NC(C)=O", category: "amine", drugs: ["Paracetamol", "Metoclopramide"], weight: 6, growable: false },
  { id: "NHBn", name: "benzylamino", smiles: "NCc1ccccc1", category: "amine", drugs: ["Benzylpenicillin-related amines"], weight: 3, growable: false },
  { id: "guanidine", name: "guanidino", smiles: "NC(N)=N", category: "amine", drugs: ["Metformin", "Zanamivir"], weight: 3, growable: false },
  { id: "amidine", name: "carbamimidoyl", smiles: "C(N)=N", category: "amine", drugs: ["Dabigatran", "Pentamidine"], weight: 3, growable: false },

  // --------------------------------------------------- saturated N-heterocycles
  { id: "morpholine", name: "morpholin-4-yl", smiles: "N1CCOCC1", category: "n-heterocycle", drugs: ["Gefitinib", "Linezolid"], weight: 9, growable: false },
  { id: "piperazine", name: "piperazin-1-yl", smiles: "N1CCNCC1", category: "n-heterocycle", drugs: ["Ciprofloxacin", "Aripiprazole"], weight: 9, growable: false },
  { id: "NMePiperazine", name: "4-methylpiperazin-1-yl", smiles: "N1CCN(C)CC1", category: "n-heterocycle", drugs: ["Imatinib", "Olanzapine"], weight: 9, growable: false },
  { id: "piperidine", name: "piperidin-1-yl", smiles: "N1CCCCC1", category: "n-heterocycle", drugs: ["Loratadine", "Donepezil"], weight: 8, growable: false },
  { id: "piperidin4yl", name: "piperidin-4-yl", smiles: "C1CCNCC1", category: "n-heterocycle", drugs: ["Fentanyl", "Risperidone"], weight: 6, growable: false },
  { id: "pyrrolidine", name: "pyrrolidin-1-yl", smiles: "N1CCCC1", category: "n-heterocycle", drugs: ["Clindamycin", "Tofacitinib"], weight: 7, growable: false },
  { id: "azetidine", name: "azetidin-1-yl", smiles: "N1CCC1", category: "n-heterocycle", drugs: ["Baricitinib", "Cobimetinib"], weight: 5, growable: false },
  { id: "azetidin3yl", name: "azetidin-3-yl", smiles: "C1CNC1", category: "n-heterocycle", drugs: ["Baricitinib"], weight: 3, growable: false },
  { id: "aziridine", name: "aziridin-1-yl", smiles: "N1CC1", category: "n-heterocycle", drugs: ["Thiotepa"], weight: 1, growable: false },
  { id: "acetylpiperazine", name: "4-acetylpiperazin-1-yl", smiles: "N1CCN(C(C)=O)CC1", category: "n-heterocycle", drugs: ["Indinavir-type motifs"], weight: 4, growable: false },
  { id: "msPiperazine", name: "4-(methylsulfonyl)piperazin-1-yl", smiles: "N1CCN(S(C)(=O)=O)CC1", category: "n-heterocycle", drugs: ["Sildenafil"], weight: 5, growable: false },
  { id: "homopiperazine", name: "1,4-diazepan-1-yl", smiles: "N1CCNCCC1", category: "n-heterocycle", drugs: ["Bepridil-type motifs"], weight: 2, growable: false },
  { id: "morpholinomethyl", name: "morpholin-4-ylmethyl", smiles: "CN1CCOCC1", category: "n-heterocycle", drugs: ["Gefitinib"], weight: 5, growable: false },
  { id: "piperazinylmethyl", name: "(4-methylpiperazin-1-yl)methyl", smiles: "CN1CCN(C)CC1", category: "n-heterocycle", drugs: ["Imatinib"], weight: 6, growable: false },
  { id: "thiomorpholine", name: "thiomorpholin-4-yl", smiles: "N1CCSCC1", category: "n-heterocycle", drugs: ["Thiomorpholine-containing candidates"], weight: 2, growable: false },
  { id: "dioxothiomorpholine", name: "1,1-dioxothiomorpholin-4-yl", smiles: "N1CCS(=O)(=O)CC1", category: "n-heterocycle", drugs: ["Abemaciclib-type motifs"], weight: 3, growable: false },

  // --------------------------------------------- acids and their bioisosteres
  { id: "COOH", name: "carboxy", smiles: "C(O)=O", category: "acid-bioisostere", drugs: ["Ibuprofen", "Aspirin"], weight: 8, growable: true },
  { id: "CH2COOH", name: "carboxymethyl", smiles: "CC(O)=O", category: "acid-bioisostere", drugs: ["Diclofenac"], weight: 5, growable: false },
  { id: "tetrazole", name: "1H-tetrazol-5-yl", smiles: "c1nn[nH]n1", category: "acid-bioisostere", drugs: ["Losartan", "Valsartan"], weight: 6, growable: false },
  { id: "acylsulfonamide", name: "N-(methylsulfonyl)carbamoyl", smiles: "C(=O)NS(C)(=O)=O", category: "acid-bioisostere", drugs: ["Glibenclamide-type acidic motifs"], weight: 3, growable: false },
  { id: "oxadiazolone", name: "5-oxo-1,2,4-oxadiazol-3-yl", smiles: "c1noc(=O)[nH]1", category: "acid-bioisostere", drugs: ["Azilsartan"], weight: 3, growable: false },
  { id: "hydroxamic", name: "N-hydroxycarbamoyl", smiles: "C(=O)NO", category: "acid-bioisostere", drugs: ["Vorinostat"], weight: 4, growable: false },
  { id: "phosphonate", name: "phosphono", smiles: "P(O)(O)=O", category: "acid-bioisostere", drugs: ["Alendronate", "Fosfomycin"], weight: 2, growable: false },
  { id: "sulfonicacid", name: "sulfo", smiles: "S(O)(=O)=O", category: "acid-bioisostere", drugs: ["Taurine-containing agents"], weight: 1, growable: false },
  { id: "thiazolidinedione", name: "2,4-dioxothiazolidin-5-ylmethyl", smiles: "CC1SC(=O)NC1=O", category: "acid-bioisostere", drugs: ["Pioglitazone", "Rosiglitazone"], weight: 2, growable: false },

  // ------------------------------------------------------------------- amide
  { id: "CONH2", name: "carbamoyl", smiles: "C(N)=O", category: "amide", drugs: ["Nicotinamide", "Carbamazepine"], weight: 7, growable: true },
  { id: "CONHMe", name: "N-methylcarbamoyl", smiles: "C(=O)NC", category: "amide", drugs: ["Rivastigmine"], weight: 6, growable: false },
  { id: "CONMe2", name: "N,N-dimethylcarbamoyl", smiles: "C(=O)N(C)C", category: "amide", drugs: ["Rivastigmine", "Neostigmine"], weight: 5, growable: false },
  { id: "CONHcPr", name: "N-cyclopropylcarbamoyl", smiles: "C(=O)NC1CC1", category: "amide", drugs: ["Boceprevir-type motifs"], weight: 3, growable: false },
  { id: "NHCOMe", name: "acetamido (reverse amide)", smiles: "NC(C)=O", category: "amide", drugs: ["Paracetamol"], weight: 6, growable: false },
  { id: "NHCOcPr", name: "cyclopropanecarboxamido", smiles: "NC(=O)C1CC1", category: "amide", drugs: ["Cyclopropanecarboxamide motifs"], weight: 3, growable: false },
  { id: "ester", name: "methoxycarbonyl", smiles: "C(=O)OC", category: "amide", drugs: ["Clopidogrel", "Methylphenidate"], weight: 5, growable: false },
  { id: "ethylester", name: "ethoxycarbonyl", smiles: "C(=O)OCC", category: "amide", drugs: ["Enalapril"], weight: 4, growable: false },
  { id: "urea", name: "carbamoylamino", smiles: "NC(N)=O", category: "amide", drugs: ["Sorafenib", "Hydroxyurea"], weight: 5, growable: false },
  { id: "MeUrea", name: "3-methylureido", smiles: "NC(=O)NC", category: "amide", drugs: ["Sorafenib"], weight: 4, growable: false },
  { id: "carbamate", name: "methoxycarbonylamino", smiles: "NC(=O)OC", category: "amide", drugs: ["Carbaryl-type carbamates", "Albendazole"], weight: 4, growable: false },
  { id: "acetyl", name: "acetyl", smiles: "C(C)=O", category: "amide", drugs: ["Aspirin", "Acetophenone drugs"], weight: 5, growable: true },
  { id: "benzamide", name: "benzamido", smiles: "NC(=O)c1ccccc1", category: "amide", drugs: ["Procaine-type benzamides", "Metoclopramide"], weight: 4, growable: false },

  // ---------------------------------------------------------------- sulfonyl
  { id: "SO2NH2", name: "sulfamoyl", smiles: "S(N)(=O)=O", category: "sulfonyl", drugs: ["Celecoxib", "Hydrochlorothiazide"], weight: 7, growable: false },
  { id: "SO2Me", name: "methylsulfonyl", smiles: "S(C)(=O)=O", category: "sulfonyl", drugs: ["Etoricoxib", "Rofecoxib"], weight: 7, growable: false },
  { id: "SO2NHMe", name: "N-methylsulfamoyl", smiles: "S(=O)(=O)NC", category: "sulfonyl", drugs: ["Sumatriptan"], weight: 5, growable: false },
  { id: "NHSO2Me", name: "methanesulfonamido", smiles: "NS(C)(=O)=O", category: "sulfonyl", drugs: ["Dofetilide", "Sotalol"], weight: 5, growable: false },
  { id: "SMe", name: "methylsulfanyl", smiles: "SC", category: "sulfonyl", drugs: ["Methionine-based agents", "Tiopronin"], weight: 4, growable: true },
  { id: "SOMe", name: "methylsulfinyl", smiles: "S(C)=O", category: "sulfonyl", drugs: ["Omeprazole"], weight: 4, growable: false },
  { id: "SO2cPr", name: "cyclopropylsulfonyl", smiles: "S(=O)(=O)C1CC1", category: "sulfonyl", drugs: ["Simeprevir"], weight: 3, growable: false },
  { id: "SO2Ph", name: "phenylsulfonyl", smiles: "S(=O)(=O)c1ccccc1", category: "sulfonyl", drugs: ["Sulfonyl-containing antipsychotics"], weight: 3, growable: false },

  // ---------------------------------------------------------------- nitrile
  { id: "CN", name: "cyano", smiles: "C#N", category: "nitrile", drugs: ["Citalopram", "Letrozole"], weight: 7, growable: true },
  { id: "CH2CN", name: "cyanomethyl", smiles: "CC#N", category: "nitrile", drugs: ["Tofacitinib"], weight: 4, growable: true },

  // -------------------------------------------------------- aromatic rings
  { id: "Ph", name: "phenyl", smiles: "c1ccccc1", category: "aromatic", drugs: ["Celecoxib", "Diazepam"], weight: 9, growable: false },
  { id: "4F-Ph", name: "4-fluorophenyl", smiles: "c1ccc(F)cc1", category: "aromatic", drugs: ["Atorvastatin", "Paroxetine"], weight: 7, growable: false },
  { id: "4Cl-Ph", name: "4-chlorophenyl", smiles: "c1ccc(Cl)cc1", category: "aromatic", drugs: ["Loratadine"], weight: 6, growable: false },
  { id: "4Me-Ph", name: "4-methylphenyl", smiles: "c1ccc(C)cc1", category: "aromatic", drugs: ["Celecoxib"], weight: 6, growable: false },
  { id: "4OMe-Ph", name: "4-methoxyphenyl", smiles: "c1ccc(OC)cc1", category: "aromatic", drugs: ["Tamoxifen", "Verapamil"], weight: 6, growable: false },
  { id: "4CF3-Ph", name: "4-(trifluoromethyl)phenyl", smiles: "c1ccc(C(F)(F)F)cc1", category: "aromatic", drugs: ["Fluoxetine"], weight: 5, growable: false },
  { id: "4SO2Me-Ph", name: "4-(methylsulfonyl)phenyl", smiles: "c1ccc(S(C)(=O)=O)cc1", category: "aromatic", drugs: ["Etoricoxib", "Rofecoxib"], weight: 5, growable: false },
  { id: "34diCl-Ph", name: "3,4-dichlorophenyl", smiles: "c1cc(Cl)c(Cl)cc1", category: "aromatic", drugs: ["Sertraline"], weight: 4, growable: false },
  { id: "benzyl", name: "benzyl", smiles: "Cc1ccccc1", category: "aromatic", drugs: ["Donepezil", "Bromhexine"], weight: 6, growable: false },
  { id: "pyridin2yl", name: "pyridin-2-yl", smiles: "c1ccccn1", category: "aromatic", drugs: ["Imatinib", "Loratadine"], weight: 7, growable: false },
  { id: "pyridin3yl", name: "pyridin-3-yl", smiles: "c1cccnc1", category: "aromatic", drugs: ["Nicotine-derived drugs", "Rosuvastatin"], weight: 7, growable: false },
  { id: "pyridin4yl", name: "pyridin-4-yl", smiles: "c1ccncc1", category: "aromatic", drugs: ["Sorafenib", "Amrinone"], weight: 7, growable: false },
  { id: "pyrimidin2yl", name: "pyrimidin-2-yl", smiles: "c1ccncn1", category: "aromatic", drugs: ["Imatinib", "Rosuvastatin"], weight: 6, growable: false },
  { id: "pyrimidin5yl", name: "pyrimidin-5-yl", smiles: "c1cncnc1", category: "aromatic", drugs: ["Rosuvastatin"], weight: 4, growable: false },
  { id: "pyrazin2yl", name: "pyrazin-2-yl", smiles: "c1cnccn1", category: "aromatic", drugs: ["Pyrazinamide", "Glipizide"], weight: 4, growable: false },
  { id: "pyridazin3yl", name: "pyridazin-3-yl", smiles: "c1ccnnc1", category: "aromatic", drugs: ["Cefozopran-type motifs"], weight: 3, growable: false },
  { id: "thiophen2yl", name: "thiophen-2-yl", smiles: "c1cccs1", category: "aromatic", drugs: ["Clopidogrel", "Tiotropium"], weight: 6, growable: false },
  { id: "thiophen3yl", name: "thiophen-3-yl", smiles: "c1ccsc1", category: "aromatic", drugs: ["Tiotropium"], weight: 4, growable: false },
  { id: "furan2yl", name: "furan-2-yl", smiles: "c1ccco1", category: "aromatic", drugs: ["Ranitidine", "Furosemide"], weight: 5, growable: false },
  { id: "thiazol2yl", name: "1,3-thiazol-2-yl", smiles: "c1csc(n1)", category: "aromatic", drugs: ["Ritonavir", "Meloxicam"], weight: 5, growable: false },
  { id: "thiazol5yl", name: "1,3-thiazol-5-yl", smiles: "c1ncsc1", category: "aromatic", drugs: ["Ritonavir"], weight: 4, growable: false },
  { id: "oxazol2yl", name: "1,3-oxazol-2-yl", smiles: "c1cocn1", category: "aromatic", drugs: ["Oxaprozin"], weight: 3, growable: false },
  { id: "isoxazol3yl", name: "1,2-oxazol-3-yl", smiles: "c1ccon1", category: "aromatic", drugs: ["Leflunomide", "Sulfamethoxazole"], weight: 4, growable: false },
  { id: "pyrazol1yl", name: "pyrazol-1-yl", smiles: "n1cccn1", category: "aromatic", drugs: ["Celecoxib", "Rimonabant"], weight: 5, growable: false },
  { id: "pyrazol4yl", name: "1H-pyrazol-4-yl", smiles: "c1n[nH]cc1", category: "aromatic", drugs: ["Crizotinib", "Ruxolitinib"], weight: 5, growable: false },
  { id: "imidazol1yl", name: "imidazol-1-yl", smiles: "n1ccnc1", category: "aromatic", drugs: ["Ketoconazole", "Losartan"], weight: 6, growable: false },
  { id: "imidazol4yl", name: "1H-imidazol-4-yl", smiles: "c1c[nH]cn1", category: "aromatic", drugs: ["Cimetidine", "Histamine agents"], weight: 4, growable: false },
  { id: "triazol1yl", name: "1,2,4-triazol-1-yl", smiles: "n1cncn1", category: "aromatic", drugs: ["Fluconazole", "Voriconazole"], weight: 6, growable: false },
  { id: "triazol4yl", name: "1,2,3-triazol-1-yl", smiles: "n1ccnn1", category: "aromatic", drugs: ["Cefatrizine", "Rufinamide"], weight: 4, growable: false },
  { id: "tetrazol1yl", name: "tetrazol-1-yl", smiles: "n1cnnn1", category: "aromatic", drugs: ["Cefazolin"], weight: 3, growable: false },
  { id: "pyrrol1yl", name: "pyrrol-1-yl", smiles: "n1cccc1", category: "aromatic", drugs: ["Atorvastatin"], weight: 4, growable: false },

  // ----------------------------------------------------------- fused aromatics
  { id: "indol3yl", name: "1H-indol-3-yl", smiles: "c1c[nH]c2ccccc12", category: "fused-aromatic", drugs: ["Sumatriptan", "Indomethacin"], weight: 5, growable: false },
  { id: "indol5yl", name: "1H-indol-5-yl", smiles: "c1cc2cc[nH]c2cc1", category: "fused-aromatic", drugs: ["Sumatriptan"], weight: 3, growable: false },
  { id: "benzimidazol2yl", name: "1H-benzimidazol-2-yl", smiles: "c1([nH]c2ccccc2n1)", category: "fused-aromatic", drugs: ["Omeprazole", "Albendazole"], weight: 4, growable: false },
  { id: "benzothiazol2yl", name: "1,3-benzothiazol-2-yl", smiles: "c1(sc2ccccc2n1)", category: "fused-aromatic", drugs: ["Riluzole", "Pramipexole-related"], weight: 4, growable: false },
  { id: "quinolin3yl", name: "quinolin-3-yl", smiles: "c1cnc2ccccc2c1", category: "fused-aromatic", drugs: ["Pitavastatin", "Chloroquine scaffolds"], weight: 4, growable: false },
  { id: "naphthalen2yl", name: "naphthalen-2-yl", smiles: "c1ccc2ccccc2c1", category: "fused-aromatic", drugs: ["Naproxen", "Nafcillin"], weight: 4, growable: false },
  { id: "benzofuran2yl", name: "1-benzofuran-2-yl", smiles: "c1(oc2ccccc2c1)", category: "fused-aromatic", drugs: ["Amiodarone"], weight: 3, growable: false },
  { id: "benzodioxol5yl", name: "1,3-benzodioxol-5-yl", smiles: "c1cc2OCOc2cc1", category: "fused-aromatic", drugs: ["Paroxetine", "Tadalafil"], weight: 4, growable: false },
  { id: "indazol5yl", name: "1H-indazol-5-yl", smiles: "c1cc2cn[nH]c2cc1", category: "fused-aromatic", drugs: ["Niraparib", "Pazopanib"], weight: 3, growable: false },
  { id: "pyrazolopyrimidine", name: "pyrazolo[3,4-d]pyrimidin-1-yl", smiles: "n1ncc2cncnc12", category: "fused-aromatic", drugs: ["Ibrutinib"], weight: 2, growable: false },

  // ------------------------------------------------------------- larger side chains
  { id: "sulfonylpiperazinePh", name: "4-(4-methylpiperazin-1-ylsulfonyl)phenyl", smiles: "c1ccc(S(=O)(=O)N2CCN(C)CC2)cc1", category: "sidechain", drugs: ["Sildenafil"], weight: 4, growable: false },
  { id: "aminopyrimidinyl", name: "2-(pyridin-3-yl)pyrimidin-4-ylamino", smiles: "Nc1ccnc(-c2cccnc2)n1", category: "sidechain", drugs: ["Imatinib"], weight: 3, growable: false },
  { id: "benzylpiperidine", name: "1-benzylpiperidin-4-yl", smiles: "C1CCN(Cc2ccccc2)CC1", category: "sidechain", drugs: ["Donepezil"], weight: 3, growable: false },
  { id: "phenylpiperazine", name: "4-phenylpiperazin-1-yl", smiles: "N1CCN(c2ccccc2)CC1", category: "sidechain", drugs: ["Aripiprazole", "Trazodone"], weight: 4, growable: false },
  { id: "fluorophenylpiperidine", name: "4-(4-fluorophenyl)piperidin-1-yl", smiles: "N1CCC(c2ccc(F)cc2)CC1", category: "sidechain", drugs: ["Paroxetine", "Haloperidol"], weight: 3, growable: false },
  { id: "morpholinopropyl", name: "3-(morpholin-4-yl)propoxy", smiles: "OCCCN1CCOCC1", category: "sidechain", drugs: ["Gefitinib"], weight: 3, growable: false },
  { id: "dimethylaminoethoxy", name: "2-(dimethylamino)ethoxy", smiles: "OCCN(C)C", category: "sidechain", drugs: ["Tamoxifen"], weight: 4, growable: false },
  { id: "piperidinylethoxy", name: "2-(piperidin-1-yl)ethoxy", smiles: "OCCN1CCCCC1", category: "sidechain", drugs: ["Raloxifene"], weight: 3, growable: false },
  { id: "sulfamoylphenyl", name: "4-sulfamoylphenyl", smiles: "c1ccc(S(N)(=O)=O)cc1", category: "sidechain", drugs: ["Celecoxib"], weight: 4, growable: false },
  { id: "carboxyphenyl", name: "4-carboxyphenyl", smiles: "c1ccc(C(O)=O)cc1", category: "sidechain", drugs: ["Methotrexate"], weight: 3, growable: false },
  { id: "tetrazolylphenyl", name: "2-(1H-tetrazol-5-yl)phenyl", smiles: "c1ccccc1-c1nn[nH]n1", category: "sidechain", drugs: ["Losartan", "Valsartan"], weight: 3, growable: false },
  { id: "aminothiazolyl", name: "2-aminothiazol-4-yl", smiles: "c1csc(N)n1", category: "sidechain", drugs: ["Cefotaxime", "Ceftriaxone"], weight: 3, growable: false },
  { id: "hydroxyethylamino", name: "2-hydroxyethylamino", smiles: "NCCO", category: "sidechain", drugs: ["Hydroxyzine-type motifs"], weight: 3, growable: false },
  { id: "glycine", name: "carboxymethylamino", smiles: "NCC(O)=O", category: "sidechain", drugs: ["Folate antagonists"], weight: 2, growable: false },
  { id: "prolinamide", name: "pyrrolidine-2-carboxamide", smiles: "N1CCCC1C(N)=O", category: "sidechain", drugs: ["Vildagliptin"], weight: 2, growable: false },
  { id: "methylpyrazolyl", name: "1-methylpyrazol-4-yl", smiles: "c1cn(C)nc1", category: "sidechain", drugs: ["Crizotinib"], weight: 4, growable: false },
  { id: "difluorophenyl", name: "2,4-difluorophenyl", smiles: "c1cc(F)cc(F)c1", category: "sidechain", drugs: ["Fluconazole"], weight: 3, growable: false },
  { id: "methylenedioxyphenyl", name: "benzodioxol-5-ylmethyl", smiles: "Cc1ccc2OCOc2c1", category: "sidechain", drugs: ["Paroxetine"], weight: 2, growable: false },
  { id: "cyclopropylsulfonamide", name: "cyclopropanesulfonamido", smiles: "NS(=O)(=O)C1CC1", category: "sidechain", drugs: ["Simeprevir"], weight: 2, growable: false },
  { id: "trifluoroethylamino", name: "2,2,2-trifluoroethylamino", smiles: "NCC(F)(F)F", category: "sidechain", drugs: ["Sitagliptin"], weight: 3, growable: false },
];

/**
 * Aromatic ring-walk: swap an unsubstituted aromatic C–H for a ring nitrogen, the classic
 * "nitrogen scan" used to tune basicity, solubility and metabolic stability.
 */
export interface RingSwap {
  id: string;
  name: string;
  /** Atomic number to install at the chosen aromatic C–H position. */
  atomicNo: number;
  drugs: string[];
  weight: number;
}

export const RING_SWAPS: RingSwap[] = [
  { id: "aza", name: "aza (C→N nitrogen scan)", atomicNo: 7, drugs: ["Imatinib", "Sorafenib", "Rosuvastatin"], weight: 10 },
];

export const FRAGMENTS_BY_ID = new Map(FRAGMENTS.map((f) => [f.id, f]));

export const CATEGORY_LABEL: Record<FragmentCategory, string> = {
  halogen: "Halogen / fluorine",
  alkyl: "Alkyl",
  cycloalkyl: "Cycloalkyl & small rings",
  ether: "Ether",
  alcohol: "Alcohol",
  amine: "Amine",
  "n-heterocycle": "Saturated N-heterocycle",
  "acid-bioisostere": "Acid & bioisostere",
  amide: "Amide / carbamate",
  sulfonyl: "Sulfonyl & sulfur",
  nitrile: "Nitrile",
  aromatic: "Aromatic ring",
  "fused-aromatic": "Fused aromatic",
  sidechain: "Large side chain",
};
