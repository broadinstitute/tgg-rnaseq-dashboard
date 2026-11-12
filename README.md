# RNA-seq Dashboard

Builds a **solved table** for RNA-seq samples whose individual is solved in seqr: for each solved
sample, variant and tissue, the seqr-tagged variants and consequences, FRASER2 splicing outliers in the
solved gene, and the gene's TPM against the tissue cohort median.

Two implementations of the same pipeline, tested against the same fixtures:

| | Where it runs | Entry point |
|---|---|---|
| Python | locally, in the `hail` conda env | `main.py` → `Data/rnaseq_dashboard/solved_table.csv` |
| Dashboard | in the browser, hosted on GitHub Pages | `dashboard/` |

## Python pipeline

```
conda activate hail
python main.py                      # reuses the saved seqr metadata
python main.py --session-id <seqr sessionid cookie>   # refreshes it first
python -m pytest tests -v
```

Inputs come from the data folder set in `utils.py` (seqr exports, FRASER2 results, GENCODE GFF),
Airtable (RNA-seq sample metadata) and the per-sample RNA-SeQC gene TPM files in Google Cloud Storage.
Column names of every input live in `schema.py`. `get_seqr_metadata.py` fetches solved status from
seqr; `export_dashboard_inputs.py` writes the dashboard's shared inputs (see below).

## Dashboard

Static single-page app, hosted on GitHub Pages, that builds the solved table in the browser.
It follows the TGG viewer pattern: the page is public, the data is not. Users sign in with
Google and the browser reads the input files straight from a Google Cloud Storage bucket with
the user's own token. Nothing is uploaded to any server; the only network traffic is Google
sign-in and bucket reads (plus one bucket write when a user saves the solved table).

### Inputs

The page reads two bucket locations, set in `dashboard/public/config.json`:

- **`sharedFolder`** — maintained by the export job, never touched by users: seqr metadata
  (`solved_status`), RNA-seq metadata (RNA id → WGS id, tissue), the GENCODE gene map, one TPM matrix
  per tissue (`<tissue>_gene_tpm.csv.gz`), and the two seqr variant exports.
- **`releasesFolder`** — dated subfolders such as `releases/11_12_2026/` into which a user uploads the
  FRASER2 result tables for a run. Every table in the folder is treated as FRASER2 results; the tissue
  is read from the file name (`muscle_200_samples.csv` → muscle) or picked in the page. The newest
  folder is selected by default. **Save to release** writes the built `solved_table.csv` back into it.

Any input can be overridden by dropping a file on the page; files are recognised by their columns and
parsed in the browser only. The GENCODE gene map is also bundled with the page
(`dashboard/public/gene_map.csv`).

Required: seqr metadata, RNA-seq metadata, the two seqr variant tables, and at least one tissue with
both a FRASER2 table and a TPM matrix. A tissue with only one of the two builds with blank columns.

### One-time setup

1. **OAuth client ID.** In a Google Cloud project you can edit, create an OAuth 2.0 client ID of type
   "Web application". Add the dashboard origins to *Authorized JavaScript origins*:
   `https://broadinstitute.github.io` and `http://localhost:5173`. No redirect URIs.
   Put the client ID in `dashboard/public/config.json` as `googleClientId`. It is public by design.
2. **Bucket CORS.** The browser reads objects with the JSON API, which needs a CORS rule on the bucket:
   ```json
   [{"origin": ["https://broadinstitute.github.io", "http://localhost:5173"],
     "method": ["GET", "POST"], "responseHeader": ["Authorization", "Content-Type"], "maxAgeSeconds": 3600}]
   ```
   Apply with `gsutil cors set cors.json gs://<bucket>`.
3. **Access control.** Grant `roles/storage.objectUser` on the bucket (or the `dashboard/` prefix) to the
   Google Group of allowed users: read for all inputs, write so the page can save `solved_table.csv` into
   a release folder. That IAM binding is the access control for the dashboard.
4. **Export the shared inputs** (hail env, from the project root). Needs Airtable access, as `main.py`
   does, and `gsutil` with write access:
   ```
   python export_dashboard_inputs.py --session-id <seqr sessionid> --shared-only --upload gs://<bucket>/dashboard/shared/
   ```
   Rerun it when samples are added or seqr status changes. A scheduled refresh (weekly cron on a Broad
   VM) is planned; Airtable metadata and TPM matrices can update unattended, seqr solved status only
   when someone runs it with `--session-id`:
   ```
   0 6 * * 1  cd /path/to/rnaseq-dashboard && /path/to/anaconda3/envs/hail/bin/python export_dashboard_inputs.py --shared-only --upload gs://<bucket>/dashboard/shared/ >> export.log 2>&1
   ```
5. **Publish a FRASER2 run**: upload its result tables to a new dated folder:
   ```
   gsutil cp muscle_200_samples.csv fibroblasts_169_samples.csv gs://<bucket>/dashboard/releases/11_12_2026/
   ```

### Develop, test, deploy

```
cd dashboard
npm install
npm run dev        # http://localhost:5173  (preview.html shows the Python output without sign-in)
npm test           # pipeline unit tests (mirror of tests/test_solved_table.py)
npm run build
npm run deploy     # builds and pushes dist/ to the gh-pages branch
```

`npm run deploy` needs the repo on GitHub with Pages set to serve the `gh-pages` branch.
For a custom hostname add a `CNAME` file in `dashboard/`; it is copied into the build.
