/** Recognise which pipeline input a file is from its header, so users never label files. */

export type InputKind =
  | "seqrMetadata" | "rnaMetadata" | "geneMap" | "allVariants" | "priorityVariants" | "fraser" | "tpm";

export const KIND_LABELS: Record<InputKind, string> = {
  seqrMetadata: "seqr metadata",
  rnaMetadata: "RNA-seq metadata",
  geneMap: "GENCODE gene map",
  allVariants: "seqr all variants",
  priorityVariants: "seqr priority variants",
  fraser: "FRASER2 results",
  tpm: "TPM matrix",
};

export const REQUIRED_KINDS: InputKind[] = ["seqrMetadata", "rnaMetadata", "allVariants", "priorityVariants"];
export const PER_TISSUE_KINDS: InputKind[] = ["fraser", "tpm"];

export function headerColumns(text: string): string[] {
  const firstLine = text.startsWith("#1.2") ? text.split("\n")[2] ?? "" : text.split("\n")[0] ?? "";
  const sep = firstLine.includes("\t") ? "\t" : ",";
  return firstLine.split(sep).map((c) => c.trim().replace(/^"|"$/g, ""));
}

export function detectKind(text: string): InputKind | null {
  if (text.startsWith("#1.2")) return "tpm"; // RNA-SeQC .gct
  const cols = new Set(headerColumns(text));
  const has = (...names: string[]) => names.every((n) => cols.has(n));

  if (has("solved_status", "individual_id")) return "seqrMetadata";
  if (has("sample_id", "wgs_sample_id")) return "rnaMetadata";
  if (has("gene_id", "gene_name")) return "geneMap";
  if (has("participant_id", "gene_of_interest")) return "allVariants";
  if (has("worst_consequence", "hgvsc") && [...cols].some((c) => /^sample_\d+$/.test(c))) return "priorityVariants";
  if (has("sampleID", "padjust", "deltaPsi")) return "fraser";
  if (cols.has("gene") && cols.size > 1 && !has("hgvsc")) return "tpm"; // genes x samples matrix export
  return null;
}

/** Tissue labels commonly seen in imputed_tissue; used only to guess from file names. */
const COMMON_TISSUES = ["muscle", "fibroblasts", "whole_blood", "blood", "lymphocytes", "ipsc", "skin"];

const FRASER_NAME = /^fraser2?[_-](.+?)\.(csv|tsv|txt)(\.gz)?$/i;
const TPM_NAME = /^(.+?)[_-]gene[_-]tpm\.(csv|tsv|txt)(\.gz)?$/i;

/** Tissue named in a file name: "fraser2_muscle.csv" -> "muscle", "fibroblasts_gene_tpm.csv.gz" -> "fibroblasts".
 *  Falls back to any known tissue word in the name, else null (the user types it). */
export function detectTissue(fileName: string, known: string[] = []): string | null {
  const base = fileName.split("/").pop() ?? fileName;
  const m = FRASER_NAME.exec(base) ?? TPM_NAME.exec(base);
  if (m) return m[1].toLowerCase();
  const lower = base.toLowerCase();
  return [...known, ...COMMON_TISSUES].find((t) => lower.includes(t.toLowerCase())) ?? null;
}

const FIXED_BUCKET_FILES: Record<string, InputKind> = {
  "seqr_metadata.csv": "seqrMetadata",
  "rnaseq_metadata.csv": "rnaMetadata",
  "gene_map.csv": "geneMap",
  "all_variants.csv": "allVariants",
  "priority_variants.csv": "priorityVariants",
};

/** Recognise a bucket object by the names export_dashboard_inputs.py writes; per-tissue files are open-ended. */
export function classifyBucketFile(objectName: string): { kind: InputKind; tissue?: string } | null {
  const base = objectName.split("/").pop() ?? objectName;
  const fixed = FIXED_BUCKET_FILES[base];
  if (fixed) return { kind: fixed };
  const f = FRASER_NAME.exec(base);
  if (f) return { kind: "fraser", tissue: f[1].toLowerCase() };
  const t = TPM_NAME.exec(base);
  if (t) return { kind: "tpm", tissue: t[1].toLowerCase() };
  return null;
}

const TABLE_NAME = /\.(csv|tsv|txt)(\.gz)?$/i;

/** In a release folder every table is a FRASER2 result unless it has a fixed name; the tissue comes from the
 *  file name when it says (muscle_200_samples.csv -> muscle) and is otherwise left for the user to pick. */
export const ALL_TISSUES = "all";

export function classifyReleaseFile(objectName: string, known: string[] = []): { kind: InputKind; tissue: string | null } | null {
  const base = objectName.split("/").pop() ?? objectName;
  const fixed = FIXED_BUCKET_FILES[base];
  if (fixed) return { kind: fixed, tissue: null };
  if (base.startsWith("solved_table")) return null;   // tables the page saved back; not an input
  if (!TABLE_NAME.test(base)) return null;
  return { kind: "fraser", tissue: detectTissue(base, known) };
}
