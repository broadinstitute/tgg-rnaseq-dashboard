/** Small synthetic inputs used by the preview page and the unit tests. */
import { parseTable } from "../data/csv";
import type { PipelineInputs } from "../pipeline/solvedTable";

export const allVariantsCsv = `participant_id,gene_of_interest,seqr_chosen_consequence,transcript,hgvsc,extra
ABG05,TNNI1,missense_variant,ENST1,c.1A>G,1
ABG05,TNNI1,splice_donor_variant,ENST1,c.2A>G,1
MNG01,SAMD11,missense_variant,ENST2,c.3A>G,1
ZZZ,G,x,ENST3,c.4A>G,1
ABG06,DMD,,ENST4,,1
`;

// num_samples_with_variant contains "sample_" but is not a sample column and must not be melted
export const priorityVariantsCsv = `gene,worst_consequence,hgvsc,sample_1,sample_2,sample_3,num_samples_with_variant,other
TNNI1,missense_variant,ENST1:c.1A>G,ABG05,,,3,0
SAMD11,intron_variant,ENST2:c.9A>G,MNG01,,ABG05,1,0
TTN,frameshift_variant,ENST5:c.5A>G,ABG06,,,2,0
TNNI1-AS1,intron_variant,ENST1:c.2A>G,ABG05,,,1,0
`;

export const rnaMetadataCsv = `sample_id,imputed_tissue,wgs_sample_id,junk
ABG05,muscle,ABG05,1
MNG01,muscle,MNG01,1
ABG06_R1,fibroblasts,ABG06,1
ABG06_R2,muscle,ABG06,1
OTHER,muscle,OTHER,1
ABG05_B,whole_blood,ABG05,1
`;

export function seqrMetadataCsv(statuses: Record<string, string>): string {
  return (
    "project,individual_id,sex,solved_status\n" +
    Object.entries(statuses).map(([id, s]) => `p1,${id},F,${s}`).join("\n") + "\n"
  );
}

export const allSolved = { ABG05: "Solved", MNG01: "Partially solved", ABG06: "Probably solved", OTHER: "Unsolved", ZZZ: "Solved" };

export const geneMapCsv = `gene_id,gene_name
ENSG1,TNNI1
ENSG2,SAMD11
ENSG4,DMD
ENSG5,TTN
`;

export const fraserHeader = "seqnames\tstart\tend\tstrand\tsampleID\thgncSymbol\tpadjust\tdeltaPsi\tpValue\n";

export const muscleFraserTsv =
  fraserHeader +
  "chr1\t1\t2\t+\tABG05\tENSG1\t1e-05\t-0.9\t1e-9\n" +
  "chr1\t3\t4\t+\tABG05\tENSG1\t0.01\t0.4\t1e-4\n" +
  "chr1\t5\t6\t+\tABG05\tENSG1\t0.5\t0.1\t0.1\n" + // not significant
  "chr1\t7\t8\t+\tMNG01\tENSG5\t0.001\t0.3\t1e-6\n" + // gene without seqr variant
  "chr1\t9\t10\t+\tABG06_R2\tENSG4\t0.02\t-0.5\t1e-3\n";

export const fibroFraserTsv = fraserHeader + "chrX\t1\t2\t+\tABG06_R1\tENSG4\t0.03\t-0.6\t1e-3\n";

// genes x samples matrices (what export_dashboard_inputs.py writes); DMD duplicated like a PAR_Y copy
export const muscleTpmCsv = `gene,ABG05,MNG01,ABG06_R2,OTHER
TNNI1,10,20,40,50
SAMD11,1,2,4,5
DMD,5,6,2,100
TTN,7,8,10,11
DMD,0,0,0,0
`;

export const fibroTpmCsv = `gene,ABG06_R1
TNNI1,30
SAMD11,3
DMD,1
TTN,9
DMD,0
`;

export function exampleInputs(statuses: Record<string, string> = allSolved): PipelineInputs {
  return {
    allVariants: parseTable(allVariantsCsv),
    priorityVariants: parseTable(priorityVariantsCsv),
    seqrMetadata: parseTable(seqrMetadataCsv(statuses)),
    rnaMetadata: parseTable(rnaMetadataCsv),
    geneMap: parseTable(geneMapCsv),
    fraser: { muscle: parseTable(muscleFraserTsv), fibroblasts: parseTable(fibroFraserTsv) },
    tpm: { muscle: muscleTpmCsv, fibroblasts: fibroTpmCsv },
  };
}
