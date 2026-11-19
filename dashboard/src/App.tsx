import { useEffect, useRef, useState } from "react";
import { signIn, signOut, type Session } from "./auth/googleAuth";
import ConsequenceBar from "./components/ConsequenceBar";
import DataPanel, { type BucketInput, type LocalInput } from "./components/DataPanel";
import SampleOutlierRank from "./components/SampleOutlierRank";
import SolvedTable from "./components/SolvedTable";
import Tabs from "./components/Tabs";
import Stats, { type StatItem } from "./components/Stats";
import TissueSelect from "./components/TissueSelect";
import { summaryItems, tissuesOf } from "./components/summary";
import { loadConfig, type DashboardConfig } from "./config";
import { parseTable, toTsv } from "./data/csv";
import { ALL_TISSUES, classifyBucketFile, classifyReleaseFile, detectKind, detectTissue, KIND_LABELS, REQUIRED_KINDS, type InputKind } from "./data/detect";
import { bytesToText, fetchGsText, fileToText, listGs, uploadGsText } from "./data/gcs";
import { buildSolvedTable, type BuildResult, type PipelineInputs } from "./pipeline/solvedTable";
import { parseTpmMatrix } from "./pipeline/tpm";
import { OUTPUT_COLUMNS, type Cohort, type Selection } from "./types";
import CohortSwitch from "./components/CohortSwitch";

/** Largest FRASER2 padjust cutoff the dashboard accepts. */
const MAX_PADJ = 0.3;

/** File name for a saved table: tissue selection and FRASER2 cutoff are part of it, e.g.
 *  solved_table_muscle_padj0.05.csv or solved_table_all_tissues_padj0.1.csv */
function solvedTableName(cohort: Cohort, tissue: string, padjCutoff: number): string {
  return `${cohort}_table_${tissue || "all_tissues"}_padj${padjCutoff}.csv`;
}

/** Both cohorts from one set of parsed inputs. */
function buildBoth(inputs: PipelineInputs): Record<Cohort, BuildResult> {
  return { solved: buildSolvedTable({ ...inputs, cohort: "solved" }), unsolved: buildSolvedTable({ ...inputs, cohort: "unsolved" }) };
}

/** Sort release folders newest first: 11_12_2026 / 2026-11-12 style names parse as dates, others sort by name. */
function releaseDate(url: string): number {
  const name = url.replace(/\/$/, "").split("/").pop() ?? "";
  let m = /^(\d{1,2})[_-](\d{1,2})[_-](\d{4})$/.exec(name);            // M_D_YYYY
  if (m) return Date.UTC(+m[3], +m[1] - 1, +m[2]);
  m = /^(\d{4})[_-](\d{1,2})[_-](\d{1,2})$/.exec(name);                // YYYY-MM-DD
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  return NaN;
}

