import type { Cohort } from "../types";

/** Solved | Unsolved: which individuals the summary, table and plots describe. */
export default function CohortSwitch({ value, counts, onChange }: {
  value: Cohort; counts: Record<Cohort, number>; onChange: (c: Cohort) => void;
}) {
  const items: { id: Cohort; label: string; purpose: string; title: string }[] = [
    { id: "solved", label: "Solved", purpose: "validation", title: "Solved individuals; rows are their seqr-tagged variants" },
    { id: "unsolved", label: "Unsolved with seqr variants", purpose: "prioritization", title: "Unsolved individuals with seqr-tagged variants; rows are those variants" },
    { id: "untagged", label: "Unsolved with no seqr variants", purpose: "discovery", title: "Unsolved individuals with no seqr-tagged variants; rows are genes with FRASER2 outliers in constrained or disease-associated genes" },
  ];
  return (
    <div className="segmented" role="radiogroup" aria-label="Cohort">
      {items.map((it) => (
        <button key={it.id} role="radio" aria-checked={value === it.id} className={value === it.id ? "active" : undefined} title={it.title} onClick={() => onChange(it.id)}>
          {it.label} <span className="count">{counts[it.id]}</span>
          <span className={`badge badge-${it.purpose}`}>{it.purpose}</span>
        </button>
      ))}
    </div>
  );
}
