import type { StatItem } from "./Stats";
import type { SolvedRow } from "../types";

/** Summary tiles derived from the table rows; `tissue` narrows them to one tissue ("" = all). */
export function summaryItems(allRows: SolvedRow[], tissue: string): StatItem[] {
  const rows = tissue ? allRows.filter((r) => r.Tissue === tissue) : allRows;
  const samples = new Set(rows.map((r) => r.Sample_ID));
  const withOutliers = new Set(rows.filter((r) => r.FRASER2_sig_outlier_count > 0).map((r) => r.Sample_ID));
  const tissues = [...new Set(allRows.map((r) => r.Tissue))].sort();
  const items: StatItem[] = [
    { value: withOutliers.size, label: `solved samples with FRASER2 outliers in the solved gene${tissue ? ` (${tissue})` : ""}` },
    { value: samples.size, label: `solved RNA-seq samples${tissue ? ` (${tissue})` : ""}` },
  ];
  if (!tissue) items.push({ value: tissues.length, label: `tissues: ${tissues.join(", ") || "none"}` });
  return items;
}

export function tissuesOf(rows: SolvedRow[]): string[] {
  return [...new Set(rows.map((r) => r.Tissue))].sort();
}
