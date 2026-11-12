import argparse
import logging
import requests
import pandas as pd
from utils import DATA_DIR
from schema import SeqrMetadata as S, require_columns

logger = logging.getLogger(__name__)

SEQR_URL = "https://seqr.broadinstitute.org/api/summary_data/individual_metadata/all?"
SEQR_METADATA_PATH = DATA_DIR / "seqr_metadata.csv"
SOLVED = "Solved"
# seqr solve-status values that count as solved for the dashboard
SOLVED_STATUSES = {"Solved", "Partially solved", "Probably solved"}


def extract_seqr_metadata(session_id, out_path=SEQR_METADATA_PATH):
    """Fetch individual metadata from seqr -> project, individual_id, sex, solved_status; saved to out_path."""
    with requests.Session() as s:
        s.cookies.set_cookie(requests.cookies.create_cookie("sessionid", session_id))
        response = s.get(SEQR_URL, timeout=120)
    response.raise_for_status()
    # An invalid or expired session is answered with the login page (HTTP 200), not JSON.
    if "application/json" not in response.headers.get("content-type", "") or "/login" in response.url:
        raise PermissionError("seqr did not return JSON; the session ID is probably invalid or expired. "
                              "Log in to seqr in a browser and copy the current 'sessionid' cookie.")

    df = pd.DataFrame(response.json()["rows"])
    solved_col = next((c for c in S.API_SOLVED_STATUS_CANDIDATES if c in df.columns), None)
    if solved_col is None:
        raise KeyError(f"No solve status column in seqr response. Columns: {list(df.columns)}")
    require_columns(df, [S.API_PROJECT, S.API_INDIVIDUAL, S.API_SEX], "seqr individual metadata response")

    metadata_df = df[[S.API_PROJECT, S.API_INDIVIDUAL, S.API_SEX, solved_col]].copy()
    metadata_df.columns = S.COLUMNS
    metadata_df.to_csv(out_path, index=False)

    logger.info("seqr metadata: %d individuals, %d solved (%s); saved to %s",
                len(metadata_df), metadata_df[S.SOLVED_STATUS].isin(SOLVED_STATUSES).sum(), ", ".join(sorted(SOLVED_STATUSES)), out_path)
    logger.info("solved_status values: %s", metadata_df[S.SOLVED_STATUS].value_counts(dropna=False).to_dict())
    return metadata_df


def load_seqr_metadata(session_id=None, path=SEQR_METADATA_PATH):
    """Fetch from seqr when a session ID is given, otherwise reuse the saved CSV."""
    if session_id:
        return extract_seqr_metadata(session_id, path)
    if path.exists():
        logger.info("Reading saved seqr metadata from %s (pass --session-id to refresh).", path)
        return require_columns(pd.read_csv(path), S.COLUMNS, path)
    raise FileNotFoundError(f"{path} not found; run with --session-id to fetch seqr metadata.")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    parser = argparse.ArgumentParser(description="Save seqr individual metadata (with solved_status) to DATA_DIR.")
    parser.add_argument("--session-id", "-s", type=str, required=True, help="seqr 'sessionid' cookie value")
    args = parser.parse_args()
    print(extract_seqr_metadata(args.session_id))
