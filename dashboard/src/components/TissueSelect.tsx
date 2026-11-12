/** Page-level tissue filter: drives the summary, the charts and the table together. */
export default function TissueSelect({ tissues, value, onChange }: { tissues: string[]; value: string; onChange: (t: string) => void }) {
  return (
    <label className="row tissue-select">
      Tissue
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">all tissues</option>
        {tissues.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
    </label>
  );
}
