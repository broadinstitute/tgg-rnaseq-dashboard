import { describe, expect, it } from "vitest";
import { classifyBucketFile, classifyReleaseFile, detectKind, detectTissue } from "./detect";

describe("detectKind", () => {
  it("recognises every input by its header", () => {
    expect(detectKind("project,individual_id,sex,solved_status\np,a,F,Solved\n")).toBe("seqrMetadata");
    expect(detectKind("sample_id,imputed_tissue,wgs_sample_id\na,muscle,a\n")).toBe("rnaMetadata");
    expect(detectKind("gene_id,gene_name\nENSG1,TNNI1\n")).toBe("geneMap");
    expect(detectKind("participant_id,gene_of_interest,seqr_chosen_consequence,transcript,hgvsc\n")).toBe("allVariants");
    expect(detectKind("gene,worst_consequence,hgvsc,sample_1,sample_2\n")).toBe("priorityVariants");
    expect(detectKind("seqnames\tstart\tsampleID\thgncSymbol\tpadjust\tdeltaPsi\n")).toBe("fraser");
    expect(detectKind("gene,ABG05,MNG01\nTNNI1,1,2\n")).toBe("tpm");
    expect(detectKind("#1.2\n5\t1\nName\tDescription\tABG05\n")).toBe("tpm");
    expect(detectKind("foo,bar\n1,2\n")).toBeNull();
  });

  it("finds the tissue in a file name", () => {
    expect(detectTissue("fraser2_Muscle.csv")).toBe("muscle");
    expect(detectTissue("fraser2_whole_blood.tsv.gz")).toBe("whole_blood");
    expect(detectTissue("fibroblasts_gene_tpm.csv.gz")).toBe("fibroblasts");
    expect(detectTissue("muscle_200_samples.csv")).toBe("muscle");
    expect(detectTissue("results.csv")).toBeNull();
    expect(detectTissue("results_heart.csv", ["heart"])).toBe("heart");
  });

  it("treats every table in a release folder as FRASER2 results", () => {
    expect(classifyReleaseFile("releases/11_12_2026/muscle_200_samples.csv")).toEqual({ kind: "fraser", tissue: "muscle" });
    expect(classifyReleaseFile("releases/11_12_2026/fraser2_fibroblasts.tsv.gz")).toEqual({ kind: "fraser", tissue: "fibroblasts" });
    expect(classifyReleaseFile("releases/11_12_2026/results.csv")).toEqual({ kind: "fraser", tissue: null });
    expect(classifyReleaseFile("releases/11_12_2026/all_variants.csv")).toEqual({ kind: "allVariants", tissue: null });
    expect(classifyReleaseFile("releases/11_12_2026/README.md")).toBeNull();
  });

  it("classifies bucket objects by name", () => {
    expect(classifyBucketFile("dashboard/seqr_metadata.csv")).toEqual({ kind: "seqrMetadata" });
    expect(classifyBucketFile("dashboard/fraser2_lymphocytes.csv")).toEqual({ kind: "fraser", tissue: "lymphocytes" });
    expect(classifyBucketFile("dashboard/heart_gene_tpm.csv.gz")).toEqual({ kind: "tpm", tissue: "heart" });
    expect(classifyBucketFile("dashboard/notes.txt")).toBeNull();
  });
});
