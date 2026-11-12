/** Local preview of the result section, exactly as App renders it after a build, on a solved_table.csv
 *  written by the Python pipeline. Open http://localhost:5173/preview.html with `npm run dev`.
 *
 *  Default file: <DATA_DIR>/solved_table.csv, read through the dev server's /@fs/ route (never bundled).
 *  Override with ?file=/absolute/path/to/table.tsv, or drop a file onto the page. */
import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import ConsequenceBar from "./components/ConsequenceBar";
import SolvedTable from "./components/SolvedTable";
import Stats from "./components/Stats";
import TissueSelect from "./components/TissueSelect";
import { summaryItems, tissuesOf } from "./components/summary";
import { parseTable } from "./data/csv";
import { fileToText } from "./data/gcs";
import { OUTPUT_COLUMNS, type Row, type Selection, type SolvedRow } from "./types";
import "./styles.css";

const DEFAULT_FILE = `${__DATA_DIR__}/solved_table.csv`;

function toSolvedRows(rows: Row[]): SolvedRow[] {
  const missing = OUTPUT_COLUMNS.filter((c) => rows.length && !(c in rows[0]) && c !== "Solved_status");
  if (missing.length) throw new Error(`Table is missing columns: ${missing.join(", ")}`);
  return rows.map((r) => ({
    Sample_ID: r.Sample_ID,
    Solved_status: r.Solved_status ?? "",
    Solved_gene: r.Solved_gene,
    hgvsc: r.hgvsc,
    Tissue: r.Tissue,
    FRASER2_sig_outlier_count: Number(r.FRASER2_sig_outlier_count) || 0,
    "Seqr_tagged_variants (N>0)": Number(r["Seqr_tagged_variants (N>0)"]) || 0,
    Seqr_variant_consequence: r.Seqr_variant_consequence ?? "",
    TPM_in_sample: r.TPM_in_sample ?? "",
    Median_TPM_in_tissue_cohort: r.Median_TPM_in_tissue_cohort ?? "",
    delta_psi: r.delta_psi ?? "",
    "p-value": r["p-value"] ?? "",
  }));
}

function Preview() {
  const file = new URLSearchParams(location.search).get("file") ?? DEFAULT_FILE;
  const [rows, setRows] = useState<SolvedRow[] | null>(null);
  const [source, setSource] = useState(file);
  const [error, setError] = useState("");
  const [tissue, setTissue] = useState("");
  const [selection, setSelection] = useState<Selection | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const select = (s: Selection | null) => { setSelection(s); if (s) tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); };

  useEffect(() => {
    fetch(`/@fs${file}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        setRows(toSolvedRows(parseTable(await r.text())));
      })
      .catch((e) => setError(`Could not read ${file}: ${(e as Error).message}. Run main.py first, pass ?file=/abs/path, or drop a table here.`));
  }, [file]);

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (!f) return;
    try {
      setRows(toSolvedRows(parseTable(await fileToText(f))));
      setSource(f.name);
      setError("");
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div onDragOver={(e) => e.preventDefault()} onDrop={onDrop} style={{ minHeight: "100vh" }}>
      <header>
        <h1>RNA-seq Dashboard</h1>
        <span className="muted small" title={source}>preview · {source.split("/").pop()}</span>
      </header>
      <main>
        {error && <div className="error">{error}</div>}
        {rows && <TissueSelect tissues={tissuesOf(rows)} value={tissue} onChange={setTissue} />}
        {rows && <Stats items={summaryItems(rows, tissue)} />}
        {rows && <div ref={tableRef}><SolvedTable rows={rows} tissue={tissue} selection={selection} onClearSelection={() => setSelection(null)} /></div>}
        {rows && <ConsequenceBar rows={tissue ? rows.filter((r) => r.Tissue === tissue) : rows} selection={selection} onSelect={select} />}
      </main>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Preview />
  </React.StrictMode>,
);
