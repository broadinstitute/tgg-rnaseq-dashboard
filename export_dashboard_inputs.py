"""Write the shared inputs for the static dashboard (dashboard/), TGG-viewer style.

The dashboard reads two bucket locations:
    <sharedFolder>/            everything this script writes; refreshed by a scheduled run (see README)
    <releasesFolder>/<date>/   FRASER2 result tables a user uploads by hand (and the solved table the page saves back)

Produces, in --out-dir:
    seqr_metadata.csv          project, individual_id, sex, solved_status   (from seqr; needs --session-id once)
    rnaseq_metadata.csv        sample_id, imputed_tissue, wgs_sample_id     (from Airtable)
    gene_map.csv               gene_id, gene_name                           (GENCODE v39, no version numbers;
                               also copied to dashboard/public/ so the page bundles it like main.py reads the GFF)
    <tissue>_gene_tpm.csv.gz   genes x RNA samples TPM matrix, one per tissue (from the per-sample .gct files)
    fraser2_<tissue>.csv.gz    transcriptome-wide FRASER2 results, one per tissue (skipped with --shared-only;
                               users normally upload these to a release folder instead)
    all_variants.csv           copy of the seqr All Variant Metadata export      (optional, users can drop their own)
    priority_variants.csv      copy of the seqr analyst priority variants export (optional, users can drop their own)

Usage (hail env):
    python export_dashboard_inputs.py --session-id <seqr sessionid>            # full export to --out-dir
    python export_dashboard_inputs.py --shared-only --upload gs://tgg-rnaseq/dashboard/shared/
The second form is what the scheduled job runs: Airtable metadata and TPM matrices are refreshed unattended;
seqr metadata is refreshed only when a --session-id is given (reusing the saved copy otherwise).
"""
import argparse
import logging
import shutil
import subprocess
from pathlib import Path

from get_seqr_metadata import load_seqr_metadata
import pandas as pd
from main import FRASER_FILES, load_rnaseq_metadata, load_tissue_tpm_matrix
from reference import read_gencode_gff
from schema import Airtable, Fraser
from utils import DATA_DIR, gff_filepath, all_variant_metadata, priority_variant_metadata

logger = logging.getLogger(__name__)
DEFAULT_OUT_DIR = DATA_DIR / "dashboard_inputs"


def export(out_dir: Path, session_id=None, tissues=None, shared_only=False):
    out_dir.mkdir(parents=True, exist_ok=True)

    seqr_meta = load_seqr_metadata(session_id)
    seqr_meta.to_csv(out_dir / "seqr_metadata.csv", index=False)
    logger.info("seqr_metadata.csv: %d individuals", len(seqr_meta))

    rna = load_rnaseq_metadata()
    rna[Airtable.EXPORTED].to_csv(out_dir / "rnaseq_metadata.csv", index=False)
    logger.info("rnaseq_metadata.csv: %d RNA samples", len(rna))

    gene_map = read_gencode_gff(gff_filepath)
    gene_map.to_csv(out_dir / "gene_map.csv", index=False)
    logger.info("gene_map.csv: %d genes", len(gene_map))
    bundled = Path(__file__).resolve().parent / "dashboard" / "public" / "gene_map.csv"
    if bundled.parent.exists():
        gene_map.to_csv(bundled, index=False)
        logger.info("gene map also written to %s so the dashboard ships it (public GENCODE data)", bundled)

    tissues = [t.strip().lower() for t in tissues] if tissues else None   # labels are case-insensitive everywhere
    if tissues:
        unknown = [t for t in tissues if t not in FRASER_FILES]
        if unknown:
            raise SystemExit(f"No FRASER2 file configured for tissue(s) {unknown}; known: {sorted(FRASER_FILES)}")
    tissues = tissues or sorted(t for t in rna[Airtable.TISSUE].dropna().unique() if t in FRASER_FILES)
    for tissue in tissues:
        matrix = load_tissue_tpm_matrix(rna, tissue)          # cached parquet under DATA_DIR/tpm_cache
        matrix.index.name = "gene"
        path = out_dir / f"{tissue}_gene_tpm.csv.gz"
        matrix.to_csv(path, compression="gzip")
        logger.info("%s: %d genes x %d samples", path.name, *matrix.shape)

        src = Path(FRASER_FILES[tissue])
        if shared_only:
            continue
        if src.exists():
            # only the columns the dashboard reads, gzipped: a fraction of the raw file to download and parse
            fraser = pd.read_csv(src, usecols=Fraser.USE_COLS)
            fraser.to_csv(out_dir / f"fraser2_{tissue}.csv.gz", index=False, compression="gzip")
            logger.info("fraser2_%s.csv.gz: %d rows from %s", tissue, len(fraser), src)
        else:
            logger.warning("FRASER2 file for %s not found at %s; skipped", tissue, src)

    for src, name in [(all_variant_metadata, "all_variants.csv"), (priority_variant_metadata, "priority_variants.csv")]:
        if Path(src).exists():
            shutil.copy(src, out_dir / name)
            logger.info("%s copied from %s", name, src)

    print(f"\nInputs written to {out_dir}")


def upload(out_dir: Path, folder: str, shared_only=False):
    """Sync the export folder to the bucket's shared folder (needs gsutil and write access)."""
    folder = folder if folder.endswith("/") else folder + "/"
    cmd = ["gsutil", "-m", "rsync", "-r"]
    if shared_only:
        cmd += ["-x", r"^fraser2_.*"]   # FRASER2 tables belong in release folders, never in shared/
    cmd += [str(out_dir), folder]
    logger.info("Uploading: %s", " ".join(cmd))
    subprocess.run(cmd, check=True)
    logger.info("Uploaded to %s", folder)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--session-id", "-s", default=None, help="seqr sessionid cookie; omit to reuse saved seqr_metadata.csv")
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    parser.add_argument("--tissue", action="append", help="limit to these tissues (default: all with FRASER2 files)")
    parser.add_argument("--shared-only", action="store_true", help="skip FRASER2 tables (they live in release folders)")
    parser.add_argument("--upload", metavar="gs://bucket/dashboard/shared/", help="rsync the output folder to this bucket folder")
    args = parser.parse_args()
    export(args.out_dir, args.session_id, args.tissue, args.shared_only)
    if args.upload:
        upload(args.out_dir, args.upload, args.shared_only)
