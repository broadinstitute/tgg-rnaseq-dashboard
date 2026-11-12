import React, { useMemo, useState } from "react";
import { toTsv } from "../data/csv";
import { matchesSelection, OUTPUT_COLUMNS, type Selection, type SolvedRow } from "../types";

/** Short header labels; the full column name (as in the TSV) is shown as a tooltip. */
const LABELS: Record<keyof SolvedRow, string> = {
  Sample_ID: "Sample",
  Solved_status: "Status",
  Solved_gene: "Gene",
  hgvsc: "HGVSc",
  Tissue: "Tissue",
  FRASER2_sig_outlier_count: "# FRASER2 outliers",
  "Seqr_tagged_variants (N>0)": "# seqr variants",
  Seqr_variant_consequence: "Consequence",
  TPM_in_sample: "TPM",
  Median_TPM_in_tissue_cohort: "Median TPM",
  delta_psi: "ΔPSI",
  "p-value": "Padj",
};

/** Column widths as a share of the table; text-heavy columns get the room, number lists stay compact. */
const WIDTHS: Record<keyof SolvedRow, number> = {
  Sample_ID: 9, Solved_status: 7, Solved_gene: 8, hgvsc: 15, Tissue: 7,
  FRASER2_sig_outlier_count: 7, "Seqr_tagged_variants (N>0)": 7, Seqr_variant_consequence: 13,
  TPM_in_sample: 7, Median_TPM_in_tissue_cohort: 7, delta_psi: 7, "p-value": 7,
};

const NUMERIC: Set<keyof SolvedRow> = new Set(["FRASER2_sig_outlier_count", "Seqr_tagged_variants (N>0)"]);
const TPM: Set<keyof SolvedRow> = new Set(["TPM_in_sample", "Median_TPM_in_tissue_cohort"]);
const NOWRAP: Set<keyof SolvedRow> = new Set(["Sample_ID", "Solved_status", "Solved_gene", "Tissue"]);

/** Compact display of semicolon-separated numbers: ΔPSI to 2 decimals, padj to 2 significant digits. */
function formatList(value: string, fmt: (n: number) => string): string {
  return value
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => (!isNaN(Number(p)) ? fmt(Number(p)) : p))
    .join("; ");
}
const fmtTpm = (n: number) => n.toFixed(2);
const fmtDeltaPsi = (n: number) => n.toFixed(2);
const fmtPadj = (n: number) => (n === 0 ? "0" : n >= 0.001 ? n.toPrecision(2) : n.toExponential(1));

const ONE_PER_LINE: Set<keyof SolvedRow> = new Set(["delta_psi", "p-value", "TPM_in_sample", "Median_TPM_in_tissue_cohort"]);

function display(c: keyof SolvedRow, v: string | number): React.ReactNode {
  const s = String(v);
  let text = s;
  if (TPM.has(c)) text = formatList(s, fmtTpm);
  else if (c === "delta_psi") text = formatList(s, fmtDeltaPsi);
  else if (c === "p-value") text = formatList(s, fmtPadj);
  if (ONE_PER_LINE.has(c) && text.includes(";")) {
    return text.split(";").map((p, i) => <div key={i} className="nowrap">{p.trim()}</div>);
  }
  return text;
}

const WRAP: Set<keyof SolvedRow> = new Set(["Seqr_variant_consequence", "delta_psi", "p-value"]);

interface Props { rows: SolvedRow[]; tissue: string; selection: Selection | null; onClearSelection: () => void }