export default function App() {
  const [config, setConfig] = useState<DashboardConfig | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [shared, setShared] = useState<BucketInput[] | null>(null);
  const [releases, setReleases] = useState<string[]>([]);
  const [release, setRelease] = useState("");
  const [releaseFiles, setReleaseFiles] = useState<BucketInput[] | null>(null);
  const [bucketError, setBucketError] = useState("");
  const [localInputs, setLocalInputs] = useState<LocalInput[]>([]);
  const [padjCutoff, setPadjCutoff] = useState(0.05);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Record<Cohort, BuildResult> | null>(null);
  const [cohort, setCohort] = useState<Cohort>("solved");
  const result = results ? results[cohort] : null;
  const cohortLabel = cohort;                                   // "solved" | "unsolved"
  const geneWord = cohort === "solved" ? "solved" : "candidate";
  const [bundledGeneMap, setBundledGeneMap] = useState("");
  const [tissue, setTissue] = useState("");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [sampleSel, setSampleSel] = useState<string | null>(null);
  const [dataCollapsed, setDataCollapsed] = useState(false);
  const [page, setPage] = useState("consequence");
  const [saved, setSaved] = useState("");
  /** Inputs of the last build, with TPM matrices parsed, so a cutoff change rebuilds without re-reading. */
  const [lastInputs, setLastInputs] = useState<PipelineInputs | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  /** Bucket object text keyed by gsUrl@updated, so a rebuild with unchanged inputs downloads nothing. */
  const bucketCache = useRef(new Map<string, string>());
  // a plot interaction filters the table, which sits above the plot tabs: scroll it into view
  const goTable = () => tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  const select = (s: Selection | null) => { setSelection(s); if (s) goTable(); };
  const selectSample = (s: string | null) => { setSampleSel(s); if (s) goTable(); };

  useEffect(() => {
    loadConfig()
      .then((c) => { setConfig(c); setPadjCutoff(c.padjCutoff ?? 0.05); })
      .catch((e) => setError(String(e)));
    // GENCODE gene map shipped with the page (public/gene_map.csv), the same file main.py reads from DATA_DIR.
    fetch(`${import.meta.env.BASE_URL}gene_map.csv`)
      .then(async (r) => { if (r.ok) setBundledGeneMap(await bytesToText(await r.arrayBuffer())); })
      .catch(() => {});
  }, []);

  const tokenValid = !!session && session.expiresAt > Date.now();

  // Live cutoff: once a table exists, a change to the FRASER2 padjust threshold rebuilds it from the
  // inputs already in memory (no bucket reads), after a short pause so typing does not thrash.
  useEffect(() => {
    if (!lastInputs || lastInputs.padjCutoff === padjCutoff) return;
    if (!(padjCutoff > 0 && padjCutoff <= MAX_PADJ)) return;
    const id = setTimeout(() => {
      const inputs = { ...lastInputs, padjCutoff };
      setResults(buildBoth(inputs));
      setLastInputs(inputs);
      setSaved("");
    }, 300);
    return () => clearTimeout(id);
  }, [padjCutoff, lastInputs]);

  /** Tissue labels seen anywhere, for file-name guessing and autocomplete. */
  const knownTissues = [...new Set([
    ...(shared ?? []).map((b) => b.tissue),
    ...(releaseFiles ?? []).map((b) => b.tissue),
    ...localInputs.map((l) => l.tissue),
  ].filter((t): t is string => !!t))].sort();

  const listRelease = async (url: string, s: Session, known: string[]) => {
    const { objects } = await listGs(url, s.accessToken);
    const files: BucketInput[] = [];
    for (const o of objects) {
      const c = classifyReleaseFile(o.name, known);
      if (c) files.push({ kind: c.kind, tissue: c.tissue, object: o });
    }
    setReleaseFiles(files);
  };

  const refreshBucket = async (s = session) => {
    if (!config || !s) return;
    setBucketError("");
    try {
      const sharedListing = await listGs(config.sharedFolder, s.accessToken);
      const found: BucketInput[] = [];
      for (const o of sharedListing.objects) {
        const c = classifyBucketFile(o.name);
        if (c) found.push({ kind: c.kind, tissue: c.tissue ?? null, object: o });
      }
      setShared(found);
      const known = found.map((b) => b.tissue).filter((t): t is string => !!t);

      const { subfolders } = await listGs(config.releasesFolder, s.accessToken);
      const sorted = subfolders.sort((a, b) => {
        const da = releaseDate(a), db = releaseDate(b);
        if (!isNaN(da) && !isNaN(db)) return db - da;
        if (isNaN(da) !== isNaN(db)) return isNaN(da) ? 1 : -1;
        return b.localeCompare(a);
      });
      setReleases(sorted);
      const chosen = sorted.includes(release) ? release : sorted[0] ?? "";
      setRelease(chosen);
      if (chosen) await listRelease(chosen, s, known); else setReleaseFiles(null);
    } catch (e) {
      setShared(null);
      setReleaseFiles(null);
      setBucketError((e as Error).message);
    }
  };

  const selectRelease = async (url: string) => {
    setRelease(url);
    setReleaseFiles(null);
    if (session) {
      try { await listRelease(url, session, knownTissues); } catch (e) { setBucketError((e as Error).message); }
    }
  };

  const setReleaseTissue = (objectName: string, t: string | null) =>
    setReleaseFiles((prev) => prev && prev.map((b) => (b.object.name === objectName ? { ...b, tissue: t } : b)));

  const doSignIn = async () => {
    if (!config) return;
    setError("");
    try {
      const s = await signIn(config.googleClientId);
      setSession(s);
      await refreshBucket(s);
    } catch (e) {
      setError(`Sign-in failed: ${(e as Error).message}`);
    }
  };

  const doSignOut = () => {
    signOut(session); setSession(null); setShared(null); setReleases([]); setRelease(""); setReleaseFiles(null); setResults(null);
  };

  const addFiles = async (files: FileList | File[]) => {
    const added: LocalInput[] = [];
    for (const f of Array.from(files)) {
      const text = await fileToText(f);
      const kind = detectKind(text);
      added.push({
        id: `${f.name}-${f.size}-${f.lastModified}`,
        fileName: f.name,
        text,
        kind,
        tissue: kind === "fraser" || kind === "tpm" ? detectTissue(f.name, knownTissues) : null,
      });
    }
    setLocalInputs((prev) => [...prev.filter((p) => !added.some((a) => a.id === p.id)), ...added]);
  };

  const updateLocal = (id: string, patch: Partial<LocalInput>) =>
    setLocalInputs((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const removeLocal = (id: string) => setLocalInputs((prev) => prev.filter((l) => l.id !== id));

  /** Text for one input: a dropped file wins, then the release folder, then the shared folder (cached per version). */
  const readInput = async (kind: InputKind, tissue?: string): Promise<string> => {
    const match = (k: InputKind, t: string | null) => k === kind && (tissue ? t === tissue : true);
    const local = localInputs.find((l) => l.kind && match(l.kind, l.tissue));
    if (local) return local.text;
    const b = (releaseFiles ?? []).find((x) => match(x.kind, x.tissue)) ?? (shared ?? []).find((x) => match(x.kind, x.tissue));
    if (b) {
      const key = `${b.object.gsUrl}@${b.object.updated}`;
      const cached = bucketCache.current.get(key);
      if (cached !== undefined) return cached;
      if (!tokenValid) throw new Error("Google sign-in expired; sign in again to read the bucket.");
      const text = await fetchGsText(b.object.gsUrl, session!.accessToken);
      bucketCache.current.set(key, text);
      return text;
    }
    if (kind === "geneMap") return bundledGeneMap;
    return "";
  };

  const build = async () => {
    if (!config) return;
    setError(""); setResults(null); setSaved(""); setLastInputs(null); setBusy(true);
    try {
      if (!(padjCutoff > 0 && padjCutoff <= MAX_PADJ)) throw new Error(`FRASER2 padjust cutoff must be between 0 and ${MAX_PADJ}.`);
      const unknown = localInputs.filter((l) => !l.kind);
      if (unknown.length) throw new Error(`Not recognised: ${unknown.map((u) => u.fileName).join(", ")}. Remove them or check their columns.`);
      const noTissue = [
        ...localInputs.filter((l) => (l.kind === "fraser" || l.kind === "tpm") && !l.tissue).map((l) => l.fileName),
        ...(releaseFiles ?? []).filter((b) => b.kind === "fraser" && !b.tissue).map((b) => b.object.name.split("/").pop()!),
      ];
      if (noTissue.length) throw new Error(`Choose a tissue for: ${noTissue.join(", ")}.`);

      // every tissue that has a FRASER2 or TPM input, from dropped files, the release or the shared folder
      const tissues = [...new Set<string>([
        ...localInputs.filter((l) => l.kind === "fraser" || l.kind === "tpm").map((l) => l.tissue!),
        ...(releaseFiles ?? []).filter((b) => b.tissue).map((b) => b.tissue!),
        ...(shared ?? []).filter((b) => b.tissue).map((b) => b.tissue!),
      ])];
      const fixedKinds = ["seqrMetadata", "rnaMetadata", "allVariants", "priorityVariants", "geneMap"] as InputKind[];
      setStatus(`Reading ${fixedKinds.length + 2 * tissues.length} inputs…`);
      const [fixedTexts, fraserTexts, tpmTexts] = await Promise.all([
        Promise.all(fixedKinds.map((k) => readInput(k))),
        Promise.all(tissues.map((t) => readInput("fraser", t))),
        Promise.all(tissues.map((t) => readInput("tpm", t))),
      ]);
      const texts: Partial<Record<InputKind, string>> = Object.fromEntries(fixedKinds.map((k, i) => [k, fixedTexts[i]]));
      const missing = REQUIRED_KINDS.filter((k) => !texts[k]);
      if (missing.length) throw new Error(`Missing input: ${missing.map((k) => KIND_LABELS[k]).join(", ")}.`);

      const inputs: PipelineInputs = {
        seqrMetadata: parseTable(texts.seqrMetadata!),
        rnaMetadata: parseTable(texts.rnaMetadata!),
        allVariants: parseTable(texts.allVariants!),
        priorityVariants: parseTable(texts.priorityVariants!),
        geneMap: texts.geneMap ? parseTable(texts.geneMap) : [],
        fraser: {},
        tpm: {},
        padjCutoff,
      };
      tissues.forEach((t, i) => {
        if (fraserTexts[i]) inputs.fraser[t] = parseTable(fraserTexts[i]);
        if (tpmTexts[i]) inputs.tpm[t] = parseTpmMatrix(tpmTexts[i]);
      });
      const complete = tissues.filter((t) => (inputs.fraser[t] || inputs.fraser[ALL_TISSUES]) && inputs.tpm[t]);
      if (!complete.length) {
        throw new Error("Add FRASER2 results and a TPM matrix with the same tissue label for at least one tissue.");
      }
      setStatus("Building solved table…");
      await new Promise((r) => setTimeout(r, 0));   // let the status paint before the synchronous build
      setResults(buildBoth(inputs));
      setLastInputs(inputs);
      setDataCollapsed(true);
      setStatus("");
      // after the data panel collapses, bring the toolbar to the top so the results start right below it
      setTimeout(() => toolbarRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    } finally {
      setBusy(false);
    }
  };

  /** Write the built table (tab-separated, same layout as main.py's output) into the selected release folder.
   *  Rows follow the page's tissue selection; the file name records the tissue and the FRASER2 cutoff. */
  const saveToRelease = async () => {
    if (!result || !release || !tokenValid) return;
    const name = solvedTableName(cohort, tissue, padjCutoff);
    const url = `${release.replace(/\/$/, "")}/${name}`;
    const rows = tissue ? result.rows.filter((r) => r.Tissue === tissue) : result.rows;
    setError(""); setBusy(true); setStatus(`Writing ${url}…`);
    try {
      await uploadGsText(url, toTsv(OUTPUT_COLUMNS, rows), "text/tab-separated-values", session!.accessToken);
      setSaved(url);
      setStatus("");
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <header>
        <h1>RNA-seq Dashboard</h1>
        <div className="row">
          {tokenValid ? (
            <>
              <span className="muted small">signed in</span>
              <button onClick={doSignOut}>Sign out</button>
            </>
          ) : (
            <button className="primary" onClick={doSignIn} disabled={!config}>Sign in with Google</button>
          )}
        </div>
      </header>
      <main>
        {error && <div className="error">{error}</div>}
        {config && (
          <DataPanel
            signedIn={tokenValid}
            shared={shared} releases={releases} release={release} releaseFiles={releaseFiles}
            onSelectRelease={selectRelease} onReleaseTissue={setReleaseTissue}
            bucketError={bucketError} onRefresh={() => refreshBucket()}
            localInputs={localInputs} onAddFiles={addFiles} onUpdateLocal={updateLocal} onRemoveLocal={removeLocal}
            busy={busy} tissueSuggestions={knownTissues} bundledGeneMap={!!bundledGeneMap}
            collapsed={dataCollapsed} onToggle={() => setDataCollapsed((c) => !c)}
            summary={[
              release ? `release ${release.replace(/\/$/, "").split("/").pop()}` : "",
              shared ? `${shared.length} shared files` : "",
              localInputs.length ? `${localInputs.length} dropped` : "",
            ].filter(Boolean).join(" · ")}
          />
        )}
        <div className="row toolbar" ref={toolbarRef}>
          <button className="primary" onClick={build} disabled={!config || busy}>Build solved table</button>
          <label className="row small muted" title="Significant FRASER2 outliers have padjust below this value. Keep it at or below 0.3.">
            FRASER2 padjust &lt;
            <input
              type="number" step="0.01" min="0" max={MAX_PADJ} value={padjCutoff} disabled={busy}
              onChange={(e) => setPadjCutoff(Number(e.target.value))} style={{ width: 80 }}
            />
            <span className="muted small">(≤ {MAX_PADJ}; the table updates as you change it)</span>
          </label>
          {padjCutoff > MAX_PADJ && <span className="warn-inline">padjust cutoff must be ≤ {MAX_PADJ}</span>}
          {result && release && tokenValid && (
            <button onClick={saveToRelease} disabled={busy} title={`Write ${solvedTableName(cohort, tissue, padjCutoff)} to ${release}`}>
              Save to release
            </button>
          )}
          <span className="muted small">{status}</span>
          {saved && <span className="small" style={{ color: "#006300" }}>✓ saved to {saved}</span>}
        </div>
        {result && result.stats.warnings.map((w, i) => <div key={i} className="warn">{w}</div>)}
        {results && result && (
          <div className="row" style={{ gap: 20 }}>
            <CohortSwitch
              value={cohort}
              counts={{ solved: new Set(results.solved.rows.map((r) => r.Sample_ID)).size, unsolved: new Set(results.unsolved.rows.map((r) => r.Sample_ID)).size }}
              onChange={(c) => { setCohort(c); setSelection(null); setSampleSel(null); setSaved(""); }}
            />
            <TissueSelect tissues={tissuesOf(result.rows)} value={tissue} onChange={setTissue} />
          </div>
        )}
        {result && <Stats items={[...summaryItems(result.rows, tissue, lastInputs?.padjCutoff, cohortLabel, geneWord), ...pipelineStatItems(result, cohortLabel)]} />}
        {result && (
          <div ref={tableRef}>
            <SolvedTable rows={result.rows} tissue={tissue}
                         selection={selection} onClearSelection={() => setSelection(null)}
                         sample={sampleSel} onClearSample={() => setSampleSel(null)} />
          </div>
        )}
        {/* plots live in tabs below the table; interacting with a plot filters the table above */}
        {result && (
          <Tabs
            tabs={[
              { id: "consequence", label: "RNA support by consequence" },
              { id: "samples", label: "Outliers per sample" },
            ]}
            active={page} onChange={setPage}
          />
        )}
        {result && page === "consequence" && (
          <ConsequenceBar rows={tissue ? result.rows.filter((r) => r.Tissue === tissue) : result.rows} geneWord={geneWord} selection={selection} onSelect={select} />
        )}
        {result && page === "samples" && (
          <SampleOutlierRank
            data={tissue ? result.sampleOutliers.filter((s) => s.tissue === tissue) : result.sampleOutliers}
            padjCutoff={lastInputs?.padjCutoff ?? padjCutoff} cohortLabel={cohortLabel}
            selectedSample={sampleSel} onSelectSample={selectSample}
          />
        )}
      </main>
    </>
  );
}

/** Build-time counts that do not depend on the table rows. */
function pipelineStatItems(result: BuildResult, cohortLabel: string): StatItem[] {
  const s = result.stats;
  return [{ value: `${s.solvedRnaSamples} / ${s.rnaSamples}`, label: `RNA-seq samples ${cohortLabel} in seqr` }];
}
