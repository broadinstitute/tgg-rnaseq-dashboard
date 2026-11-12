# Setup and maintenance

The dashboard is a static page on GitHub Pages (TGG viewer pattern): the page is public, the data is
not. Users sign in with Google and the browser reads the bucket with the user's token.

## Bucket layout

```
gs://<bucket>/dashboard/
  shared/                 written by export_dashboard_inputs.py; users never touch it
    seqr_metadata.csv         project, individual_id, sex, solved_status
    rnaseq_metadata.csv       sample_id, imputed_tissue, wgs_sample_id   (Airtable)
    gene_map.csv              GENCODE ENSG → symbol
    <tissue>_gene_tpm.csv.gz  genes × RNA samples TPM matrix, one per tissue
    all_variants.csv, priority_variants.csv   the two seqr variant exports
  releases/<date>/        FRASER2 result tables uploaded by users; solved_table.csv saved back here
```

Both locations are set in `dashboard/public/config.json` (`sharedFolder`, `releasesFolder`).

## One-time setup

1. **OAuth client ID** (Google Cloud console → APIs & Services → Credentials): type *Web application*,
   authorized JavaScript origins `https://broadinstitute.github.io` and `http://localhost:5173`, no
   redirect URIs. Put the ID in `config.json` as `googleClientId`; it is public by design.
2. **Bucket CORS** — the browser uses the JSON API:
   ```json
   [{"origin": ["https://broadinstitute.github.io", "http://localhost:5173"],
     "method": ["GET", "POST"], "responseHeader": ["Authorization", "Content-Type"], "maxAgeSeconds": 3600}]
   ```
   `gsutil cors set cors.json gs://<bucket>`
3. **Access control** — grant `roles/storage.objectUser` on the bucket (or the `dashboard/` prefix) to
   the Google Group of allowed users. Read covers the inputs; write lets the page save the solved table.

## Refreshing the shared data

From the project root in the `hail` conda env (needs Airtable access and `gsutil` write access):

```
python export_dashboard_inputs.py --session-id <seqr sessionid> --shared-only --upload gs://<bucket>/dashboard/shared/
```

Rerun when samples are added or seqr status changes. TPM matrices are cached under
`Data/rnaseq_dashboard/tpm_cache/` and rebuild automatically when the cohort changes.

Automating this is planned. Airtable metadata and TPM matrices can refresh unattended; seqr solved
status needs a session ID, so that part stays a manual run. Example weekly cron on a Broad VM:

```
0 6 * * 1  cd /path/to/rnaseq-dashboard && /path/to/anaconda3/envs/hail/bin/python export_dashboard_inputs.py --shared-only --upload gs://<bucket>/dashboard/shared/ >> export.log 2>&1
```

## Develop and deploy

```
cd dashboard
npm install
npm run dev        # http://localhost:5173 ; preview.html shows the local Python output without sign-in
npm test
npm run deploy     # builds and pushes dist/ to the gh-pages branch
```

GitHub Pages must be set to serve the `gh-pages` branch. For a custom hostname add a `CNAME` file in
`dashboard/` once the DNS record exists, and add the hostname to the OAuth client's origins.

## Python pipeline

`main.py` builds `Data/rnaseq_dashboard/solved_table.csv` locally from the same inputs (paths in
`utils.py`); `schema.py` holds every input column name; `get_seqr_metadata.py` fetches solved status
from seqr. Run tests with `python -m pytest tests -v`.
