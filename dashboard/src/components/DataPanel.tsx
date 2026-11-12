import { useRef, useState } from "react";
import { ALL_TISSUES, KIND_LABELS, PER_TISSUE_KINDS, REQUIRED_KINDS, type InputKind } from "../data/detect";
import type { GsObject } from "../data/gcs";

/** A file the user dropped, already read and recognised. */
export interface LocalInput {
  id: string;
  fileName: string;
  text: string;
  kind: InputKind | null;
  tissue: string | null;
}

/** A file found in the bucket (shared folder or a release folder). */
export interface BucketInput {
  kind: InputKind;
  tissue: string | null;
  object: GsObject;
}

interface Props {
  signedIn: boolean;
  shared: BucketInput[] | null;            // null = not listed yet
  releases: string[];                      // release folder URLs, newest first
  release: string;                         // selected release folder URL
  releaseFiles: BucketInput[] | null;
  onSelectRelease: (url: string) => void;
  onReleaseTissue: (objectName: string, tissue: string | null) => void;
  bucketError: string;
  onRefresh: () => void;
  localInputs: LocalInput[];
  onAddFiles: (files: FileList | File[]) => void;
  onUpdateLocal: (id: string, patch: Partial<LocalInput>) => void;
  onRemoveLocal: (id: string) => void;
  busy: boolean;
  tissueSuggestions: string[];
  bundledGeneMap: boolean;
}

const keyOf = (kind: InputKind, tissue: string | null | undefined) => (tissue ? `${kind}:${tissue}` : kind);

