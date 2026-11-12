export interface DashboardConfig {
  googleClientId: string;
  /** Maintained by the scheduled export job: seqr metadata, RNA-seq metadata, gene map, TPM matrices, seqr variants. */
  sharedFolder: string;
  /** Parent of dated release folders; each holds the FRASER2 tables a user uploaded (e.g. releases/11_12_2026/). */
  releasesFolder: string;
  padjCutoff: number;
}

/** config.json lives next to index.html (public/), like the TGG viewer's settings JSON. */
export async function loadConfig(): Promise<DashboardConfig> {
  const r = await fetch(`${import.meta.env.BASE_URL}config.json`, { cache: "no-store" });
  if (!r.ok) throw new Error(`Could not load config.json (${r.status})`);
  return (await r.json()) as DashboardConfig;
}
