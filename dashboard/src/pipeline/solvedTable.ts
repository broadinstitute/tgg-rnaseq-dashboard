import { isBlank } from "../data/csv";
import { loadFraserSignificant, fraserKey, summarizeFraser, type FraserSummary } from "./fraser";
import { filterSolved, loadGeneMap, loadRnaSamples, solvedIndividuals } from "./metadata";
import { parseTpmMatrix, tpmColumns } from "./tpm";
import { combineVariants, loadAllVariants, loadPriorityVariants, pairKey, uniquePairs } from "./variants";
import { DEFAULT_PADJ_CUTOFF, SEP, type BuildStats, type Row, type SolvedRow, type TpmMatrix } from "../types";
import { ALL_TISSUES } from "../data/detect";

export interface PipelineInputs {
  allVariants: Row[];
  priorityVariants: Row[];
  seqrMetadata: Row[];
  rnaMetadata: Row[];
  geneMap: Row[];
  /** tissue -> FRASER2 results rows (transcriptome-wide). */
  fraser: Record<string, Row[]>;
  /** tissue -> TPM matrix text (genes x samples CSV, or a .gct). */
  tpm: Record<string, string>;
  padjCutoff?: number;
}

export interface BuildResult {
  rows: SolvedRow[];
  stats: BuildStats;
}

