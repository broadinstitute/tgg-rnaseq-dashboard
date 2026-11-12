# RNA-seq solved-case dashboard

Static single-page app, hosted on GitHub Pages, that builds the solved table in the browser.
It follows the TGG viewer pattern: the page is public, the data is not. Users sign in with
Google and the browser reads the input files straight from a Google Cloud Storage bucket with
the user's own read-only token. Nothing is uploaded to any server; the only network traffic is
Google sign-in and bucket reads.

## Inputs

The page reads two bucket locations, set in `public/config.json`:

- **`sharedFolder`** — maintained by the scheduled export job, never touched by users: seqr metadata
  (`solved_status`), RNA-seq metadata (RNA id → WGS id, tissue), the GENCODE gene map, one TPM matrix
  per tissue (`<tissue>_gene_tpm.csv.gz`), and the two seqr variant exports.
- **`releasesFolder`** — dated subfolders such as `releases/11_12_2026/` into which a user uploads the
  FRASER2 result tables for a run. Every table in the folder is treated as FRASER2 results; the tissue
  is read from the file name (`muscle_200_samples.csv` → muscle) or picked in the page. The newest
  folder is selected by default. **Save to release** writes the built `solved_table.csv` back into it.

Any input can be overridden by dropping a file on the page; files are recognised by their columns and
parsed in the browser only. The GENCODE gene map is also bundled with the page (`public/gene_map.csv`).

Required: seqr metadata, RNA-seq metadata, the two seqr variant tables, and at least one tissue with
both a FRASER2 table and a TPM matrix. A tissue with only one of the two builds with blank columns.

## One-time setup

1. **OAuth client ID.** In the Google Cloud console of the project that owns the bucket, create an
   OAuth 2.0 client ID of type "Web application". Add the dashboard origin(s) to *Authorized
   JavaScript origins*, e.g. `https://broadinstitute.github.io` and `http://localhost:5173`.
   Put the client ID in `public/config.json` as `googleClientId`.
2. **Bucket CORS.** The browser reads objects with the JSON API, which needs a CORS rule on the bucket:
   ```json
   [{"origin": ["https://broadinstitute.github.io", "http://localhost:5173"],
     "method": ["GET", "POST"], "responseHeader": ["Authorization", "Content-Type"], "maxAgeSeconds": 3600}]
   ```
   Apply with `gsutil cors set cors.json gs://<bucket>`.
3. **Access control.** Grant `roles/storage.objectUser` on the bucket (or the `dashboard/` prefix) to the
   Google Group of allowed users: read for all inputs, write so the page can save `solved_table.csv` into
   a release folder. That IAM binding is the access control for the dashboard.
4. **Export the shared inputs once** (hail env, from the project root), then keep them fresh with a
   scheduled run. The script needs Airtable access (as `main.py` does) and `gsutil` with write access:
   ```
   python export_dashboard_inputs.py --session-id <seqr sessionid> --shared-only --upload gs://<bucket>/dashboard/shared/
   ```
   Scheduled refresh, e.g. weekly on a Broad VM (`crontab -e`); Airtable metadata and TPM matrices update
   unattended, seqr solved status only when someone runs it with `--session-id`:
   ```
   0 6 * * 1  cd /path/to/rnaseq-dashboard && /path/to/anaconda3/envs/hail/bin/python export_dashboard_inputs.py --shared-only --upload gs://<bucket>/dashboard/shared/ >> export.log 2>&1
   ```
5. **Publish a FRASER2 run**: upload its result tables to a new dated folder:
   ```
   gsutil cp muscle_200_samples.csv fibroblasts_169_samples.csv gs://<bucket>/dashboard/releases/11_12_2026/
   ```
   Users of the bucket need `roles/storage.objectUser` (read + write) on it so the page can save the
   solved table back into the release folder.

## Develop, test, deploy

```
cd dashboard
npm install
npm run dev        # http://localhost:5173
npm test           # pipeline unit tests (mirror of ../tests/test_solved_table.py)
npm run build
npm run deploy     # builds and pushes dist/ to the gh-pages branch
```

`npm run deploy` needs the repo on GitHub with Pages set to serve the `gh-pages` branch.
For a custom hostname add a `CNAME` file in this folder; it is copied into the build.
