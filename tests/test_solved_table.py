"""End-to-end test of main.main() on small synthetic inputs.

Run from the project root with the hail env:
    conda activate hail && python -m pytest tests -v

Airtable, seqr metadata, the GENCODE gene map, and all data paths are replaced with local
fixtures, so no network access or real data is needed.
"""
import gzip
import logging
import sys
import types
from pathlib import Path

import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# Stub tgg_rnaseq_pipelines before importing main/reference so the test does not need Airtable.
_meta = types.ModuleType("tgg_rnaseq_pipelines.rnaseq_sample_metadata.metadata_utils")
_meta.RNA_SEQ_BASE_ID = _meta.DATA_PATHS_TABLE_ID = _meta.DATA_PATHS_VIEW_ID = "stub"
_meta.read_from_airtable = lambda *a, **k: _meta.RNA_DF
for name, mod in [
    ("tgg_rnaseq_pipelines", types.ModuleType("tgg_rnaseq_pipelines")),
    ("tgg_rnaseq_pipelines.rnaseq_sample_metadata", types.ModuleType("tgg_rnaseq_pipelines.rnaseq_sample_metadata")),
    ("tgg_rnaseq_pipelines.rnaseq_sample_metadata.metadata_utils", _meta),
]:
    sys.modules.setdefault(name, mod)

import main        # noqa: E402
import reference   # noqa: E402


def write_gct(path, sample, genes, values):
    with gzip.open(path, "wt") as fh:
        fh.write(f"#1.2\n{len(genes)}\t1\nName\tDescription\t{sample}\n")
        for (gene_id, symbol), v in zip(genes, values):
            fh.write(f"{gene_id}\t{symbol}\t{v}\n")


@pytest.fixture
def fixtures(tmp_path, monkeypatch):
    d = tmp_path

    # seqr "All Variant Metadata": ABG05 has two TNNI1 variants, ABG06 has a NaN hgvsc, ZZZ has no RNA-seq.
    pd.DataFrame({
        "participant_id": ["ABG05", "ABG05", "MNG01", "ZZZ", "ABG06"],
        "gene_of_interest": ["TNNI1", "TNNI1", "SAMD11", "G", "DMD"],
        "seqr_chosen_consequence": ["missense_variant", "splice_donor_variant", "missense_variant", "x", None],
        "transcript": ["ENST1", "ENST1", "ENST2", "ENST3", "ENST4"],
        "hgvsc": ["c.1A>G", "c.2A>G", "c.3A>G", "c.4A>G", None],
        "extra": 1,
    }).to_csv(d / "all_v.csv", index=False)

    # analyst priority variants (wide): ENST1:c.1A>G is shared with all_v for ABG05.
    pd.DataFrame({
        "gene": ["TNNI1", "SAMD11", "TTN", "TNNI1-AS1"],
        "worst_consequence": ["missense_variant", "intron_variant", "frameshift_variant", "intron_variant"],
        "hgvsc": ["ENST1:c.1A>G", "ENST2:c.9A>G", "ENST5:c.5A>G", "ENST1:c.2A>G"],
        "sample_1": ["ABG05", "MNG01", "ABG06", "ABG05"],
        "sample_2": [None, None, None, None],
        "sample_3": [None, "ABG05", None, None],
        "num_samples_with_variant": [3, 1, 2, 1],   # must not be melted as a sample column
        "other": 0,
    }).to_csv(d / "priority_v.csv", index=False)

    # RNA-seq metadata: ABG06 has two RNA samples in different tissues.
    rna = pd.DataFrame({
        "sample_id": ["ABG05", "MNG01", "ABG06_R1", "ABG06_R2", "OTHER", "ABG05_B", "BAD01"],
        "imputed_tissue": ["muscle", "muscle", "fibroblasts", "muscle", "muscle", "whole_blood", "muscle"],
        "wgs_sample_id": ["ABG05", "MNG01", "ABG06", "ABG06", "OTHER", "ABG05", "BAD01"],
        "exclude": [None, None, None, None, None, None, "yes"],   # BAD01 is flagged in Airtable
        "junk": 1,
    })
    rna["rnaseqc_gene_tpm"] = [str(d / f"{s}.gct.gz") for s in rna["sample_id"]]
    _meta.RNA_DF = rna

    genes = [("ENSG1.1", "TNNI1"), ("ENSG2.1", "SAMD11"), ("ENSG4.1", "DMD"), ("ENSG5.1", "TTN"), ("ENSG4b.1", "DMD")]
    tpms = {
        "ABG05": [10, 1, 5, 7, 0], "MNG01": [20, 2, 6, 8, 0], "ABG06_R1": [30, 3, 1, 9, 0],
        "ABG06_R2": [40, 4, 2, 10, 0], "OTHER": [50, 5, 100, 11, 0], "ABG05_B": [1, 1, 1, 1, 0],
        "BAD01": [1000, 1000, 1000, 1000, 0],   # would skew the muscle median if not excluded
    }
    for sample, values in tpms.items():
        write_gct(d / f"{sample}.gct.gz", sample, genes, values)

    cols = ["seqnames", "start", "end", "strand", "sampleID", "hgncSymbol", "padjust", "deltaPsi", "pValue"]
    pd.DataFrame([
        ["chr1", 1, 2, "+", "ABG05", "ENSG1", 1e-5, -0.9, 1e-9],
        ["chr1", 3, 4, "+", "ABG05", "ENSG1", 0.01, 0.4, 1e-4],
        ["chr1", 5, 6, "+", "ABG05", "ENSG1", 0.5, 0.1, 0.1],       # not significant
        ["chr1", 7, 8, "+", "MNG01", "ENSG5", 0.001, 0.3, 1e-6],    # gene without seqr variant
        ["chr1", 9, 10, "+", "ABG06_R2", "ENSG4", 0.02, -0.5, 1e-3],
    ], columns=cols).to_csv(d / "muscle.csv", index=False)
    pd.DataFrame([["chrX", 1, 2, "+", "ABG06_R1", "ENSG4", 0.03, -0.6, 1e-3]], columns=cols).to_csv(d / "fibro.csv", index=False)

    # seqr metadata: OTHER is unsolved and has no variants anyway; everyone else is Solved.
    seqr_meta = pd.DataFrame({
        "project": "p1",
        "individual_id": ["ABG05", "MNG01", "ABG06", "OTHER", "ZZZ"],
        "sex": "F",
        "solved_status": ["Solved", "Partially solved", "Probably solved", "Unsolved", "Solved"],
    })
    monkeypatch.setattr(main, "load_seqr_metadata", lambda session_id=None: seqr_meta)
    monkeypatch.setattr(main, "all_variant_metadata", d / "all_v.csv")
    monkeypatch.setattr(main, "priority_variant_metadata", d / "priority_v.csv")
    monkeypatch.setattr(main, "FRASER_FILES", {"muscle": d / "muscle.csv", "fibroblasts": d / "fibro.csv"})
    monkeypatch.setattr(main, "SOLVED_TABLE_PATH", d / "solved_table.csv")
    monkeypatch.setattr(main, "TPM_CACHE_DIR", d / "tpm_cache")
    monkeypatch.setattr(reference, "read_gencode_gff", lambda p: pd.DataFrame({
        "gene_id": ["ENSG1", "ENSG2", "ENSG4", "ENSG5"],
        "gene_name": ["TNNI1", "SAMD11", "DMD", "TTN"],
    }))
    return d


