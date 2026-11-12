import React, { useMemo, useRef, useState } from "react";
import { composeSvg, downloadPng, downloadSvg } from "../data/exportSvg";
import type { Selection, SolvedRow } from "../types";

/** Horizontal stacked bars, one panel per tissue on a shared scale: per seqr consequence class, how many
 *  solved variants have a FRASER2 outlier in the solved gene (accent) versus none (grey). Unit is
 *  sample × variant within a tissue; a variant is counted under every class listed for it. */

const ACCENT = "#2a78d6";      // categorical slot 1 (validated)
const MUTED = "#c9ccd1";       // de-emphasis grey: the "no outlier" context series
const INK = "#1f2933";
const INK_2 = "#52606d";
const GRID = "#e1e0d9";

/** VEP terms from most to least splice-relevant; unknown terms go after these, by count. */
const ORDER = [
  "splice_acceptor_variant", "splice_donor_variant", "splice_donor_5th_base_variant", "splice_region_variant",
  "splice_donor_region_variant", "splice_polypyrimidine_tract_variant", "intron_variant", "non_coding_transcript_exon_variant",
  "5_prime_UTR_variant", "3_prime_UTR_variant", "frameshift_variant", "stop_gained", "stop_lost", "start_lost",
  "inframe_insertion", "inframe_deletion", "missense_variant", "synonymous_variant", "upstream_gene_variant",
  "downstream_gene_variant", "intergenic_variant",
];

interface ClassCount { cls: string; detected: number; missed: number; detectedWho: string[]; missedWho: string[] }

export function consequenceCounts(rows: SolvedRow[]): ClassCount[] {
  // one record per sample × variant (callers pass the rows of a single tissue)
  const byVariant = new Map<string, { classes: Set<string>; detected: boolean }>();
  for (const r of rows) {
    const k = `${r.Sample_ID}\u0000${r.hgvsc}`;
    let v = byVariant.get(k);
    if (!v) byVariant.set(k, (v = { classes: new Set(), detected: false }));
    for (const c of r.Seqr_variant_consequence.split(";").map((s) => s.trim()).filter(Boolean)) v.classes.add(c);
    if (r.FRASER2_sig_outlier_count > 0) v.detected = true;
  }
  const counts = new Map<string, ClassCount>();
  for (const [k, v] of byVariant) {
    const [sample, hgvsc] = k.split("\u0000");
    const classes = v.classes.size ? [...v.classes] : ["(no consequence)"];
    for (const cls of classes) {
      const c = counts.get(cls) ?? { cls, detected: 0, missed: 0, detectedWho: [], missedWho: [] };
      if (v.detected) { c.detected++; c.detectedWho.push(`${sample} ${hgvsc}`); } else { c.missed++; c.missedWho.push(`${sample} ${hgvsc}`); }
      counts.set(cls, c);
    }
  }
  const rank = (cls: string) => { const i = ORDER.indexOf(cls); return i < 0 ? ORDER.length : i; };
  return [...counts.values()].sort((a, b) => rank(a.cls) - rank(b.cls) || (b.detected + b.missed) - (a.detected + a.missed));
}

const LABEL_W = 230, BAR_H = 20, ROW_H = 30, GAP = 2, PAD_TOP = 34, PAD_RIGHT = 56;

interface Props {
  rows: SolvedRow[];
  width?: number;
  selection: Selection | null;
  onSelect: (s: Selection | null) => void;
}

const TITLE = "RNA support by variant consequence";

export default function ConsequenceBar({ rows, width = 720, selection, onSelect }: Props) {
  const card = useRef<HTMLElement>(null);
  const exportChart = async (format: "svg" | "png") => {
    const svgs = Array.from(card.current?.querySelectorAll<SVGSVGElement>("svg.panel") ?? []);
    if (!svgs.length) return;
    const tissues = panels.map((p) => p.tissue);
    const name = `rna_support_by_consequence_${tissues.length === 1 ? tissues[0] : "all_tissues"}`;
    const text = composeSvg(svgs, TITLE, [
      { color: ACCENT, label: "FRASER2 outlier in solved gene" },
      { color: MUTED, label: "no outlier" },
    ]);
    if (format === "svg") downloadSvg(text, `${name}.svg`);
    else await downloadPng(text, `${name}.png`);
  };
  const panels = useMemo(() => {
    const tissues = [...new Set(rows.map((r) => r.Tissue))].sort();
    return tissues.map((t) => ({ tissue: t, data: consequenceCounts(rows.filter((r) => r.Tissue === t)) }));
  }, [rows]);
  const max = Math.max(1, ...panels.flatMap((p) => p.data.map((d) => d.detected + d.missed)));
  if (!panels.length) return null;

  return (
    <section className="card" ref={card}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>{TITLE}</h2>
        <div className="row">
          <button onClick={() => exportChart("svg")} title="Vector image, editable in Illustrator / Inkscape">Download SVG</button>
          <button onClick={() => exportChart("png")} title="Image at 2× resolution">Download PNG</button>
        </div>
      </div>
      <div className="row small" style={{ gap: 18, margin: "8px 0 4px" }}>
        <span><span className="swatch" style={{ background: ACCENT }} /> FRASER2 outlier in solved gene</span>
        <span><span className="swatch" style={{ background: MUTED }} /> no outlier</span>
      </div>
      <p className="muted small" style={{ margin: "0 0 4px" }}>Click a segment to list those variants in the table.</p>
      {panels.map((p) => (
        <Panel key={p.tissue} tissue={p.tissue} data={p.data} max={max} width={width} selection={selection} onSelect={onSelect} />
      ))}
    </section>
  );
}

