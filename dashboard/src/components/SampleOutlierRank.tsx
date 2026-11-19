import { useMemo } from "react";
import { CHART, ChartCard, niceTicks, useTooltip } from "./chart";
import type { SampleOutlierCount } from "../types";

/** Per tissue: every sample in the FRASER2 run ranked by its number of significant junctions (all genes).
 *  Solved samples are the emphasis series; the rest is context. Shows whether a solved sample's outlier
 *  sits in a quiet sample (meaningful) or a noisy one (less so). */

interface Props {
  data: SampleOutlierCount[];
  padjCutoff: number;
  /** Word for the highlighted samples: "solved" or "unsolved". */
  cohortLabel: string;
  width?: number;
  selectedSample: string | null;
  onSelectSample: (wgsSampleId: string | null) => void;
}

const PAD = { left: 48, right: 16, top: 26, bottom: 26 }, PLOT_H = 180, R = 3.5;

export default function SampleOutlierRank({ data, padjCutoff, cohortLabel, width = 960, selectedSample, onSelectSample }: Props) {
  const panels = useMemo(() => {
    const tissues = [...new Set(data.map((d) => d.tissue))].sort();
    return tissues.map((t) => ({ tissue: t, samples: data.filter((d) => d.tissue === t).sort((a, b) => b.count - a.count) }));
  }, [data]);
  const max = Math.max(1, ...data.map((d) => d.count));
  if (!panels.length) return null;

  return (
    <ChartCard
      title="Outliers per sample"
      hint={<>Significant junctions per sample at padj &lt; {padjCutoff}, <strong className="emph">ALL GENES</strong>. Dashed lines mark z = 2 and z = 3 (mean + 2 or 3 SD). Hover for the sample; click any sample to open it in its table.</>}
      legend={[{ color: CHART.accent, label: cohortLabel }, { color: CHART.muted, label: "other" }]}
      fileStem={`outliers_per_sample_${panels.length === 1 ? panels[0].tissue : "all_tissues"}`}
    >
      {panels.map((p) => (
        <Panel key={p.tissue} tissue={p.tissue} samples={p.samples} max={max} width={width} cohortLabel={cohortLabel}
               selectedSample={selectedSample} onSelectSample={onSelectSample} />
      ))}
    </ChartCard>
  );
}

function Panel({ tissue, samples, max, width, cohortLabel, selectedSample, onSelectSample }: {
  tissue: string; samples: SampleOutlierCount[]; max: number; width: number; cohortLabel: string;
  selectedSample: string | null; onSelectSample: (id: string | null) => void;
}) {
  const tip = useTooltip();
  const plotW = width - PAD.left - PAD.right;
  const height = PAD.top + PLOT_H + PAD.bottom;
  const n = samples.length;
  const slot = plotW / Math.max(n, 1);
  // linear axis
  const y = (v: number) => PAD.top + PLOT_H - (v / max) * PLOT_H;
  const ticks = niceTicks(max, 5);
  const inCohort = samples.filter((s) => s.inCohort);
  const median = n ? samples[Math.floor(n / 2)].count : 0;
  // z reference lines: mean + z·SD of the counts across the run
  const counts = samples.map((s) => s.count);
  const mean = counts.reduce((a, b) => a + b, 0) / Math.max(n, 1);
  const sd = Math.sqrt(counts.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(n - 1, 1));
  const zLines = [2, 3].map((z) => ({ z, value: mean + z * sd })).filter((l) => n > 2 && l.value <= max);

  return (
    <div ref={tip.wrap} style={{ position: "relative" }}>
      <svg className="panel" width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ maxWidth: "100%", height: "auto" }} role="img"
           aria-label={`${tissue}: samples ranked by number of significant FRASER2 junctions`}>
        <text x={0} y={14} fontSize={13} fontWeight={600} fill={CHART.ink}>{tissue}</text>
        <text x={width - PAD.right} y={14} fontSize={11} fill={CHART.ink2} textAnchor="end">
          {n} samples · median {median} · {inCohort.length} {cohortLabel}
        </text>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke={CHART.grid} strokeWidth={1} />
            <text x={PAD.left - 6} y={y(t) + 4} fontSize={11} fill={CHART.ink2} textAnchor="end">{t}</text>
          </g>
        ))}
        <line x1={PAD.left} x2={width - PAD.right} y1={y(0)} y2={y(0)} stroke={CHART.axis} strokeWidth={1} />
        {zLines.map((l) => (
          <g key={l.z}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(l.value)} y2={y(l.value)} stroke={CHART.ink2} strokeWidth={1.5} strokeDasharray="6 4" />
            <text x={width - PAD.right} y={y(l.value) - 5} fontSize={11} fill={CHART.ink2} textAnchor="end">z = {l.z}</text>
          </g>
        ))}
        {/* unsolved first so solved dots sit on top where they overlap */}
        {[...samples.map((s, i) => ({ s, i }))].sort((a, b) => Number(a.s.inCohort) - Number(b.s.inCohort)).map(({ s, i }) => {
          const cx = PAD.left + i * slot + slot / 2;
          const isSel = !!selectedSample && s.wgsSampleId === selectedSample;
          return (
            <circle
              key={s.rnaSampleId} cx={cx} cy={y(s.count)} r={R}
              fill={s.inCohort ? CHART.accent : CHART.muted}
              stroke={isSel ? CHART.ink : CHART.surface} strokeWidth={isSel ? 2 : 1.5}
              style={{ cursor: s.wgsSampleId ? "pointer" : "default", opacity: selectedSample && !isSel && s.inCohort ? 0.45 : 1 }}
            />
          );
        })}
        {/* one full-height hit area per sample so every dot is hoverable regardless of density */}
        {samples.map((s, i) => (
          <rect key={`hit-${s.rnaSampleId}`} x={PAD.left + i * slot} y={PAD.top - R} width={slot} height={PLOT_H + 2 * R} fill="transparent"
                style={{ cursor: s.wgsSampleId ? "pointer" : "default" }}
                onMouseMove={(e) => tip.show(e, [
                  `${s.rnaSampleId}${s.wgsSampleId && s.wgsSampleId !== s.rnaSampleId ? ` (${s.wgsSampleId})` : ""}`,
                  `${s.count} significant junctions · rank ${i + 1} of ${n}`,
                  s.inCohort ? cohortLabel : "other",
                  s.wgsSampleId ? "click to open in the table" : "not in the RNA-seq metadata",
                ])}
                onMouseLeave={tip.hide}
                onClick={() => s.wgsSampleId && onSelectSample(selectedSample === s.wgsSampleId ? null : s.wgsSampleId)} />
        ))}
        <text x={PAD.left + plotW / 2} y={height - 6} fontSize={11} fill={CHART.ink2} textAnchor="middle">samples, ranked by outlier count</text>
      </svg>
      {tip.element}
    </div>
  );
}
