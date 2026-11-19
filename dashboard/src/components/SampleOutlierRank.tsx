import { useMemo } from "react";
import { CHART, ChartCard, useTooltip } from "./chart";
import type { SampleOutlierCount } from "../types";

/** Per tissue: every sample in the FRASER2 run ranked by its number of significant junctions (all genes).
 *  Solved samples are the emphasis series; the rest is context. Shows whether a solved sample's outlier
 *  sits in a quiet sample (meaningful) or a noisy one (less so). */

interface Props {
  data: SampleOutlierCount[];
  padjCutoff: number;
  width?: number;
  selectedSample: string | null;
  onSelectSample: (wgsSampleId: string | null) => void;
}

const PAD = { left: 48, right: 16, top: 26, bottom: 26 }, PLOT_H = 150;

export default function SampleOutlierRank({ data, padjCutoff, width = 720, selectedSample, onSelectSample }: Props) {
  const panels = useMemo(() => {
    const tissues = [...new Set(data.map((d) => d.tissue))].sort();
    return tissues.map((t) => ({ tissue: t, samples: data.filter((d) => d.tissue === t).sort((a, b) => b.count - a.count) }));
  }, [data]);
  const max = Math.max(1, ...data.map((d) => d.count));
  if (!panels.length) return null;

  return (
    <ChartCard
      title="Outliers per sample"
      hint={`significant FRASER2 junctions (padj < ${padjCutoff}) per sample, all genes, ranked on a log axis; click a solved sample to show it in the table`}
      legend={[{ color: CHART.accent, label: "solved sample" }, { color: CHART.muted, label: "other sample in the run" }]}
      fileStem={`outliers_per_sample_${panels.length === 1 ? panels[0].tissue : "all_tissues"}`}
    >
      {panels.map((p) => (
        <Panel key={p.tissue} tissue={p.tissue} samples={p.samples} max={max} width={width}
               selectedSample={selectedSample} onSelectSample={onSelectSample} />
      ))}
    </ChartCard>
  );
}

function Panel({ tissue, samples, max, width, selectedSample, onSelectSample }: {
  tissue: string; samples: SampleOutlierCount[]; max: number; width: number;
  selectedSample: string | null; onSelectSample: (id: string | null) => void;
}) {
  const tip = useTooltip();
  const plotW = width - PAD.left - PAD.right;
  const height = PAD.top + PLOT_H + PAD.bottom;
  const n = samples.length;
  const slot = plotW / Math.max(n, 1);
  const barW = Math.max(Math.min(slot - 1, 14), 1);
  // log axis: counts span orders of magnitude; log10(count + 1) keeps zero on the baseline
  const top = Math.log10(max + 1);
  const y = (v: number) => PAD.top + PLOT_H - (Math.log10(v + 1) / top) * PLOT_H;
  const ticks = [0, 1, 10, 100, 1000, 10000].filter((t) => t <= max);
  if (max > 3 * ticks[ticks.length - 1]) ticks.push(max);   // label the top only when it is well above the last decade
  const solved = samples.filter((s) => s.solved);
  const median = n ? samples[Math.floor(n / 2)].count : 0;

  return (
    <div ref={tip.wrap} style={{ position: "relative" }}>
      <svg className="panel" width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ maxWidth: "100%", height: "auto" }} role="img"
           aria-label={`${tissue}: samples ranked by number of significant FRASER2 junctions`}>
        <text x={0} y={14} fontSize={13} fontWeight={600} fill={CHART.ink}>{tissue}</text>
        <text x={width - PAD.right} y={14} fontSize={11} fill={CHART.ink2} textAnchor="end">
          {n} samples · median {median} · {solved.length} solved
        </text>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke={CHART.grid} strokeWidth={1} />
            <text x={PAD.left - 6} y={y(t) + 4} fontSize={11} fill={CHART.ink2} textAnchor="end">{t}</text>
          </g>
        ))}
        <line x1={PAD.left} x2={width - PAD.right} y1={y(0)} y2={y(0)} stroke={CHART.axis} strokeWidth={1} />
        {samples.map((s, i) => {
          const x = PAD.left + i * slot + (slot - barW) / 2;
          const isSel = !!selectedSample && s.wgsSampleId === selectedSample;
          const h = Math.max(y(0) - y(s.count), s.count > 0 ? 1 : 0);
          return (
            <rect
              key={s.rnaSampleId} x={x} y={y(0) - h} width={barW} height={h}
              fill={s.solved ? CHART.accent : CHART.muted}
              stroke={isSel ? CHART.ink : "none"} strokeWidth={isSel ? 1.5 : 0}
              style={{ cursor: s.solved ? "pointer" : "default", opacity: selectedSample && !isSel && s.solved ? 0.45 : 1 }}
              onMouseMove={(e) => tip.show(e, [
                `${s.rnaSampleId}${s.wgsSampleId && s.wgsSampleId !== s.rnaSampleId ? ` (${s.wgsSampleId})` : ""}`,
                `${s.count} significant junctions · rank ${i + 1} of ${n}`,
                s.solved ? "solved" : "not solved / not in seqr",
              ])}
              onMouseLeave={tip.hide}
              onClick={() => s.solved && s.wgsSampleId && onSelectSample(isSel ? null : s.wgsSampleId)}
            />
          );
        })}
        {/* hit areas wider than thin bars so every sample is hoverable */}
        {barW < 6 && samples.map((s, i) => (
          <rect key={`hit-${s.rnaSampleId}`} x={PAD.left + i * slot} y={PAD.top} width={slot} height={PLOT_H} fill="transparent"
                style={{ cursor: s.solved ? "pointer" : "default" }}
                onMouseMove={(e) => tip.show(e, [
                  `${s.rnaSampleId}${s.wgsSampleId && s.wgsSampleId !== s.rnaSampleId ? ` (${s.wgsSampleId})` : ""}`,
                  `${s.count} significant junctions · rank ${i + 1} of ${n}`,
                  s.solved ? "solved" : "not solved / not in seqr",
                ])}
                onMouseLeave={tip.hide}
                onClick={() => s.solved && s.wgsSampleId && onSelectSample(selectedSample === s.wgsSampleId ? null : s.wgsSampleId)} />
        ))}
        {/* direct labels: solved samples, drawn above their bar; skipped when they would collide */}
        {(() => {
          let lastX = -Infinity;
          return samples.map((s, i) => {
            if (!s.solved) return null;
            const cx = PAD.left + i * slot + slot / 2;
            if (cx - lastX < 34) return null;
            lastX = cx;
            return (
              <text key={`lbl-${s.rnaSampleId}`} x={cx} y={y(s.count) - 4} fontSize={10} fill={CHART.ink} textAnchor="middle">
                {s.wgsSampleId ?? s.rnaSampleId}
              </text>
            );
          });
        })()}
        <text x={PAD.left + plotW / 2} y={height - 6} fontSize={11} fill={CHART.ink2} textAnchor="middle">samples, ranked by outlier count</text>
      </svg>
      {tip.element}
    </div>
  );
}
