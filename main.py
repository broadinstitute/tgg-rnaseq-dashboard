import json
import logging
import argparse
from pathlib import Path
import pandas as pd
from utils import all_variant_metadata, priority_variant_metadata, fibroblasts_results, muscle_results, DATA_DIR
from reference import map_gene_id_to_gene_name
from get_seqr_metadata import load_seqr_metadata, SOLVED_STATUSES
from schema import (SeqrAllVariants, SeqrPriorityVariants, SeqrMetadata, Airtable, Fraser, Gct, Variant,
                    OUTPUT_COLUMNS, require_columns)
from tgg_rnaseq_pipelines.rnaseq_sample_metadata.metadata_utils import read_from_airtable, RNA_SEQ_BASE_ID, DATA_PATHS_TABLE_ID, DATA_PATHS_VIEW_ID

logger = logging.getLogger(__name__)

# Transcriptome-wide FRASER2 results, chosen by the sample's imputed tissue.
FRASER_FILES = {"muscle": muscle_results, "fibroblasts": fibroblasts_results}
PADJ_CUTOFF = 0.05
SEP = "; "

SOLVED_TABLE_PATH = DATA_DIR / "solved_table.csv"
TPM_CACHE_DIR = DATA_DIR / "tpm_cache"


# --------------------------------------------------------------------------- #
# seqr variants
# --------------------------------------------------------------------------- #

def load_all_variants():
    """All_Variant_Metadata export -> columns: sample, gene, hgvsc, consequence."""
    A = SeqrAllVariants
    all_v = require_columns(pd.read_csv(all_variant_metadata), A.REQUIRED, all_variant_metadata)
    all_v[Variant.HGVSC] = all_v[A.TRANSCRIPT] + ":" + all_v[A.HGVSC]
    all_v = all_v.rename(columns={A.SAMPLE: Variant.SAMPLE, A.GENE: Variant.GENE, A.CONSEQUENCE: Variant.CONSEQUENCE})
    return all_v[Variant.COLUMNS]


def load_priority_variants():
    """Analyst high-priority variants, melted to one row per sample -> sample, gene, hgvsc, consequence."""
    P = SeqrPriorityVariants
    temp = require_columns(pd.read_csv(priority_variant_metadata), P.REQUIRED, priority_variant_metadata)
    sample_list = temp.filter(regex=P.SAMPLE_COLUMN_PATTERN).dropna(axis=1, how="all").columns.tolist()
    if not sample_list:
        raise ValueError(f"{priority_variant_metadata} has no sample_N columns; found {list(temp.columns)}")

    priority_v_long = (
        temp[P.REQUIRED + sample_list]
        .melt(id_vars=P.REQUIRED, value_vars=sample_list, value_name=Variant.SAMPLE)
        .drop(columns="variable")
        .dropna(subset=[P.GENE, Variant.SAMPLE])
        .rename(columns={P.GENE: Variant.GENE, P.CONSEQUENCE: Variant.CONSEQUENCE, P.HGVSC: Variant.HGVSC})
        .reset_index(drop=True)
    )
    return priority_v_long[Variant.COLUMNS]


def log_variant_overlap(all_v, priority_v):
    """Log how many (sample, hgvsc) pairs each table has and how many they share."""
    keys_all = all_v[["sample", "hgvsc"]].dropna().drop_duplicates()
    keys_priority = priority_v[["sample", "hgvsc"]].dropna().drop_duplicates()
    shared = keys_all.merge(keys_priority, on=["sample", "hgvsc"], how="inner")

    logger.info("all_v: %d rows, %d unique (sample, hgvsc) pairs", len(all_v), len(keys_all))
    logger.info("priority_v_long: %d rows, %d unique (sample, hgvsc) pairs", len(priority_v), len(keys_priority))
    logger.info("shared: %d unique (sample, hgvsc) pairs", len(shared))


def combine_variants(all_v, priority_v):
    """Union of both seqr tables, one row per (sample, hgvsc, consequence); keys with NaN dropped."""
    variants = pd.concat([all_v, priority_v], ignore_index=True)   # all_v first: its gene leads Solved_gene
    return variants.dropna(subset=["sample", "hgvsc"]).reset_index(drop=True)


# --------------------------------------------------------------------------- #
# RNA-seq metadata
# --------------------------------------------------------------------------- #