def test_solved_table(fixtures, caplog):
    caplog.set_level(logging.INFO)
    table = main.main()

    assert list(table.columns) == main.OUTPUT_COLUMNS
    assert (fixtures / "solved_table.csv").exists()
    assert (fixtures / "tpm_cache" / "muscle_gene_tpm.parquet").exists()

    # One row per (sample, tissue, hgvsc); ZZZ (no RNA-seq), the NaN hgvsc row, and ABG05's
    # whole_blood sample (no FRASER2 file for that tissue) are dropped.
    assert "whole_blood" not in set(table["Tissue"])
    keys = set(zip(table["Sample_ID"], table["Tissue"], table["hgvsc"]))
    assert keys == {
        ("ABG05", "muscle", "ENST1:c.1A>G"), ("ABG05", "muscle", "ENST1:c.2A>G"), ("ABG05", "muscle", "ENST2:c.9A>G"),
        ("ABG06", "fibroblasts", "ENST5:c.5A>G"), ("ABG06", "muscle", "ENST5:c.5A>G"),
        ("MNG01", "muscle", "ENST2:c.3A>G"), ("MNG01", "muscle", "ENST2:c.9A>G"),
    }
    assert len(table) == 7

    row = table.set_index(["Sample_ID", "Tissue", "hgvsc"])

    # ENST1:c.2A>G is TNNI1 in all_v and TNNI1-AS1 in the priority table: both genes on one row,
    # evidence pooled across them (TNNI1-AS1 has no TPM row, so TPM lists TNNI1 only).
    both = row.loc[("ABG05", "muscle", "ENST1:c.2A>G")]
    assert both["Solved_gene"] == "TNNI1; TNNI1-AS1"
    assert both["Seqr_tagged_variants (N>0)"] == 2
    assert both["Seqr_variant_consequence"] == "intron_variant; missense_variant; splice_donor_variant"
    assert both["FRASER2_sig_outlier_count"] == 2
    assert both["TPM_in_sample"] == "10"

    tnni1 = row.loc[("ABG05", "muscle", "ENST1:c.1A>G")]
    assert tnni1["Solved_gene"] == "TNNI1"
    assert tnni1["Solved_status"] == "Solved"
    assert row.loc[("MNG01", "muscle", "ENST2:c.3A>G")]["Solved_status"] == "Partially solved"
    assert row.loc[("ABG06", "muscle", "ENST5:c.5A>G")]["Solved_status"] == "Probably solved"
    assert tnni1["Seqr_tagged_variants (N>0)"] == 2
    assert tnni1["Seqr_variant_consequence"] == "missense_variant; splice_donor_variant"
    assert tnni1["FRASER2_sig_outlier_count"] == 2            # padjust 0.5 row excluded
    assert tnni1["delta_psi"] == "-0.9; 0.4"                  # sorted by padjust
    assert tnni1["p-value"] == "1e-05; 0.01"
    assert tnni1["TPM_in_sample"] == "10"
    assert tnni1["Median_TPM_in_tissue_cohort"] == "30.0"      # median of 10, 20, 40, 50; BAD01 (exclude=yes) left out

    # MNG01 has a FRASER outlier in TTN but no seqr TTN variant, so SAMD11 rows show 0.
    samd11 = row.loc[("MNG01", "muscle", "ENST2:c.3A>G")]
    assert samd11["FRASER2_sig_outlier_count"] == 0
    assert samd11["Seqr_variant_consequence"] == "intron_variant; missense_variant"

    # ABG06 has RNA-seq in two tissues: one row per tissue with tissue-specific values.
    ttn_fib = row.loc[("ABG06", "fibroblasts", "ENST5:c.5A>G")]
    assert ttn_fib["TPM_in_sample"] == "9"
    assert ttn_fib["Median_TPM_in_tissue_cohort"] == "9.0"     # only fibroblast sample
    ttn_mus = row.loc[("ABG06", "muscle", "ENST5:c.5A>G")]
    assert ttn_mus["TPM_in_sample"] == "10"
    assert ttn_mus["Median_TPM_in_tissue_cohort"] == "9.0"     # median of 7, 8, 10, 11
    assert ttn_mus["FRASER2_sig_outlier_count"] == 0           # DMD outliers, not TTN

    # Overlap stats were logged.
    assert "shared: 2 unique (sample, hgvsc) pairs" in caplog.text


