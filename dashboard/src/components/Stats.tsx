export interface StatItem { value: string | number; label: string }

export default function Stats({ items, title = "Build summary" }: { items: StatItem[]; title?: string }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      <ul className="stats">
        {items.map((it, i) => (
          <li key={i}><b>{it.value}</b><span className="muted small">{it.label}</span></li>
        ))}
      </ul>
    </section>
  );
}