def load_rnaseq_metadata():
    """RNA-seq sample metadata from Airtable: sample_id, imputed_tissue, rnaseqc_gene_tpm, wgs_sample_id."""
    rna = require_columns(read_from_airtable(RNA_SEQ_BASE_ID, DATA_PATHS_TABLE_ID, DATA_PATHS_VIEW_ID),
                          Airtable.REQUIRED, "Airtable data_paths table")
    # Samples flagged exclude == "yes" in Airtable are left out, as in the other TGG pipelines.
    if Airtable.EXCLUDE in rna.columns:
        excluded = rna[Airtable.EXCLUDE].astype(str).str.strip().str.lower() == "yes"
        logger.info("Excluding %d RNA-seq samples flagged in Airtable.", int(excluded.sum()))
        rna = rna[~excluded]
    rna = rna[Airtable.REQUIRED].dropna(subset=[Airtable.SAMPLE, Airtable.WGS]).reset_index(drop=True)
    rna[Airtable.TISSUE] = rna[Airtable.TISSUE].str.strip().str.lower()   # tissue labels are case-insensitive
    logger.info("Loaded %d RNA-seq samples (%d WGS IDs) from Airtable.", len(rna), rna[Airtable.WGS].nunique())
    return rna


def solved_status_by_individual(seqr_meta):
    """individual_id -> seqr solve status, for individuals that count as solved."""
    solved = seqr_meta[seqr_meta[SeqrMetadata.SOLVED_STATUS].isin(SOLVED_STATUSES)]
    return dict(zip(solved[SeqrMetadata.INDIVIDUAL], solved[SeqrMetadata.SOLVED_STATUS]))


def filter_solved_samples(rna, seqr_meta):
    """Keep RNA-seq samples whose individual is Solved, Partially solved or Probably solved in seqr
    (individual_id == wgs_sample_id)."""
    solved_ids = set(solved_status_by_individual(seqr_meta))
    solved = rna[rna[Airtable.WGS].isin(solved_ids)].reset_index(drop=True)
    logger.info("%d of %d RNA-seq samples (%d WGS IDs) are solved in seqr.",
                len(solved), len(rna), solved[Airtable.WGS].nunique())
    return solved


# --------------------------------------------------------------------------- #
# FRASER2
# --------------------------------------------------------------------------- #

def load_fraser_significant(tissue, rna_to_wgs):
    """Significant FRASER2 outliers for one tissue, with gene symbols, WGS sample IDs and tissue attached."""
    path = FRASER_FILES[tissue]
    df = require_columns(pd.read_csv(path, usecols=lambda c: c in Fraser.USE_COLS), Fraser.USE_COLS, path)
    sig = df[df[Fraser.PADJ] < PADJ_CUTOFF].copy()

    # hgncSymbol may hold ENSG IDs (map through GENCODE) or already be symbols.
    if sig[Fraser.GENE].astype(str).str.startswith("ENSG").mean() > 0.5:
        sig[Fraser.GENE] = sig[Fraser.GENE].str.replace(r"\.\d+$", "", regex=True)
        sig = map_gene_id_to_gene_name(sig, Fraser.GENE)
    else:
        sig["gene_name"] = sig[Fraser.GENE]
    sig["wgs_sample_id"] = sig[Fraser.SAMPLE].map(rna_to_wgs)
    sig["tissue"] = tissue

    logger.info(
        "%s FRASER2: %d of %d rows significant (padjust < %s); gene mapped %d, WGS ID mapped %d.",
        tissue, len(sig), len(df), PADJ_CUTOFF, sig["gene_name"].notna().sum(), sig["wgs_sample_id"].notna().sum(),
    )
    return sig.dropna(subset=["wgs_sample_id", "gene_name"])


FRASER_KEY = ["wgs_sample_id", "tissue", "gene_name"]


def summarize_fraser(fraser_sig):
    """Per (wgs_sample_id, tissue, gene_name): outlier count, and deltaPsi / padjust of every outlier joined with SEP."""
    if fraser_sig.empty:
        return pd.DataFrame(columns=FRASER_KEY + ["FRASER2_sig_outlier_count", "delta_psi", "p-value"])

    grouped = fraser_sig.sort_values(Fraser.PADJ).groupby(FRASER_KEY)
    join = lambda s: SEP.join(str(v) for v in s)
    summary = pd.DataFrame({
        "FRASER2_sig_outlier_count": grouped.size(),
        "delta_psi": grouped[Fraser.DELTA_PSI].apply(join),
        "p-value": grouped[Fraser.PADJ].apply(join),
    })
    return summary.reset_index()


