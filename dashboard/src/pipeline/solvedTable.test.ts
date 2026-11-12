/** Mirrors tests/test_solved_table.py so the TypeScript port and the Python pipeline agree. */
import { describe, expect, it } from "vitest";
import { parseTable } from "../data/csv";
import { allSolved, exampleInputs, fibroTpmCsv, fraserHeader, muscleFraserTsv, muscleTpmCsv, rnaMetadataCsv } from "../example/exampleInputs";
import { parseTpmMatrix } from "./tpm";
import { buildSolvedTable } from "./solvedTable";
import { OUTPUT_COLUMNS } from "../types";

const inputs = exampleInputs;
const muscleFraser = parseTable(muscleFraserTsv);
const muscleTpm = muscleTpmCsv;

describe("buildSolvedTable", () => {
  it("builds one row per (sample, tissue, hgvsc) with tissue-specific values", () => {
    const { rows, stats } = buildSolvedTable(inputs(allSolved));
    expect(Object.keys(rows[0])).toEqual(OUTPUT_COLUMNS);

    const keys = rows.map((r) => `${r.Sample_ID}|${r.Tissue}|${r.hgvsc}`).sort();
    expect(keys).toEqual(
      [
        "ABG05|muscle|ENST1:c.1A>G", "ABG05|muscle|ENST1:c.2A>G", "ABG05|muscle|ENST2:c.9A>G",
        "ABG06|fibroblasts|ENST5:c.5A>G", "ABG06|muscle|ENST5:c.5A>G",
        "MNG01|muscle|ENST2:c.3A>G", "MNG01|muscle|ENST2:c.9A>G",
      ].sort(),
    );

    const find = (s: string, t: string, h: string) => rows.find((r) => r.Sample_ID === s && r.Tissue === t && r.hgvsc === h)!;

    // ENST1:c.2A>G is TNNI1 in all_v and TNNI1-AS1 in the priority table: both genes on one row,
    // evidence pooled across them (TNNI1-AS1 has no TPM row, so TPM lists TNNI1 only).
    const both = find("ABG05", "muscle", "ENST1:c.2A>G");
    expect(both.Solved_gene).toBe("TNNI1; TNNI1-AS1");
    expect(both["Seqr_tagged_variants (N>0)"]).toBe(2);
    expect(both.Seqr_variant_consequence).toBe("intron_variant; missense_variant; splice_donor_variant");
    expect(both.FRASER2_sig_outlier_count).toBe(2);
    expect(both.TPM_in_sample).toBe("10");

    const tnni1 = find("ABG05", "muscle", "ENST1:c.1A>G");
    expect(tnni1.Solved_gene).toBe("TNNI1");
    expect(tnni1.Solved_status).toBe("Solved");
    expect(find("MNG01", "muscle", "ENST2:c.3A>G").Solved_status).toBe("Partially solved");
    expect(find("ABG06", "muscle", "ENST5:c.5A>G").Solved_status).toBe("Probably solved");
    expect(tnni1["Seqr_tagged_variants (N>0)"]).toBe(2);
    expect(tnni1.Seqr_variant_consequence).toBe("missense_variant; splice_donor_variant");
    expect(tnni1.FRASER2_sig_outlier_count).toBe(2);
    expect(tnni1.delta_psi).toBe("-0.9; 0.4");
    expect(tnni1["p-value"]).toBe("1e-05; 0.01");
    expect(tnni1.TPM_in_sample).toBe("10");
    expect(tnni1.Median_TPM_in_tissue_cohort).toBe("30"); // median of 10, 20, 40, 50

    const samd11 = find("MNG01", "muscle", "ENST2:c.3A>G");
    expect(samd11.FRASER2_sig_outlier_count).toBe(0);
    expect(samd11.Seqr_variant_consequence).toBe("intron_variant; missense_variant");

    const ttnFib = find("ABG06", "fibroblasts", "ENST5:c.5A>G");
    expect(ttnFib.TPM_in_sample).toBe("9");
    expect(ttnFib.Median_TPM_in_tissue_cohort).toBe("9");
    const ttnMus = find("ABG06", "muscle", "ENST5:c.5A>G");
    expect(ttnMus.TPM_in_sample).toBe("10");
    expect(ttnMus.Median_TPM_in_tissue_cohort).toBe("9"); // median of 7, 8, 10, 11
    expect(ttnMus.FRASER2_sig_outlier_count).toBe(0); // DMD outliers, not TTN

    expect(stats.allVariantPairs).toBe(4);
    expect(stats.fraser.muscle).toEqual({ total: 5, significant: 4, geneMapped: 4, wgsMapped: 4 });
    expect(stats.priorityVariantPairs).toBe(5);
    expect(stats.sharedPairs).toBe(2);
    expect(stats.rowsWithOutliers).toBe(2);
    expect(stats.samplesWithOutliers).toBe(1); // both outlier rows are ABG05
    expect(stats.rnaTissues).toEqual(["fibroblasts", "muscle", "whole_blood"]);
    expect(rows.some((r) => r.Tissue === "whole_blood")).toBe(false); // no FRASER2 for whole_blood
    expect(stats.warnings).toEqual(["Omitted tissues without FRASER2 results: whole_blood."]);
  });

  it("warns about tissue labels that match nothing and about missing partner tables", () => {
    const { stats } = buildSolvedTable({ ...inputs(allSolved), fraser: { Muscle: muscleFraser }, tpm: { muscle: muscleTpm } });
    expect(stats.warnings.some((w) => w.includes('"Muscle" has FRASER2/TPM input but no solved RNA-seq sample'))).toBe(true);
    expect(stats.warnings.some((w) => w.includes('"muscle": TPM matrix given but no FRASER2'))).toBe(true);
    expect(stats.warnings.some((w) => w.includes("Omitted tissues without FRASER2 results: fibroblasts, muscle, whole_blood"))).toBe(true);
  });

  it("excludes unsolved individuals", () => {
    const { rows } = buildSolvedTable(inputs({ ABG05: "Solved", MNG01: "Unsolved", ABG06: "Solved" }));
    expect(new Set(rows.map((r) => r.Sample_ID))).toEqual(new Set(["ABG05", "ABG06"]));
  });

  it("treats blank TPM cells as missing, not zero, and merges duplicate genes ignoring NaN", () => {
    const tpm = `gene,ABG05,MNG01,ABG06_R2,OTHER
TNNI1,10,,40,50
DMD,5,,2,
DMD,,6,,
TTN,7,8,10,11
`;
    const { rows } = buildSolvedTable({ ...inputs(allSolved), tpm: { muscle: tpm, fibroblasts: fibroTpmCsv } });
    const tnni1 = rows.find((r) => r.Sample_ID === "ABG05" && r.hgvsc === "ENST1:c.1A>G")!;
    expect(tnni1.TPM_in_sample).toBe("10");
    expect(tnni1.Median_TPM_in_tissue_cohort).toBe("40"); // median of 10, 40, 50 (blank skipped)
    const samd11 = rows.find((r) => r.Sample_ID === "MNG01" && r.hgvsc === "ENST2:c.3A>G")!;
    expect(samd11.TPM_in_sample).toBe(""); // SAMD11 absent from this matrix
    // duplicate DMD rows: 5/NaN -> 5, NaN/6 -> 6, 2/NaN -> 2, NaN/NaN -> NaN
    const matrix = parseTpmMatrix(tpm);
    expect(matrix.genes.get("DMD")).toEqual([5, 6, 2, NaN]);
  });

  it("matches tissue labels case-insensitively", () => {
    const rnaUpper = rnaMetadataCsv.replace(/muscle/g, "Muscle").replace(/fibroblasts/g, "FIBROBLASTS");
    const { rows, stats } = buildSolvedTable({ ...inputs(allSolved), rnaMetadata: parseTable(rnaUpper) });
    expect(new Set(rows.map((r) => r.Tissue))).toEqual(new Set(["muscle", "fibroblasts"]));
    expect(stats.warnings.filter((w) => w.includes("no solved RNA-seq sample"))).toEqual([]);
  });

  it("fails loudly when FRASER2 uses Ensembl IDs and no gene map is available", () => {
    expect(() => buildSolvedTable({ ...inputs(allSolved), geneMap: [] })).toThrow(/no GENCODE gene map/);
  });

  it("accepts FRASER2 files that already hold gene symbols", () => {
    const symbolFraser = parseTable(fraserHeader + "chr1\t1\t2\t+\tABG05\tTNNI1\t1e-05\t-0.9\t1e-9\n");
    const { rows } = buildSolvedTable({ ...inputs(allSolved), fraser: { muscle: symbolFraser } });
    expect(rows.find((r) => r.Sample_ID === "ABG05" && r.hgvsc === "ENST1:c.1A>G")!.FRASER2_sig_outlier_count).toBe(1);
  });
});
