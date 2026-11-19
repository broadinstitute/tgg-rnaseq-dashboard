import { isBlank } from "../data/csv";
import { SEP, type FraserOutlier, type RnaSample, type Row } from "../types";

export interface FraserLoadStats {
  total: number;
  significant: number;
  geneMapped: number;
  wgsMapped: number;
  /** RNA sample -> number of significant junctions (all genes), for the sample ranking chart. */
  perSample: Map<string, number>;
}

/** Significant FRASER2 outliers for one tissue with gene symbol, WGS ID and tissue attached. */
export function loadFraserSignificant(
  rows: Row[],
  tissue: string,
  rna: RnaSample[],
  geneMap: Map<string, string>,
  padjCutoff: number,
): { outliers: FraserOutlier[]; stats: FraserLoadStats } {
  const rnaToWgs = new Map(rna.map((r) => [r.sampleId, r.wgsSampleId]));
  const stats: FraserLoadStats = { total: rows.length, significant: 0, geneMapped: 0, wgsMapped: 0, perSample: new Map() };

  // hgncSymbol may hold ENSG IDs (map through GENCODE) or already be symbols.
  const ensgShare = rows.filter((r) => (r.hgncSymbol ?? "").trim().startsWith("ENSG")).length / Math.max(rows.length, 1);
  const useMap = ensgShare > 0.5;
  if (useMap && geneMap.size === 0) {
    throw new Error(
      `FRASER2 results for ${tissue} use Ensembl gene IDs but no GENCODE gene map is available. ` +
      "Put gene_map.csv next to the page (export_dashboard_inputs.py does this), in the bucket folder, or drop it here.",
    );
  }

  const outliers: FraserOutlier[] = [];
  for (const r of rows) {
    const padjust = Number(r.padjust);
    if (!(padjust < padjCutoff)) continue; // NaN also fails
    stats.significant++;
    stats.perSample.set(r.sampleID, (stats.perSample.get(r.sampleID) ?? 0) + 1);

    // A junction overlapping several genes carries them joined by ";" (or ","); count it under each.
    const genes = splitGenes(r.hgncSymbol ?? "")
      .map((g) => (useMap ? geneMap.get(g.replace(/\.\d+$/, "")) ?? "" : g))
      .filter((g) => !isBlank(g));
    if (genes.length) stats.geneMapped++;
    const wgs = rnaToWgs.get(r.sampleID) ?? "";
    if (!isBlank(wgs)) stats.wgsMapped++;
    if (!genes.length || isBlank(wgs)) continue;

    for (const gene of new Set(genes)) {
      outliers.push({
        rnaSampleId: r.sampleID,
        wgsSampleId: wgs,
        tissue,
        gene,
        padjust,
        padjustText: r.padjust,
        deltaPsiText: r.deltaPsi ?? "",
      });
    }
  }
  return { outliers, stats };
}

export function splitGenes(value: string): string[] {
  return value.split(/[;,]/).map((g) => g.trim()).filter(Boolean);
}

export interface FraserSummary {
  count: number;
  deltaPsi: string;
  pValue: string;
}

export function fraserKey(wgs: string, tissue: string, gene: string): string {
  return `${wgs}\u0000${tissue}\u0000${gene}`;
}

/** Per (wgs, tissue, gene): outlier count and deltaPsi / padjust of every outlier, most significant first. */
export function summarizeFraser(outliers: FraserOutlier[]): Map<string, FraserSummary> {
  const groups = new Map<string, FraserOutlier[]>();
  for (const o of outliers) {
    const k = fraserKey(o.wgsSampleId, o.tissue, o.gene);
    const g = groups.get(k);
    if (g) g.push(o);
    else groups.set(k, [o]);
  }
  const out = new Map<string, FraserSummary>();
  for (const [k, g] of groups) {
    g.sort((a, b) => a.padjust - b.padjust);
    out.set(k, {
      count: g.length,
      deltaPsi: g.map((o) => o.deltaPsiText).join(SEP),
      pValue: g.map((o) => o.padjustText).join(SEP),
    });
  }
  return out;
}
