import numpy as np
import pandas as pd
import logging
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle
from utils import all_variant_metadata, priority_variant_metadata, fibroblasts_results, fibroblasts_gene_subset_results, muscle_results, muscle_gene_subset_results, gff_filepath, DATA_DIR
from tgg_rnaseq_pipelines.rnaseq_sample_metadata.metadata_utils import read_from_airtable, RNA_SEQ_BASE_ID, DATA_PATHS_TABLE_ID, DATA_PATHS_VIEW_ID

logger = logging.getLogger(__name__)

GENE_MAP_PATH = DATA_DIR / "gene_map.parquet"
from schema import Fraser
FRASER_USE_COLS = Fraser.USE_COLS
RNA_SAMPLE_COL = Fraser.SAMPLE
GENE_COL = Fraser.GENE


PALETTE = {
    "sage": "#74a498",
    "mint": "#bde9e0",
    "cream": "#f2f4ea",
    "sand": "#e6dbc2",
    "lilac": "#b193b2",
}
TEXT_COLOR = "#4a4a4a"

SUBSET_COLORS = {"all genes": PALETTE["sage"], "gene subset": PALETTE["lilac"]}
EMPTY_COLOR = PALETTE["cream"]



def build_patient_gene_dict(dat, sample_col, gene_col, consequence_col, patient_gene_dict=None):
    if patient_gene_dict:
        patient_gene_dict.update(zip(dat[sample_col], zip(dat[gene_col], dat[consequence_col])))
    else:
        patient_gene_dict = dict(zip(dat[sample_col], zip(dat[gene_col], dat[consequence_col])))

    return patient_gene_dict


def read_gencode_gff(filepath):
    if GENE_MAP_PATH.exists():
        return pd.read_parquet(GENE_MAP_PATH)

    gff = pd.read_csv(
        filepath,
        sep="\t",
        comment="#",
        header=None,
        usecols=[2, 8],
        names=["feature", "attributes"],
        )

    genes = gff[gff["feature"] == "gene"].copy()
    genes["gene_id"] = genes["attributes"].str.extract(r"(?:^|;)ID=([^;]+)")
    genes["gene_name"] = genes["attributes"].str.extract(r"(?:^|;)gene_name=([^;]+)")
    gene_map = genes[["gene_id", "gene_name"]].reset_index(drop=True)   

    gene_map.to_parquet(GENE_MAP_PATH, index=False)
    return gene_map


def map_gene_id_to_gene_name(df, gene_id_col):
    gene_map = read_gencode_gff(gff_filepath)
    logger.info(f"Loaded {len(gene_map)} genes from GENCODE v39. ")

    lookup = gene_map.set_index("gene_id")["gene_name"]
    df["gene_name"] = df[gene_id_col].map(lookup) 
    return df  


def map_rna_id_to_gene_id(df, rna_id_col):
    rna_df = read_from_airtable(RNA_SEQ_BASE_ID, DATA_PATHS_TABLE_ID, DATA_PATHS_VIEW_ID)
    lookup = dict(zip(rna_df["sample_id"], rna_df["wgs_sample_id"]))
    df["wgs_sample_id"] = df[rna_id_col].map(lookup)
    df = df.dropna(subset="wgs_sample_id")

    return df


def cross_check_with_seqr_gene(df, patient_gene_dict):
    mapped = df["wgs_sample_id"].map(patient_gene_dict)
    df["causal_gene"] = mapped.str[0]
    df["seqr_consequence"] = mapped.str[1]
    has_match = df["gene_name"] == df["causal_gene"]

    df_flagged_in_fraser = df[has_match].reset_index(drop=True)
    samples_flagged_in_fraser = df_flagged_in_fraser["wgs_sample_id"].unique()
    return df_flagged_in_fraser, samples_flagged_in_fraser


def load_fraser_results(path):
    """Read FRASER results and map IDs to gene names and WGS sample IDs."""
    df = pd.read_csv(path, usecols=FRASER_USE_COLS)
    df = map_gene_id_to_gene_name(df, GENE_COL)
    df = map_rna_id_to_gene_id(df, RNA_SAMPLE_COL)
    return df


def report_seqr_overlap(df, label, patient_gene_dict):
    """Cross-check FRASER outlier genes with seqr genes and log the result."""
    flagged_df, flagged_samples = cross_check_with_seqr_gene(df, patient_gene_dict)
    logger.info(
        "%s: %d of %d samples have significant FRASER outliers in seqr variant genes.",
        label,
        len(flagged_samples),
        df[RNA_SAMPLE_COL].nunique(),
    )
    logger.info("%s samples: %s", label, flagged_samples)
    return flagged_df, flagged_samples