function Panel({ tissue, data, max, width, selection, onSelect }: {
  tissue: string; data: ClassCount[]; max: number; width: number; selection: Selection | null; onSelect: (s: Selection | null) => void;
}) {
  const [hover, setHover] = useState<{ x: number; y: number; lines: string[] } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const pos = (e: React.MouseEvent) => {
    const b = wrap.current?.getBoundingClientRect();
    return { x: e.clientX - (b?.left ?? 0), y: e.clientY - (b?.top ?? 0) };
  };
  const plotW = width - LABEL_W - PAD_RIGHT;
  const x = (v: number) => (v / max) * plotW;
  const height = PAD_TOP + data.length * ROW_H + 8;
  const ticks = niceTicks(max);
  const fmt = (c: string) => c.replace(/_variant$/, "").replace(/_/g, " ");

  return (
      <div ref={wrap} style={{ position: "relative" }}>
        <svg className="panel" width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ maxWidth: "100%", height: "auto" }} role="img" aria-label={`${tissue}: solved variants by consequence class, split by FRASER2 outlier in the solved gene`}>
          <text x={0} y={16} fontSize={13} fontWeight={600} fill={INK}>{tissue}</text>
          {/* gridlines + ticks */}
          {ticks.map((t) => (
            <g key={t} transform={`translate(${LABEL_W + x(t)}, 0)`}>
              <line y1={PAD_TOP - 6} y2={height - 8} stroke={GRID} strokeWidth={1} />
              <text y={PAD_TOP - 10} fontSize={11} fill={INK_2} textAnchor="middle">{t}</text>
            </g>
          ))}
          {/* bars */}
          {data.map((d, i) => {
            const y = PAD_TOP + i * ROW_H + (ROW_H - BAR_H) / 2;
            const w1 = x(d.detected), w2 = x(d.missed);
            const total = d.detected + d.missed;
            // The total sits at the end of every bar. Only the accent segment gets an inside label, and only
            // when the grey segment is also present; a single-segment bar would otherwise show its number twice.
            const seg = (sx: number, w: number, fill: string, label: string, n: number, who: string[], detected: boolean, last: boolean, inside: boolean) => {
              const isSel = !!selection && selection.cls === d.cls && selection.detected === detected;
              const dim = !!selection && !isSel;
              const list = who.slice(0, 8).concat(who.length > 8 ? [`+${who.length - 8} more`] : []);
              return w > 0 && (
                <g
                  key={label}
                  style={{ cursor: "pointer", opacity: dim ? 0.35 : 1 }}
                  onMouseMove={(e) => setHover({ ...pos(e), lines: [`${fmt(d.cls)}: ${n} ${label} (${Math.round((100 * n) / total)}%)`, ...list] })}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => onSelect(isSel ? null : { cls: d.cls, detected })}
                >
                  <rect x={LABEL_W + sx} y={y} width={Math.max(w - (last ? 0 : GAP), 1)} height={BAR_H} fill={fill} rx={last ? 4 : 0}
                        stroke={isSel ? INK : "none"} strokeWidth={isSel ? 2 : 0} />
                  {last && w > 8 && <rect x={LABEL_W + sx} y={y} width={Math.min(6, w)} height={BAR_H} fill={fill} />}
                  {inside && w >= 22 && (
                    <text x={LABEL_W + sx + 6} y={y + BAR_H / 2 + 4} fontSize={11} fill="#fff" fontWeight={600}>{n}</text>
                  )}
                </g>
              );
            };
            return (
              <g key={d.cls}>
                <text x={LABEL_W - 10} y={y + BAR_H / 2 + 4} fontSize={12} fill={INK} textAnchor="end">{fmt(d.cls)}</text>
                {seg(0, w1, ACCENT, "with outlier", d.detected, d.detectedWho, true, w2 === 0, w2 > 0)}
                {seg(w1, w2, MUTED, "without outlier", d.missed, d.missedWho, false, true, false)}
                <text x={LABEL_W + w1 + w2 + 8} y={y + BAR_H / 2 + 4} fontSize={11} fill={INK_2}>{total}</text>
              </g>
            );
          })}
          <line x1={LABEL_W} x2={LABEL_W} y1={PAD_TOP - 6} y2={height - 8} stroke="#c3c2b7" strokeWidth={1} />
        </svg>
        {hover && (
          <div className="tooltip" style={{ left: hover.x + 12, top: hover.y - 8 }}>
            {hover.lines.map((l, i) => <div key={i} className={i ? "tooltip-item" : undefined}>{l}</div>)}
          </div>
        )}
      </div>
  );
}

function niceTicks(max: number): number[] {
  if (max <= 0) return [0];
  const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000].find((s) => max / s <= 6) ?? Math.ceil(max / 6);
  const out: number[] = [];
  for (let t = 0; t <= max; t += step) out.push(t);
  return out;
}