export default function DataPanel(p: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const localKinds = new Set(p.localInputs.filter((l) => l.kind).map((l) => keyOf(l.kind!, l.tissue)));
  const bucketKinds = new Set([...(p.shared ?? []), ...(p.releaseFiles ?? [])].map((b) => keyOf(b.kind, b.tissue)));
  const covered = (k: string) => localKinds.has(k) || bucketKinds.has(k);
  const folderName = (url: string) => url.replace(/\/$/, "").split("/").pop() ?? url;

  return (
    <section className="card">
      <h2>Data</h2>

      {/* shared data: maintained by the scheduled export job */}
      <div className="block">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="label">Shared data</span>
          <button onClick={p.onRefresh} disabled={!p.signedIn || p.busy}>{p.shared ? "Refresh" : "Load"}</button>
        </div>
        {!p.signedIn && <div className="muted small">Sign in to read the bucket, or use local files only.</div>}
        {p.bucketError && <div className="error small">{p.bucketError}</div>}
        {p.shared && (
          <ul className="chips">
            {p.shared.map((b) => (
              <li key={b.object.name} className="chip ok" title={b.object.gsUrl}>
                ✓ {KIND_LABELS[b.kind]}{b.tissue ? ` · ${b.tissue}` : ""}
                <span className="muted small"> {b.object.updated.slice(0, 10)}</span>
              </li>
            ))}
            {p.shared.length === 0 && <li className="muted small">No recognised files in the shared folder.</li>}
          </ul>
        )}
      </div>

      {/* FRASER2 release: a dated folder a user uploaded */}
      <div className="block">
        <div className="row">
          <span className="label">FRASER2 release</span>
          <select value={p.release} onChange={(e) => p.onSelectRelease(e.target.value)} disabled={!p.releases.length || p.busy}>
            {!p.releases.length && <option value="">{p.signedIn ? "no release folders found" : "sign in to list releases"}</option>}
            {p.releases.map((r) => <option key={r} value={r}>{folderName(r)}</option>)}
          </select>
        </div>
        {p.releaseFiles && (
          <ul className="files" style={{ marginTop: 8 }}>
            {p.releaseFiles.map((b) => (
              <li key={b.object.name}>
                <span className="name" title={b.object.gsUrl}>{b.object.name.split("/").pop()}</span>
                <span className="arrow">→</span>
                <span className="kind">{KIND_LABELS[b.kind]}</span>
                {b.kind === "fraser" && (
                  <input
                    type="text" list="tissue-options" placeholder="tissue" className="tissue"
                    value={b.tissue ?? ""}
                    onChange={(e) => p.onReleaseTissue(b.object.name, e.target.value.trim().toLowerCase() || null)}
                  />
                )}
                <span className="muted small">{b.object.updated.slice(0, 10)}</span>
              </li>
            ))}
            {p.releaseFiles.length === 0 && <li className="muted small">No tables in this release folder.</li>}
          </ul>
        )}
      </div>

      {/* local overrides */}
      <div
        className={`dropzone${dragOver ? " over" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); p.onAddFiles(e.dataTransfer.files); }}
        onClick={() => fileRef.current?.click()}
      >
        <input
          ref={fileRef} type="file" multiple style={{ display: "none" }}
          onChange={(e) => { if (e.target.files) p.onAddFiles(e.target.files); e.target.value = ""; }}
        />
        {p.localInputs.length === 0 ? (
          <span className="muted">Drop files here to override any input, or click to choose.</span>
        ) : (
          <ul className="files" onClick={(e) => e.stopPropagation()}>
            {p.localInputs.map((l) => (
              <li key={l.id}>
                <span className="name">{l.fileName}</span>
                <span className="arrow">→</span>
                {l.kind ? <span className="kind">{KIND_LABELS[l.kind]}</span> : <span className="kind bad">not recognised</span>}
                {l.kind && PER_TISSUE_KINDS.includes(l.kind) && (
                  <input
                    type="text" list="tissue-options" placeholder="tissue" className="tissue"
                    value={l.tissue ?? ""}
                    onChange={(e) => p.onUpdateLocal(l.id, { tissue: e.target.value.trim().toLowerCase() || null })}
                  />
                )}
                <button className="link" onClick={() => p.onRemoveLocal(l.id)} disabled={p.busy}>remove</button>
              </li>
            ))}
            <li className="muted small add">+ add more files</li>
          </ul>
        )}
      </div>
      <datalist id="tissue-options">
        <option value={ALL_TISSUES}>all tissues (rows split by each sample's tissue)</option>
        {p.tissueSuggestions.filter((t) => t !== ALL_TISSUES).map((t) => <option key={t} value={t} />)}
      </datalist>

      {/* readiness: one line, only once there is something to judge (bucket listed or a file dropped) */}
      {(p.shared !== null || p.localInputs.length > 0) && (() => {
        const missingRequired = REQUIRED_KINDS.filter((k) => !covered(k)).map((k) => KIND_LABELS[k]);
        if (!covered("geneMap") && !p.bundledGeneMap) missingRequired.push(KIND_LABELS.geneMap);
        const tissues = tissueStatus(localKinds, bucketKinds);
        const ready = tissues.filter((t) => t.fraser && t.tpm).map((t) => t.tissue);
        const partial = tissues.filter((t) => !(t.fraser && t.tpm));
        const problems = [
          ...(missingRequired.length ? [`missing ${missingRequired.join(", ")}`] : []),
          ...(ready.length ? [] : ["no tissue has both FRASER2 results and a TPM matrix"]),
          ...partial.map((t) => `${t.tissue}: ${t.fraser ? "no TPM matrix" : "no FRASER2 results"}`),
        ];
        return problems.length ? (
          <div className="readiness todo">○ {problems.join(" · ")}</div>
        ) : (
          <div className="readiness ok">✓ Ready to build: {ready.join(", ")}</div>
        );
      })()}
    </section>
  );
}

/** Per tissue, whether a FRASER2 table and a TPM matrix are present (from bucket or dropped files). */
function tissueStatus(...sets: Set<string>[]): { tissue: string; fraser: boolean; tpm: boolean }[] {
  const byTissue = new Map<string, { tissue: string; fraser: boolean; tpm: boolean }>();
  let fraserAll = false;
  for (const s of sets) {
    for (const k of s) {
      const [kind, tissue] = k.split(":");
      if (!tissue) continue;
      if (tissue === ALL_TISSUES) { if (kind === "fraser") fraserAll = true; continue; }
      const t = byTissue.get(tissue) ?? { tissue, fraser: false, tpm: false };
      if (kind === "fraser") t.fraser = true;
      if (kind === "tpm") t.tpm = true;
      byTissue.set(tissue, t);
    }
  }
  if (fraserAll) for (const t of byTissue.values()) t.fraser = true;   // one combined table covers every tissue
  return [...byTissue.values()].sort((a, b) => a.tissue.localeCompare(b.tissue));
}
