import type { Cohort } from "../types";

/** Solved | Unsolved: which individuals the summary, table and plots describe. */
export default function CohortSwitch({ value, counts, onChange }: {
  value: Cohort; counts: Record<Cohort, number>; onChange: (c: Cohort) => void;
}) {
  const items: { id: Cohort; label: string }[] = [{ id: "solved", label: "Solved cases" }, { id: "unsolved", label: "Unsolved cases" }];
  return (
    <div className="segmented" role="radiogroup" aria-label="Cohort">
      {items.map((it) => (
        <button key={it.id} role="radio" aria-checked={value === it.id} className={value === it.id ? "active" : undefined} onClick={() => onChange(it.id)}>
          {it.label} <span className="count">{counts[it.id]}</span>
        </button>
      ))}
    </div>
  );
}