def split_label(label):
    """'muscle_gene_subset' -> ('muscle', 'gene subset'); 'muscle' -> ('muscle', 'all genes')."""
    suffix = "_gene_subset"
    if label.endswith(suffix):
        return label[: -len(suffix)], "gene subset"
    return label, "all genes"


def plot_flagged_summary_by_tissue(loaded, results, save_path=None):
    """Grouped bar chart of flagged samples per tissue and dataset type."""
    rows = []
    for label, df in loaded.items():
        tissue, subset = split_label(label)
        rows.append({
            "tissue": tissue,
            "subset": subset,
            "total": df[RNA_SAMPLE_COL].nunique(),
            "flagged": len(results[label][1]),
        })
    summary = pd.DataFrame(rows)

    tissues = summary["tissue"].unique()
    subsets = summary["subset"].unique()
    x = np.arange(len(tissues))
    group_width = 0.7
    bar_width = group_width / len(subsets)
    bar_colors = [PALETTE["sage"], PALETTE["lilac"], PALETTE["mint"], PALETTE["sand"]]

    fig, ax = plt.subplots(figsize=(6.5, 4.2))
    fig.patch.set_facecolor("white")
    ax.set_facecolor("white")

    for i, subset in enumerate(subsets):
        s = summary[summary["subset"] == subset].set_index("tissue").reindex(tissues)
        pos = x + (i - (len(subsets) - 1) / 2) * bar_width

        bars = ax.bar(
            pos, s["flagged"], bar_width * 0.88,
            color=bar_colors[i % len(bar_colors)],
            edgecolor="white", linewidth=1.2,
            label=subset.capitalize(),
            zorder=3,
        )
        for bar, f, t in zip(bars, s["flagged"], s["total"]):
            ax.text(
                bar.get_x() + bar.get_width() / 2, bar.get_height(),
                f"{f} / {t}",
                ha="center", va="bottom", fontsize=9,
                color=TEXT_COLOR, fontweight="medium",
            )

    # Axes and labels
    ax.set_xticks(x)
    ax.set_xticklabels([t.capitalize() for t in tissues], fontsize=11, color=TEXT_COLOR)
    ax.set_ylabel("Flagged samples", fontsize=11, color=TEXT_COLOR, labelpad=8)
    ax.set_title("Samples with FRASER outliers in seqr genes",
                 fontsize=13, color=TEXT_COLOR, pad=14, fontweight="semibold")
    ax.set_ylim(0, summary["flagged"].max() * 1.25 + 1)
    ax.tick_params(colors=TEXT_COLOR, length=0)

    # Clean frame and soft gridlines
    for side in ["top", "right", "left"]:
        ax.spines[side].set_visible(False)
    ax.spines["bottom"].set_color(PALETTE["sand"])
    ax.spines["bottom"].set_linewidth(1.5)
    ax.yaxis.grid(True, color=PALETTE["sand"], linewidth=1, zorder=0)

    # Legend
    legend = ax.legend(frameon=False, loc="upper left", bbox_to_anchor=(1, 1),
                       fontsize=10, title="Dataset", title_fontsize=10)
    for text in legend.get_texts():
        text.set_color(TEXT_COLOR)
    legend.get_title().set_color(TEXT_COLOR)

    fig.tight_layout()
    if save_path:
        fig.savefig(save_path, dpi=200, bbox_inches="tight",
                    facecolor=fig.get_facecolor())
    return fig, ax


