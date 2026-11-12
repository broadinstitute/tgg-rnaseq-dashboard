import { isBlank } from "../data/csv";
import { SOLVED_STATUSES, type RnaSample, type Row } from "../types";

/** seqr export (project, individual_id, sex, solved_status) -> individual_id -> status, solved ones only. */
export function solvedIndividuals(rows: Row[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of rows) {
    const status = (r.solved_status ?? "").trim();
    if (SOLVED_STATUSES.has(status) && !isBlank(r.individual_id)) m.set(r.individual_id, status);
  }
  return m;
}

/** RNA-seq metadata (sample_id, imputed_tissue, wgs_sample_id), from Airtable export or a user mapping file. */
export function loadRnaSamples(rows: Row[]): RnaSample[] {
  return rows
    .filter((r) => !isBlank(r.sample_id) && !isBlank(r.wgs_sample_id) && !isBlank(r.imputed_tissue))
    .map((r) => ({ sampleId: r.sample_id, tissue: r.imputed_tissue.trim().toLowerCase(), wgsSampleId: r.wgs_sample_id }));
}

export function filterSolved(rna: RnaSample[], solved: Map<string, string>): RnaSample[] {
  return rna.filter((r) => solved.has(r.wgsSampleId));
}

/** GENCODE gene map (gene_id, gene_name) -> ENSG (no version) -> symbol. */
export function loadGeneMap(rows: Row[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of rows) if (!isBlank(r.gene_id) && !isBlank(r.gene_name)) m.set(r.gene_id, r.gene_name);
  return m;
}