export default function SolvedTable({ rows, tissue, selection, onClearSelection }: Props) {
  const [filter, setFilter] = useState("");
  const [minCount, setMinCount] = useState<Partial<Record<keyof SolvedRow, number>>>({});
  const [outliers, setOutliers] = useState<"" | "zero" | "nonzero">("");
  const [statusFilter, setStatusFilter] = useState("");
  const statuses = useMemo(() => [...new Set(rows.map((r) => r.Solved_status))].filter(Boolean).sort(), [rows]);
  const [sort, setSort] = useState<{ col: keyof SolvedRow; dir: 1 | -1 } | null>(null);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    let out = rows.filter(
      (r) =>
        (!tissue || r.Tissue === tissue) &&
        (!selection || matchesSelection(r, selection)) &&
        (!statusFilter || r.Solved_status === statusFilter) &&
        (outliers === "" || (outliers === "zero") === (r.FRASER2_sig_outlier_count === 0)) &&
        [...NUMERIC].every((c) => c === "FRASER2_sig_outlier_count" || minCount[c] === undefined || (r[c] as number) >= minCount[c]!) &&
        (!q || OUTPUT_COLUMNS.some((c) => String(r[c]).toLowerCase().includes(q))),
    );
    // Rows stay grouped by sample; the chosen sort orders samples (when sorting by Sample) or rows within a sample.
    const cmp = (col: keyof SolvedRow, dir: 1 | -1) => (a: SolvedRow, b: SolvedRow) => {
      const x = a[col], y = b[col];
      if (typeof x === "number" && typeof y === "number") return (x - y) * dir;
      return String(x).localeCompare(String(y), undefined, { numeric: true }) * dir;
    };
    const bySample = cmp("Sample_ID", sort?.col === "Sample_ID" ? sort.dir : 1);
    const within = sort && sort.col !== "Sample_ID" ? cmp(sort.col, sort.dir) : cmp("Tissue", 1);
    out.sort((a, b) => bySample(a, b) || within(a, b));
    return out;
  }, [rows, filter, tissue, selection, statusFilter, minCount, outliers, sort]);

  const download = () => {
    const blob = new Blob([toTsv(OUTPUT_COLUMNS, visible)], { type: "text/tab-separated-values" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "solved_table.tsv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
  };

  const toggleSort = (col: keyof SolvedRow) =>
    setSort((s) => (s && s.col === col ? (s.dir === 1 ? { col, dir: -1 } : null) : { col, dir: 1 }));

  return (
    <section className="card">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Solved table</h2>
        <div className="row">
          {selection && (
            <span className="chip sel">
              {selection.cls.replace(/_variant$/, "").replace(/_/g, " ")} · {selection.detected ? "with" : "without"} outlier
              <button className="link" onClick={onClearSelection} title="Clear">✕</button>
            </span>
          )}
          <input
            type="text" placeholder="filter rows…" value={filter} onChange={(e) => setFilter(e.target.value)}
            style={{ width: 240 }}
          />
          <span className="muted small">{visible.length} of {rows.length} rows</span>
          <button onClick={download} disabled={!visible.length}>Download TSV</button>
        </div>
      </div>
      <div className="table-wrap">
        <table style={{ tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: "3%" }} />
            {OUTPUT_COLUMNS.map((c) => <col key={c} style={{ width: `${WIDTHS[c]}%` }} />)}
          </colgroup>
          <thead>
            <tr>
              <th className="idx" />
              {OUTPUT_COLUMNS.map((c) => (
                <th key={c} onClick={() => toggleSort(c)} title={c} className={NUMERIC.has(c) ? "num" : undefined}>
                  {LABELS[c]}
                  {sort?.col === c && <span className="dir">{sort.dir === 1 ? "▲" : "▼"}</span>}
                  {c === "Solved_status" && (
                    <select
                      className="header-filter" value={statusFilter} title="Filter by solved status"
                      onClick={(e) => e.stopPropagation()} onChange={(e) => setStatusFilter(e.target.value)}
                    >
                      <option value="">all</option>
                      {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  )}
                  {c === "FRASER2_sig_outlier_count" && (
                    <select
                      className="header-filter" value={outliers} title="Filter by outlier count"
                      onClick={(e) => e.stopPropagation()} onChange={(e) => setOutliers(e.target.value as "" | "zero" | "nonzero")}
                    >
                      <option value="">all</option>
                      <option value="nonzero">non-zero</option>
                      <option value="zero">zero</option>
                    </select>
                  )}
                  {NUMERIC.has(c) && c !== "FRASER2_sig_outlier_count" && (
                    <span className="header-filter min" onClick={(e) => e.stopPropagation()} title="Show rows with at least this many">
                      ≥{" "}
                      <input
                        type="number" min="0" step="1" value={minCount[c] ?? ""}
                        onChange={(e) => setMinCount({ ...minCount, [c]: e.target.value === "" ? undefined : Number(e.target.value) })}
                      />
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((r, i) => {
              const first = i === 0 || visible[i - 1].Sample_ID !== r.Sample_ID;
              let span = 1;
              if (first) while (i + span < visible.length && visible[i + span].Sample_ID === r.Sample_ID) span++;
              return (
                <tr key={i} className={first ? "group-start" : undefined}>
                  <td className="idx">{i + 1}</td>
                  {OUTPUT_COLUMNS.map((c) => {
                    if (c === "Sample_ID" || c === "Solved_status") {
                      return first ? <td key={c} rowSpan={span} className={c === "Sample_ID" ? "group" : "group-status"}>{r[c]}</td> : null;
                    }
                    return (
                      <td key={c} className={NUMERIC.has(c) ? "num" : NOWRAP.has(c) ? "nowrap" : WRAP.has(c) ? "wrap" : undefined}>
                        {display(c, r[c])}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
