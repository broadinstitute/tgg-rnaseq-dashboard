# RNA-seq Dashboard

For each solved RNA-seq sample, the dashboard lists the seqr-tagged variants and shows whether the
RNA-seq data supports them: FRASER2 splicing outliers in the solved gene, and the gene's expression
(TPM) against the tissue cohort.

**Site:** https://broadinstitute.github.io/tgg-rnaseq-dashboard/

## Using the dashboard

1. **Sign in with Google** with your Broad account. The page reads its inputs from a Google Cloud
   Storage bucket with your own permissions; nothing is uploaded to any server.
2. **Pick a FRASER2 release.** Each run of FRASER2 is a dated folder in the bucket, newest first.
3. **Build solved table.** Filter by tissue and solved status, sort any column, click a bar in the
   consequence chart to list those variants, and download the table as TSV.
4. **Save to release** writes the table back into the release folder as `solved_table.csv`.

To use your own tables, drop them on the page; they replace the bucket copy of the same input and are
parsed in the browser only.

### Publishing a FRASER2 run

Upload the result tables to a new dated folder; the file name should contain the tissue:

```
gsutil cp muscle_200_samples.csv fibroblasts_169_samples.csv gs://<bucket>/dashboard/releases/11_12_2026/
```

## For maintainers

- **Setup, data refresh and deployment:** [docs/SETUP.md](docs/SETUP.md)
- **Python pipeline:** `main.py` builds the same table locally (`conda activate hail && python main.py`);
  `tests/` and `dashboard/src/**/*.test.ts` check both implementations against shared fixtures.
