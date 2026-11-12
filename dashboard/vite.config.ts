import { defineConfig, searchForWorkspaceRoot } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

/** Where the Python pipeline writes solved_table.csv (utils.py: ROOT_DIR / "Data/rnaseq_dashboard").
 *  Only the dev server reads it, for preview.html; nothing from this folder is bundled or deployed. */
export const DATA_DIR = path.resolve(__dirname, "../../Data/rnaseq_dashboard");

// Relative base so the build works both at https://<org>.github.io/<repo>/ and on a custom CNAME host.
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: "./",
  // preview.html is a dev-server-only page: never built or deployed, and the local path is only injected in dev.
  define: { __DATA_DIR__: JSON.stringify(command === "serve" ? DATA_DIR : "") },
  server: { fs: { allow: [searchForWorkspaceRoot(process.cwd()), DATA_DIR] } },
  build: { rollupOptions: { input: { main: "index.html" } } },
  test: { environment: "node" },
}));