def plot_flagged_samples_grid(results, title="Flagged samples and seqr genes", save_path=None):
    """Grid of flagged samples (rows) by dataset (columns), labeled with gene names."""
    records = []
    for label, (flagged_df, _) in results.items():
        _, subset = split_label(label)
        genes_per_sample = (
            flagged_df.groupby(RNA_SAMPLE_COL)["gene_name"]
            .apply(lambda s: ", ".join(sorted(s.dropna().unique())))
        )
        for sample, genes in genes_per_sample.items():
            records.append({"sample": sample, "label": label, "subset": subset, "genes": genes})

    grid = pd.DataFrame(records)
    if grid.empty:
        logger.warning("No flagged samples to plot.")
        return None, None

    labels = list(results)                       # column order follows `datasets`
    samples = sorted(grid["sample"].unique())
    col_idx = {label: i for i, label in enumerate(labels)}
    row_idx = {sample: i for i, sample in enumerate(samples)}

    fig, ax = plt.subplots(figsize=(1.9 * len(labels) + 1.5, 0.42 * len(samples) + 1.5))
    fig.patch.set_facecolor("white")

    # Empty background cells
    for r in range(len(samples)):
        for c in range(len(labels)):
            ax.add_patch(Rectangle((c - 0.46, r - 0.4), 0.92, 0.8,
                                   facecolor=EMPTY_COLOR, edgecolor="none"))

    # Flagged cells
    for rec in grid.itertuples():
        c, r = col_idx[rec.label], row_idx[rec.sample]
        ax.add_patch(Rectangle((c - 0.46, r - 0.4), 0.92, 0.8,
                               facecolor=SUBSET_COLORS.get(rec.subset, PALETTE["mint"]),
                               edgecolor="none"))
        ax.text(c, r, rec.genes, ha="center", va="center",
                fontsize=8, color="white", fontweight="semibold")

    # Axes
    ax.set_xlim(-0.5, len(labels) - 0.5)
    ax.set_ylim(len(samples) - 0.5, -0.5)        # first sample at top
    ax.set_xticks(range(len(labels)))
    ax.set_xticklabels(
        [split_label(label)[1].capitalize() for label in labels],
        fontsize=10, color=TEXT_COLOR,
    )
    ax.xaxis.tick_top()
    ax.set_yticks(range(len(samples)))
    ax.set_yticklabels(samples, fontsize=9, color=TEXT_COLOR)
    ax.tick_params(length=0)
    for spine in ax.spines.values():
        spine.set_visible(False)

    ax.set_title(title, fontsize=13, color=TEXT_COLOR, fontweight="semibold", pad=24)

    fig.tight_layout()
    if save_path:
        fig.savefig(save_path, dpi=200, bbox_inches="tight", facecolor="white")
    return fig, ax

def plot_flagged_samples_by_tissue(results, out_dir):
    """Make one flagged-samples grid per tissue."""
    by_tissue = {}
    for label, result in results.items():
        tissue, _ = split_label(label)
        by_tissue.setdefault(tissue, {})[label] = result

    figures = {}
    for tissue, tissue_results in by_tissue.items():
        figures[tissue] = plot_flagged_samples_grid(
            tissue_results,
            title=f"{tissue.capitalize()}: flagged samples and seqr genes",
            save_path=out_dir / f"{tissue}_flagged_samples_grid.png",
        )
    return figures



if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    all_v = pd.read_csv(all_variant_metadata, usecols=["participant_id", "gene_of_interest", "seqr_chosen_consequence", "transcript", "hgvsc"])
    all_v["hgvsc"] = all_v["transcript"] + ":" + all_v["hgvsc"]
    all_v_seqr_variant_counts = all_v.groupby("participant_id")["hgvsc"].nunique().to_dict()

    temp = pd.read_csv(priority_variant_metadata)
    sample_cols = temp.filter(regex=r"sample_").dropna(axis=1, how="all")
    sample_list = sample_cols.columns.tolist()

    keep_cols = ["gene", "worst_consequence", "hgvsc"] + sample_cols.columns.tolist()
    priority_v  = temp[keep_cols]
    priority_v_long = (
                        priority_v.melt(
                        id_vars=["gene", "worst_consequence", "hgvsc"],
                        value_vars=sample_list,
                        value_name="sample",
                        )
                    .drop(columns="variable")
                    .dropna(subset=["gene", "sample"])
                    .reset_index(drop=True)
                    )
    priority_v_long_seqr_variant_counts = priority_v_long.groupby("sample")["hgvsc"].nunique().to_dict()

    patient_gene_dict = build_patient_gene_dict(all_v, "participant_id", "gene_of_interest", "seqr_chosen_consequence")
    patient_gene_dict = build_patient_gene_dict(priority_v_long, "sample", "gene", "worst_consequence", patient_gene_dict)
    logger.info(f"Loaded {len(patient_gene_dict)} samples from seqr. ")

    datasets = {
        "fibroblasts": fibroblasts_results,
        "fibroblasts_gene_subset": fibroblasts_gene_subset_results,
        "muscle": muscle_results,
        "muscle_gene_subset": muscle_gene_subset_results
    }  

    results = {}
    loaded = {}
    for label, path in datasets.items():
        df = load_fraser_results(path)
        logger.info("%s: %d unique samples after ID mapping", label, df[RNA_SAMPLE_COL].nunique())
        loaded[label] = df
        results[label] = report_seqr_overlap(df, label, patient_gene_dict)
        print(results[label][0])
        break

    plot_flagged_summary_by_tissue(loaded, results, save_path=DATA_DIR / "flagged_samples_by_tissue.png")
    plot_flagged_samples_by_tissue(results, DATA_DIR)