# --------------------------------------------------------------------------- #
# TPM
# --------------------------------------------------------------------------- #

def read_gct(path):
    """Read one RNA-SeQC gene TPM .gct(.gz) -> Series indexed by gene symbol (Description)."""
    gct = require_columns(pd.read_csv(path, sep="\t", skiprows=2), [Gct.NAME, Gct.DESCRIPTION], path)
    tpm = gct.set_index(Gct.DESCRIPTION).iloc[:, -1]
    # A few symbols occur more than once (e.g. PAR_Y copies); keep the highest TPM.
    return tpm.groupby(level=0).max()


def load_tissue_tpm_matrix(rna, tissue):
    """Genes x RNA samples TPM matrix for every sample of a tissue, cached as parquet."""
    TPM_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache = TPM_CACHE_DIR / f"{tissue}_gene_tpm.parquet"
    manifest = cache.with_suffix(".json")          # sample_id -> gct path the cache was built from
    cohort = rna[rna[Airtable.TISSUE] == tissue].dropna(subset=[Airtable.TPM_PATH])
    sources = dict(zip(cohort[Airtable.SAMPLE], cohort[Airtable.TPM_PATH].astype(str)))
    if cache.exists() and manifest.exists():
        if json.loads(manifest.read_text()) == sources:
            return pd.read_parquet(cache)
        logger.info("%s: cached TPM matrix was built from different samples or files; rebuilding.", tissue)

    logger.info("Reading %d gene TPM files for %s.", len(cohort), tissue)
    matrix = pd.DataFrame({r[Airtable.SAMPLE]: read_gct(r[Airtable.TPM_PATH]) for _, r in cohort.iterrows()})
    matrix.to_parquet(cache)
    manifest.write_text(json.dumps(sources, indent=1))
    return matrix


def tpm_columns(wgs_sample_id, tissue, gene, rna, tpm_matrices):
    """TPM of the gene in this individual's RNA sample(s) of the tissue, and the median over the tissue cohort."""
    matrix = tpm_matrices.get(tissue)
    if matrix is None or gene not in matrix.index:
        return "", ""
    rna_ids = rna.loc[(rna[Airtable.WGS] == wgs_sample_id) & (rna[Airtable.TISSUE] == tissue), Airtable.SAMPLE]
    fmt = lambda v: "" if pd.isna(v) else str(v)
    in_sample = [fmt(matrix.at[gene, rna_id]) for rna_id in rna_ids if rna_id in matrix.columns]
    return SEP.join(v for v in in_sample if v), fmt(matrix.loc[gene].median())


# --------------------------------------------------------------------------- #
# Assemble
# --------------------------------------------------------------------------- #

