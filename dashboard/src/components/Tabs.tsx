import { useEffect } from "react";

export interface Tab { id: string; label: string }

/** Page navigation. The active tab is mirrored in the URL hash (#table, #consequence, …) so views are linkable. */
export default function Tabs({ tabs, active, onChange }: { tabs: Tab[]; active: string; onChange: (id: string) => void }) {
  useEffect(() => {
    const fromHash = () => {
      const id = location.hash.replace(/^#/, "");
      if (id && tabs.some((t) => t.id === id) && id !== active) onChange(id);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [tabs, active, onChange]);

  const go = (id: string) => {
    if (location.hash !== `#${id}`) history.replaceState(null, "", `#${id}`);
    onChange(id);
  };

  return (
    <nav className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={t.id === active} className={t.id === active ? "active" : undefined} onClick={() => go(t.id)}>
          {t.label}
        </button>
      ))}
    </nav>
  );
}
