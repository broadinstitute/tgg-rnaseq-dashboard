import { isBlank } from "../data/csv";
import type { Row, Variant } from "../types";

/** All_Variant_Metadata export -> sample, gene, hgvsc (transcript:hgvsc), consequence. */
export function loadAllVariants(rows: Row[]): Variant[] {
  return rows.map((r) => ({
    sample: r.participant_id ?? "",
    gene: r.gene_of_interest ?? "",
    hgvsc: isBlank(r.transcript) || isBlank(r.hgvsc) ? "" : `${r.transcript}:${r.hgvsc}`,
    consequence: r.seqr_chosen_consequence ?? "",
  }));
}

/** Analyst high-priority variants (wide, one sample_* column per carrier) -> one row per sample. */
export function loadPriorityVariants(rows: Row[]): Variant[] {
  if (!rows.length) return [];
  const sampleCols = Object.keys(rows[0]).filter(
    (c) => /^sample_\d+$/.test(c) && rows.some((r) => !isBlank(r[c])), // sample_1, sample_2, …
  );
  const out: Variant[] = [];
  for (const r of rows) {
    if (isBlank(r.gene)) continue;
    for (const c of sampleCols) {
      if (isBlank(r[c])) continue;
      out.push({ sample: r[c], gene: r.gene, hgvsc: r.hgvsc ?? "", consequence: r.worst_consequence ?? "" });
    }
  }
  return out;
}

export function pairKey(sample: string, hgvsc: string): string {
  return `${sample}\u0000${hgvsc}`;
}

export function uniquePairs(variants: Variant[]): Set<string> {
  const s = new Set<string>();
  for (const v of variants) if (!isBlank(v.sample) && !isBlank(v.hgvsc)) s.add(pairKey(v.sample, v.hgvsc));
  return s;
}

/** Union of both seqr tables; rows with a missing sample or hgvsc are dropped. */
export function combineVariants(allV: Variant[], priorityV: Variant[]): Variant[] {
  return [...allV, ...priorityV].filter((v) => !isBlank(v.sample) && !isBlank(v.hgvsc));
}
