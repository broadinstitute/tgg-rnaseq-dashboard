"""Column names of every external table the pipeline reads, and of the table it writes.

Each name appears here exactly once. Loaders validate their input against these with
`require_columns`, so a renamed or missing column fails at the boundary with a message that
names the file and the column, instead of a KeyError deep inside pandas.

The dashboard's TypeScript port keeps the same names in dashboard/src/types.ts and
dashboard/src/data/detect.ts; keep the two in step.
"""


class SeqrAllVariants:
    """seqr 'All Variant Metadata' export."""
    SAMPLE = "participant_id"
    GENE = "gene_of_interest"
    CONSEQUENCE = "seqr_chosen_consequence"
    TRANSCRIPT = "transcript"
    HGVSC = "hgvsc"
    REQUIRED = [SAMPLE, GENE, CONSEQUENCE, TRANSCRIPT, HGVSC]


class SeqrPriorityVariants:
    """seqr saved analyst high-priority variants export (wide: one sample_N column per carrier)."""
    GENE = "gene"
    CONSEQUENCE = "worst_consequence"
    HGVSC = "hgvsc"
    SAMPLE_COLUMN_PATTERN = r"^sample_\d+$"
    REQUIRED = [GENE, CONSEQUENCE, HGVSC]


class SeqrMetadata:
    """Individual metadata as saved by get_seqr_metadata.py (left) and as returned by the seqr API (right)."""
    PROJECT = "project"
    INDIVIDUAL = "individual_id"
    SEX = "sex"
    SOLVED_STATUS = "solved_status"
    COLUMNS = [PROJECT, INDIVIDUAL, SEX, SOLVED_STATUS]

    API_PROJECT = "internal_project_id"
    API_INDIVIDUAL = "participant_id"
    API_SEX = "sex"
    API_SOLVED_STATUS_CANDIDATES = ["solve_status", "solved_status"]


class Airtable:
    """RNA-seq data_paths table in Airtable."""
    SAMPLE = "sample_id"            # RNA-seq sample ID (matches FRASER2 sampleID and TPM matrix columns)
    TISSUE = "imputed_tissue"
    TPM_PATH = "rnaseqc_gene_tpm"   # gs:// path to the RNA-SeQC gene TPM .gct.gz
    WGS = "wgs_sample_id"           # matches seqr participant_id / individual_id
    EXCLUDE = "exclude"             # "yes" = leave the sample out, as in the other TGG pipelines
    REQUIRED = [SAMPLE, TISSUE, TPM_PATH, WGS]
    EXPORTED = [SAMPLE, TISSUE, WGS]   # what the dashboard needs (no TPM paths)


class Fraser:
    """FRASER2 results table."""
    SAMPLE = "sampleID"
    GENE = "hgncSymbol"             # ENSG IDs in the TGG output, mapped to symbols via GeneMap
    PADJ = "padjust"
    DELTA_PSI = "deltaPsi"
    POSITION = ["seqnames", "start", "end", "strand"]
    USE_COLS = [SAMPLE, GENE, PADJ, DELTA_PSI] + POSITION


class Gct:
    """RNA-SeQC gene TPM .gct: two header lines, then Name, Description, <sample>."""
    NAME = "Name"
    DESCRIPTION = "Description"


class GeneMap:
    """GENCODE gene map cached by reference.read_gencode_gff."""
    ID = "gene_id"
    NAME = "gene_name"


# Internal, after loading: both seqr variant tables are reduced to these.
class Variant:
    SAMPLE = "sample"
    GENE = "gene"
    HGVSC = "hgvsc"
    CONSEQUENCE = "consequence"
    COLUMNS = [SAMPLE, GENE, HGVSC, CONSEQUENCE]


OUTPUT_COLUMNS = [
    "Sample_ID",
    "Solved_status",
    "Solved_gene",
    "hgvsc",
    "Tissue",
    "FRASER2_sig_outlier_count",
    "Seqr_tagged_variants (N>0)",
    "Seqr_variant_consequence",
    "TPM_in_sample",
    "Median_TPM_in_tissue_cohort",
    "delta_psi",
    "p-value",
]


def require_columns(df, columns, source):
    """Raise a clear error if `df` (read from `source`) lacks any of `columns`."""
    missing = [c for c in columns if c not in df.columns]
    if missing:
        raise ValueError(
            f"{source} is missing column(s) {missing}; found {list(df.columns)}"
        )
    return df