export function buildSolvedTable(inputs: PipelineInputs): BuildResult {
  const padjCutoff = inputs.padjCutoff ?? DEFAULT_PADJ_CUTOFF;

  // seqr variants: union of both tables, one row per (sample, hgvsc, consequence)
  const allV = loadAllVariants(inputs.allVariants);
  const priorityV = loadPriorityVariants(inputs.priorityVariants);
  const pairsAll = uniquePairs(allV);
  const pairsPriority = uniquePairs(priorityV);
  const variants = combineVariants(allV, priorityV);

  // solved RNA-seq samples
  const rnaAll = loadRnaSamples(inputs.rnaMetadata);
  const solvedStatus = solvedIndividuals(inputs.seqrMetadata);
  const rna = filterSolved(rnaAll, solvedStatus);
  const solvedIds = new Set(rna.map((r) => r.wgsSampleId));
  const geneMap = loadGeneMap(inputs.geneMap);

  // A FRASER2 table labelled "all" covers every tissue: its rows are assigned to the tissue of their RNA
  // sample. A tissue-specific table, when present, takes precedence for that tissue.
  const fraserByTissue: Record<string, Row[]> = { ...inputs.fraser };
  const combined = fraserByTissue[ALL_TISSUES];
  delete fraserByTissue[ALL_TISSUES];
  if (combined) {
    const tissueOfRna = new Map(rnaAll.map((r) => [r.sampleId, r.tissue]));
    for (const t of new Set(rnaAll.map((r) => r.tissue))) {
      if (fraserByTissue[t]) continue;
      const subset = combined.filter((row) => tissueOfRna.get(row.sampleID) === t);
      if (subset.length) fraserByTissue[t] = subset;   // a tissue absent from the run stays omitted
    }
  }

  // FRASER2 per tissue
  const stats: BuildStats = {
    allVariantPairs: pairsAll.size,
    priorityVariantPairs: pairsPriority.size,
    sharedPairs: [...pairsAll].filter((k) => pairsPriority.has(k)).length,
    rnaSamples: rnaAll.length,
    solvedRnaSamples: rna.length,
    fraser: {},
    rows: 0,
    rowsWithOutliers: 0,
    samplesWithOutliers: 0,
    rnaTissues: [...new Set(rna.map((r) => r.tissue))].sort(),
    warnings: [],
  };
  const fraserTissues = Object.keys(fraserByTissue);
  const tpmTissues = Object.keys(inputs.tpm).filter((t) => inputs.tpm[t]);
  for (const t of new Set([...fraserTissues, ...tpmTissues])) {
    if (!stats.rnaTissues.includes(t)) {
      stats.warnings.push(`Tissue "${t}" has FRASER2/TPM input but no solved RNA-seq sample has imputed_tissue "${t}" (known: ${stats.rnaTissues.join(", ") || "none"}).`);
    }
    if (fraserTissues.includes(t) && !tpmTissues.includes(t)) stats.warnings.push(`Tissue "${t}": FRASER2 given but no TPM matrix; TPM columns stay blank.`);
    if (tpmTissues.includes(t) && !fraserTissues.includes(t)) stats.warnings.push(`Tissue "${t}": TPM matrix given but no FRASER2 results; its rows are omitted.`);
  }
  const outliers = Object.entries(fraserByTissue).flatMap(([tissue, rows]) => {
    const r = loadFraserSignificant(rows, tissue, rnaAll, geneMap, padjCutoff);
    stats.fraser[tissue] = r.stats;
    return r.outliers;
  });
  const fraserSummary = summarizeFraser(outliers);

  // TPM per tissue
  const matrices = new Map<string, TpmMatrix>();
  for (const [tissue, text] of Object.entries(inputs.tpm)) if (text) matrices.set(tissue, parseTpmMatrix(text));

  // per (sample, gene): the variants and consequences tagged in that gene
  const solved = variants.filter((v) => solvedIds.has(v.sample) && !isBlank(v.gene));
  const perGene = new Map<string, { hgvsc: Set<string>; consequences: Set<string> }>();
  for (const v of solved) {
    const k = pairKey(v.sample, v.gene);
    let g = perGene.get(k);
    if (!g) perGene.set(k, (g = { hgvsc: new Set(), consequences: new Set() }));
    g.hgvsc.add(v.hgvsc);
    if (!isBlank(v.consequence)) g.consequences.add(v.consequence);
  }

  // per (sample, hgvsc): genes in order of first appearance (all_v before priority_v)
  const genesByVariant = new Map<string, { sample: string; hgvsc: string; genes: string[] }>();
  for (const v of solved) {
    const k = pairKey(v.sample, v.hgvsc);
    let e = genesByVariant.get(k);
    if (!e) genesByVariant.set(k, (e = { sample: v.sample, hgvsc: v.hgvsc, genes: [] }));
    if (!e.genes.includes(v.gene)) e.genes.push(v.gene);
  }

  // tissues per solved individual; tissues without FRASER2 results are omitted entirely
  const tissuesBySample = new Map<string, Set<string>>();
  for (const r of rna) {
    if (!fraserTissues.includes(r.tissue)) continue;
    let t = tissuesBySample.get(r.wgsSampleId);
    if (!t) tissuesBySample.set(r.wgsSampleId, (t = new Set()));
    t.add(r.tissue);
  }
  const omitted = stats.rnaTissues.filter((t) => !fraserTissues.includes(t));
  if (omitted.length) stats.warnings.push(`Omitted tissues without FRASER2 results: ${omitted.join(", ")}.`);

  // one row per (sample, tissue, hgvsc). A variant the two seqr tables assign to different genes lists
  // every gene; outlier counts, junction values and consequences are pooled over those genes, and TPM
  // values are given per gene in the same order.
  const rows: SolvedRow[] = [];
  for (const { sample, hgvsc, genes } of genesByVariant.values()) {
    const hgvscAll = new Set(genes.flatMap((g) => [...perGene.get(pairKey(sample, g))!.hgvsc]));
    const consequences = new Set(genes.flatMap((g) => [...perGene.get(pairKey(sample, g))!.consequences]));
    for (const tissue of [...(tissuesBySample.get(sample) ?? [])].sort()) {
      const hits = genes.map((g) => fraserSummary.get(fraserKey(sample, tissue, g))).filter((h): h is FraserSummary => !!h);
      const tpm = genes.map((g) => tpmColumns(sample, tissue, g, rna, matrices));
      rows.push({
        Sample_ID: sample,
        Solved_status: solvedStatus.get(sample) ?? "",
        Solved_gene: genes.join(SEP),
        hgvsc,
        Tissue: tissue,
        FRASER2_sig_outlier_count: hits.reduce((n, h) => n + h.count, 0),
        "Seqr_tagged_variants (N>0)": hgvscAll.size,
        Seqr_variant_consequence: [...consequences].sort().join(SEP),
        TPM_in_sample: tpm.map((t) => t.inSample).filter(Boolean).join(SEP),
        Median_TPM_in_tissue_cohort: tpm.map((t) => t.cohortMedian).filter(Boolean).join(SEP),
        delta_psi: hits.map((h) => h.deltaPsi).join(SEP),
        "p-value": hits.map((h) => h.pValue).join(SEP),
      });
    }
  }

  rows.sort(
    (a, b) =>
      a.Sample_ID.localeCompare(b.Sample_ID) ||
      a.Tissue.localeCompare(b.Tissue) ||
      a.Solved_gene.localeCompare(b.Solved_gene) ||
      a.hgvsc.localeCompare(b.hgvsc),
  );
  stats.rows = rows.length;
  stats.rowsWithOutliers = rows.filter((r) => r.FRASER2_sig_outlier_count > 0).length;
  stats.samplesWithOutliers = new Set(rows.filter((r) => r.FRASER2_sig_outlier_count > 0).map((r) => r.Sample_ID)).size;
  return { rows, stats };
}
