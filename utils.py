from pathlib import Path
ROOT_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT_DIR / "Data/rnaseq_dashboard"

gff_filepath = DATA_DIR / "gencode.v39.annotation.without_version_numbers.gff3.gz"

all_variant_metadata = DATA_DIR / "All_2026-10-07_Variant_Metadata.csv"
priority_variant_metadata = DATA_DIR / "saved_analyst_high_priority_variants.csv"

fibroblasts_results = DATA_DIR / "fibroblasts_169_samples.csv"
fibroblasts_gene_subset_results = DATA_DIR / "fibroblasts_169_samples_gene_subset.csv"

muscle_results = DATA_DIR / "muscle_200_samples.csv"
muscle_gene_subset_results = DATA_DIR / "muscle_200_samples_gene_subset.csv"