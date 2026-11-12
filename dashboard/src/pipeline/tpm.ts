import Papa from "papaparse";
import { isBlank } from "../data/csv";
import { SEP, type RnaSample, type TpmMatrix } from "../types";

/** Parse a genes x samples TPM matrix: first column gene symbol, one column per RNA sample.
 *  Also accepts a single-sample RNA-SeQC .gct (Name, Description, <sample>) for convenience. */
export function parseTpmMatrix(text: string): TpmMatrix {
  let body = text;
  if (text.startsWith("#1.2")) body = text.split("\n").slice(2).join("\n"); // gct header lines
  const parsed = Papa.parse<string[]>(body, { skipEmptyLines: "greedy" });
  const rows = parsed.data;
  if (!rows.length) return { samples: [], genes: new Map() };

  const header = rows[0];
  const isGct = header[0] === "Name" && header[1] === "Description";
  const geneCol = isGct ? 1 : 0;
  const firstSampleCol = isGct ? 2 : 1;
  const samples = header.slice(firstSampleCol);

  const genes = new Map<string, number[]>();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const gene = r[geneCol];
    if (isBlank(gene)) continue;
    // blank cells are missing values (pandas writes NaN as ""), never zero
    const values = samples.map((_, j) => (isBlank(r[firstSampleCol + j]) ? NaN : Number(r[firstSampleCol + j])));
    const prev = genes.get(gene);
    // A few symbols occur more than once (e.g. PAR_Y copies); keep the highest TPM per sample, ignoring NaN.
    genes.set(gene, prev ? prev.map((p, j) => nanMax(p, values[j])) : values);
  }
  return { samples, genes };
}

function nanMax(a: number, b: number): number {
  if (isNaN(a)) return b;
  if (isNaN(b)) return a;
  return Math.max(a, b);
}

export function median(values: number[]): number {
  const v = values.filter((x) => !isNaN(x)).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** TPM of the gene in this individual's RNA sample(s) of the tissue, and the median over the tissue cohort. */
export function tpmColumns(
  wgsSampleId: string,
  tissue: string,
  gene: string,
  rna: RnaSample[],
  matrices: Map<string, TpmMatrix>,
): { inSample: string; cohortMedian: string } {
  const matrix = matrices.get(tissue);
  const values = matrix?.genes.get(gene);
  if (!matrix || !values) return { inSample: "", cohortMedian: "" };

  const inSample: string[] = [];
  for (const r of rna) {
    if (r.wgsSampleId !== wgsSampleId || r.tissue !== tissue) continue;
    const j = matrix.samples.indexOf(r.sampleId);
    if (j >= 0 && !isNaN(values[j])) inSample.push(String(values[j]));
  }
  const med = median(values);
  return { inSample: inSample.join(SEP), cohortMedian: isNaN(med) ? "" : String(med) };
}
