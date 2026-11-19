/** Shared chart scaffolding: palette tokens, a card with title + download buttons, and a tooltip hook. */
import React, { useRef, useState } from "react";
import { composeSvg, downloadPng, downloadSvg, type LegendItem } from "../data/exportSvg";

export const CHART = {
  accent: "#2a78d6",   // categorical slot 1 (validated)
  muted: "#c9ccd1",    // de-emphasis grey for context marks
  ink: "#1f2933",
  ink2: "#52606d",
  ink3: "#9aa5b1",
  grid: "#e1e0d9",
  axis: "#c3c2b7",
  surface: "#ffffff",
};

interface CardProps {
  title: string;
  hint?: React.ReactNode;
  legend: LegendItem[];
  /** Used in the downloaded file name. */
  fileStem: string;
  children: React.ReactNode;
}

/** A chart card: header with title and SVG/PNG download, a legend row, then the panels (each an <svg class="panel">). */
export function ChartCard({ title, hint, legend, fileStem, children }: CardProps) {
  const card = useRef<HTMLElement>(null);
  const exportChart = async (format: "svg" | "png") => {
    const svgs = Array.from(card.current?.querySelectorAll<SVGSVGElement>("svg.panel") ?? []);
    if (!svgs.length) return;
    const text = composeSvg(svgs, title, legend);
    if (format === "svg") downloadSvg(text, `${fileStem}.svg`);
    else await downloadPng(text, `${fileStem}.png`);
  };
  return (
    <section className="card chart" ref={card}>
      <div className="card-head">
        <div>
          <h2>{title}</h2>
          {hint && <div className="muted small">{hint}</div>}
        </div>
        <div className="row">
          <button className="quiet" onClick={() => exportChart("svg")} title="Vector image, editable in Illustrator / Inkscape">SVG</button>
          <button className="quiet" onClick={() => exportChart("png")} title="Image at 2× resolution">PNG</button>
        </div>
      </div>
      {legend.length > 1 && (
        <div className="row small legend">
          {legend.map((l) => <span key={l.label}><span className="swatch" style={{ background: l.color }} /> {l.label}</span>)}
        </div>
      )}
      {children}
    </section>
  );
}

/** Tooltip anchored to the mouse inside a positioned wrapper; works in every browser (uses client coords). */
export function useTooltip() {
  const wrap = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; lines: string[] } | null>(null);
  const show = (e: React.MouseEvent, lines: string[]) => {
    const b = wrap.current?.getBoundingClientRect();
    setTip({ x: e.clientX - (b?.left ?? 0), y: e.clientY - (b?.top ?? 0), lines });
  };
  const hide = () => setTip(null);
  const element = tip ? (
    <div className="tooltip" style={{ left: tip.x + 12, top: tip.y - 8 }}>
      {tip.lines.map((l, i) => <div key={i} className={i ? "tooltip-item" : undefined}>{l}</div>)}
    </div>
  ) : null;
  return { wrap, show, hide, element };
}

export function niceTicks(max: number, target = 6): number[] {
  if (max <= 0) return [0];
  const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000].find((s) => max / s <= target) ?? Math.ceil(max / target);
  const out: number[] = [];
  for (let t = 0; t <= max; t += step) out.push(t);
  return out;
}