def build_solved_table(variants, rna, fraser_summary, tpm_matrices, fraser_tissues, solved_status=None):
    """One row per (sample, tissue, hgvsc). A variant the two seqr tables assign to different genes
    lists every gene in Solved_gene; outlier counts, junction values and consequences are pooled over
    those genes, and TPM values are given per gene in the same order. Tissues without FRASER2 results
    are omitted entirely."""
    solved = variants[variants[Variant.SAMPLE].isin(rna[Airtable.WGS])]
    logger.info("%d of %d seqr variant rows belong to solved RNA-seq samples.", len(solved), len(variants))

    sample_tissues = rna[[Airtable.WGS, Airtable.TISSUE]].drop_duplicates().dropna()
    no_fraser = sorted(set(sample_tissues[Airtable.TISSUE]) - set(fraser_tissues))
    if no_fraser:
        logger.info("Omitting tissues without FRASER2 results: %s", ", ".join(no_fraser))
    sample_tissues = sample_tissues[sample_tissues[Airtable.TISSUE].isin(fraser_tissues)]
    tissues_by_sample = sample_tissues.groupby(Airtable.WGS)[Airtable.TISSUE].agg(sorted).to_dict()

    # per (sample, gene): the variants and consequences tagged in that gene
    with_gene = solved.dropna(subset=["gene"])
    hgvsc_by_gene = with_gene.groupby(["sample", "gene"])["hgvsc"].agg(set).to_dict()
    consequence_by_gene = with_gene.groupby(["sample", "gene"])["consequence"].agg(lambda s: set(s.dropna())).to_dict()
    # per (sample, hgvsc): genes in order of first appearance (all_v before priority_v)
    genes_by_variant = with_gene.groupby(["sample", "hgvsc"], sort=False)["gene"].agg(lambda s: list(dict.fromkeys(s)))
    fraser = fraser_summary.set_index(FRASER_KEY).to_dict("index") if len(fraser_summary) else {}

    records = []
    for (sample, hgvsc), genes in genes_by_variant.items():
        for tissue in tissues_by_sample.get(sample, []):
            hits = [fraser[(sample, tissue, g)] for g in genes if (sample, tissue, g) in fraser]
            tpm = [tpm_columns(sample, tissue, g, rna, tpm_matrices) for g in genes]
            records.append({
                "Sample_ID": sample,
                "Solved_status": (solved_status or {}).get(sample, ""),
                "Solved_gene": SEP.join(genes),
                "hgvsc": hgvsc,
                "Tissue": tissue,
                "FRASER2_sig_outlier_count": sum(h["FRASER2_sig_outlier_count"] for h in hits),
                "Seqr_tagged_variants (N>0)": len(set().union(*(hgvsc_by_gene[(sample, g)] for g in genes))),
                "Seqr_variant_consequence": SEP.join(sorted(set().union(*(consequence_by_gene[(sample, g)] for g in genes)))),
                "TPM_in_sample": SEP.join(t[0] for t in tpm if t[0]),
                "Median_TPM_in_tissue_cohort": SEP.join(t[1] for t in tpm if t[1]),
                "delta_psi": SEP.join(h["delta_psi"] for h in hits),
                "p-value": SEP.join(h["p-value"] for h in hits),
            })

    rows = pd.DataFrame(records, columns=OUTPUT_COLUMNS)
    logger.info(
        "%d rows (sample x tissue x hgvsc); %d have significant FRASER2 outliers in the solved gene.",
        len(rows), int((rows["FRASER2_sig_outlier_count"] > 0).sum()),
    )
    return rows.sort_values(["Sample_ID", "Tissue", "Solved_gene", "hgvsc"]).reset_index(drop=True)


def main(session_id=None):
    all_v = load_all_variants()
    priority_v = load_priority_variants()
    log_variant_overlap(all_v, priority_v)
    variants = combine_variants(all_v, priority_v)

    seqr_meta = load_seqr_metadata(session_id)
    rna_all = load_rnaseq_metadata()                      # every RNA-seq sample: the TPM cohort
    rna = filter_solved_samples(rna_all, seqr_meta)       # solved samples: the rows of the table
    rna_to_wgs = dict(zip(rna_all[Airtable.SAMPLE], rna_all[Airtable.WGS]))   # all samples, so mapping stats are honest

    tissues = sorted(t for t in rna[Airtable.TISSUE].dropna().unique() if t in FRASER_FILES and Path(FRASER_FILES[t]).exists())
    fraser_summary = summarize_fraser(
        pd.concat([load_fraser_significant(t, rna_to_wgs) for t in tissues], ignore_index=True)
        if tissues else pd.DataFrame()
    )
    tpm_matrices = {t: load_tissue_tpm_matrix(rna_all, t) for t in tissues}

    solved_table = build_solved_table(variants, rna, fraser_summary, tpm_matrices, tissues,
                                      solved_status_by_individual(seqr_meta))
    solved_table.to_csv(SOLVED_TABLE_PATH, sep="\t", index=False)
    logger.info("Wrote %d rows to %s", len(solved_table), SOLVED_TABLE_PATH)
    print(solved_table)
    return solved_table


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    parser = argparse.ArgumentParser(description="Build solved_table.csv for solved RNA-seq samples.")
    parser.add_argument(
        "--session-id", "-s", type=str, default=None,
        help="seqr 'sessionid' cookie. Fetches fresh seqr metadata; omit to reuse the saved seqr_metadata.csv.",
    )
    args = parser.parse_args()
    main(args.session_id)
