import { describe, expect, it } from "vitest";
import { consequenceCounts } from "./ConsequenceBar";
import { buildSolvedTable } from "../pipeline/solvedTable";
import { exampleInputs } from "../example/exampleInputs";

describe("consequenceCounts", () => {
  it("counts sample × variant within a tissue, under every listed class, splice classes first", () => {
    const { rows } = buildSolvedTable(exampleInputs());
    const counts = consequenceCounts(rows.filter((r) => r.Tissue === "muscle"));
    const by = Object.fromEntries(counts.map((c) => [c.cls, c]));
    // ABG05 ENST1:c.1A>G and c.2A>G (TNNI1, detected) carry missense + splice_donor; c.2A>G also intron via TNNI1-AS1
    expect(by.splice_donor_variant).toMatchObject({ detected: 2, missed: 0 });
    expect(by.splice_donor_variant.detectedWho.sort()).toEqual(["ABG05 ENST1:c.1A>G", "ABG05 ENST1:c.2A>G"]);
    expect(by.missense_variant.detected).toBe(2);           // ABG05's two TNNI1 variants
    expect(by.missense_variant.missed).toBe(2);             // MNG01's two SAMD11 variants
    // ABG06 TTN: one variant in muscle; its fibroblast row belongs to the other panel
    expect(by.frameshift_variant).toMatchObject({ detected: 0, missed: 1, missedWho: ["ABG06 ENST5:c.5A>G"] });
    const fibro = consequenceCounts(rows.filter((r) => r.Tissue === "fibroblasts"));
    expect(fibro).toHaveLength(1);
    expect(fibro[0]).toMatchObject({ cls: "frameshift_variant", detected: 0, missed: 1 });
    expect(counts[0].cls).toBe("splice_donor_variant");
  });
});