def test_tpm_cache_reused(fixtures):
    main.main()
    cache = fixtures / "tpm_cache" / "muscle_gene_tpm.parquet"
    mtime = cache.stat().st_mtime
    main.main()
    assert cache.stat().st_mtime == mtime


def test_tpm_cache_rebuilt_when_cohort_changes(fixtures):
    main.main()
    cache = fixtures / "tpm_cache" / "muscle_gene_tpm.parquet"
    assert "NEW" not in pd.read_parquet(cache).columns

    # a new muscle sample appears in Airtable
    write_gct(fixtures / "NEW.gct.gz", "NEW", [("ENSG1.1", "TNNI1")], [99])
    rna = _meta.RNA_DF
    _meta.RNA_DF = pd.concat([rna, pd.DataFrame([{
        "sample_id": "NEW", "imputed_tissue": "muscle", "wgs_sample_id": "NEW", "junk": 1,
        "rnaseqc_gene_tpm": str(fixtures / "NEW.gct.gz"),
    }])], ignore_index=True)
    main.main()
    assert "NEW" in pd.read_parquet(cache).columns


def test_tpm_cache_rebuilt_when_gct_path_changes(fixtures):
    main.main()
    cache = fixtures / "tpm_cache" / "muscle_gene_tpm.parquet"
    assert pd.read_parquet(cache).at["TNNI1", "ABG05"] == 10

    # RNA-SeQC re-run for ABG05: same sample_id, new file with different values
    write_gct(fixtures / "ABG05_v2.gct.gz", "ABG05", [("ENSG1.1", "TNNI1")], [77])
    rna = _meta.RNA_DF.copy()
    rna.loc[rna["sample_id"] == "ABG05", "rnaseqc_gene_tpm"] = str(fixtures / "ABG05_v2.gct.gz")
    _meta.RNA_DF = rna
    main.main()
    assert pd.read_parquet(cache).at["TNNI1", "ABG05"] == 77


def test_unsolved_samples_excluded(fixtures, monkeypatch):
    seqr_meta = pd.DataFrame({
        "project": "p1",
        "individual_id": ["ABG05", "MNG01", "ABG06"],
        "sex": "F",
        "solved_status": ["Solved", "Unsolved", "Solved"],
    })
    monkeypatch.setattr(main, "load_seqr_metadata", lambda session_id=None: seqr_meta)
    table = main.main()
    assert set(table["Sample_ID"]) == {"ABG05", "ABG06"}


def test_empty_result_writes_empty_table(fixtures, monkeypatch):
    seqr_meta = pd.DataFrame({"project": [], "individual_id": [], "sex": [], "solved_status": []})
    monkeypatch.setattr(main, "load_seqr_metadata", lambda session_id=None: seqr_meta)
    table = main.main()
    assert len(table) == 0
    assert list(table.columns) == main.OUTPUT_COLUMNS
