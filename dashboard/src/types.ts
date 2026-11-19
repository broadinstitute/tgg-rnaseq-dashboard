export type Row = Record<string, string>;

export interface Variant {
  sample: string;
  gene: string;
  hgvsc: string;
  consequence: string;
}

export interface RnaSample {
  sampleId: string;
  tissue: string;
  wgsSampleId: string;
}

export interface FraserOutlier {
  rnaSampleId: string;
  wgsSampleId: string;
  tissue: string;
  gene: string;
  padjust: number;
  padjustText: string;
  deltaPsiText: string;
}

export interface TpmMatrix {
  /** RNA sample IDs in column order. */
  samples: string[];
  /** Gene symbol -> TPM per sample (NaN where missing). */
  genes: Map<string, number[]>;
}

export interface SolvedRow {
  Sample_ID: string;
  Solved_status: string;
  Solved_gene: string;
  hgvsc: string;
  Tissue: string;
  FRASER2_sig_outlier_count: number;
  "Seqr_tagged_variants (N>0)": number;
  Seqr_variant_consequence: string;
  TPM_in_sample: string;
  Median_TPM_in_tissue_cohort: string;
  delta_psi: string;
  "p-value": string;
  /** Which restricted gene sets the gene belongs to ("constrained; disease-associated"), or "". */
  Gene_set: string;
}

export const OUTPUT_COLUMNS: (keyof SolvedRow)[] = [
  "Sample_ID",
  "Solved_status",
  "Solved_gene",
  "hgvsc",
  "Tissue",
  "FRASER2_sig_outlier_count",
  "Seqr_tagged_variants (N>0)",
  "Seqr_variant_consequence",
  "TPM_in_sample",
  "Median_TPM_in_tissue_cohort",
  "delta_psi",
  "p-value",
  "Gene_set",
];

/** A consequence-chart segment: rows of this class with (or without) a FRASER2 outlier. */
export interface Selection { cls: string; detected: boolean }

export function matchesSelection(r: SolvedRow, sel: Selection): boolean {
  const classes = r.Seqr_variant_consequence.split(";").map((s) => s.trim()).filter(Boolean);
  const cls = classes.length ? classes : ["(no consequence)"];
  return cls.includes(sel.cls) && (r.FRASER2_sig_outlier_count > 0) === sel.detected;
}

export const SEP = "; ";
/** seqr solve-status values that count as solved for the dashboard. */
export const SOLVED_STATUSES = new Set(["Solved", "Partially solved", "Probably solved"]);
/** seqr solve-status values that count as unsolved. */
export const UNSOLVED_STATUSES = new Set(["Unsolved"]);

/** solved / unsolved: individuals with seqr-tagged variants (rows = variants).
 *  untagged: unsolved individuals with no tagged variants (rows = genes with FRASER2 outliers). */
export type Cohort = "solved" | "unsolved" | "untagged";
export const COHORT_STATUSES: Record<Cohort, Set<string>> = { solved: SOLVED_STATUSES, unsolved: UNSOLVED_STATUSES, untagged: UNSOLVED_STATUSES };
/** Columns that have no meaning for the untagged cohort (no seqr variants). */
export const VARIANT_COLUMNS: (keyof SolvedRow)[] = ["hgvsc", "Seqr_tagged_variants (N>0)", "Seqr_variant_consequence"];
/** Shown only for the untagged cohort, where the gene-set filter applies. */
export const GENE_SET_COLUMNS: (keyof SolvedRow)[] = ["Gene_set"];
export const DEFAULT_PADJ_CUTOFF = 0.05;

/** Significant FRASER2 junctions per RNA sample in a tissue's run (all genes), for ranking samples. */
export interface SampleOutlierCount {
  tissue: string;
  rnaSampleId: string;
  wgsSampleId: string | null;
  /** The sample belongs to the cohort being viewed (solved or unsolved). */
  inCohort: boolean;
  count: number;
}

/** Counts logged while building, shown to the user so ID-mapping failures are visible. */
export interface BuildStats {
  allVariantPairs: number;
  priorityVariantPairs: number;
  sharedPairs: number;
  rnaSamples: number;
  solvedRnaSamples: number;
  /** Per tissue: RNA-seq samples in the metadata, and how many belong to the cohort. */
  rnaByTissue: Record<string, { total: number; inCohort: number }>;
  fraser: Record<string, { total: number; significant: number; geneMapped: number; wgsMapped: number; perSample: Map<string, number> }>;
  rows: number;
  rowsWithOutliers: number;
  /** Distinct solved samples with at least one significant FRASER2 outlier in their solved gene. */
  samplesWithOutliers: number;
  /** imputed_tissue values among solved RNA-seq samples. */
  rnaTissues: string[];
  /** Tissue labels of FRASER2/TPM inputs that match no RNA-seq sample, or that are missing a partner table. */
  warnings: string[];
}
