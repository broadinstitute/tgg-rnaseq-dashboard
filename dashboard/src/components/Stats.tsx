import type React from "react";

export interface StatItem { value: string | number; label: string }

/** One-line strip: stats packed on the left, an optional control (e.g. the tissue selector) on the right. */
export default function Stats({ items, aside }: { items: StatItem[]; aside?: React.ReactNode }) {
  return (
    <section className="card stats-strip">
      <ul className="stats">
        {items.map((it, i) => (
          <li key={i}><b>{it.value}</b><span className="muted small">{it.label}</span></li>
        ))}
      </ul>
      {aside && <div className="stats-aside">{aside}</div>}
    </section>
  );
}
