import Papa from "papaparse";
import type { Row } from "../types";

/** Parse delimited text (comma or tab, auto-detected) into string rows keyed by header. */
export function parseTable(text: string): Row[] {
  const result = Papa.parse<Row>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
  // ragged rows are tolerated; anything else (unterminated quote, undetectable delimiter) is a real error
  const real = result.errors.find((e) => e.code !== "TooFewFields" && e.code !== "TooManyFields");
  if (real) throw new Error(`CSV parse error: ${real.message}${real.row !== undefined ? ` (row ${real.row})` : ""}`);
  return result.data;
}

export function toTsv<T extends object>(columns: (keyof T & string)[], rows: T[]): string {
  const lines = [columns.join("\t")];
  for (const r of rows) lines.push(columns.map((c) => String((r as Record<string, unknown>)[c] ?? "")).join("\t"));
  return lines.join("\n") + "\n";
}

export function isBlank(v: string | undefined | null): boolean {
  return v === undefined || v === null || v.trim() === "" || v === "NA" || v === "NaN";
}
