/** FAQ page: how the dashboard builds its tables and how the restricted gene sets are defined. */
export default function Faq({ onBack }: { onBack: () => void }) {
  return (
    <section className="card faq">
      <div className="card-head">
        <h2>FAQ</h2>
        <button className="quiet" onClick={onBack}>← Back to dashboard</button>
      </div>

      <h3>What does the dashboard show?</h3>
      <p>
        It puts RNA-seq evidence (FRASER2 splicing outliers and gene expression) next to the DNA findings in seqr
        for every RNA-seq sample. Three tables serve three different questions:
      </p>
      <ul>
        <li>
          <strong>Solved</strong> — <em>validation</em>. The diagnosis is known. Does the RNA-seq data show a splicing
          outlier or an expression change in the solved gene? Across the cohort this measures how often RNA-seq
          confirms a DNA diagnosis, and which solved cases it does not support.
        </li>
        <li>
          <strong>Unsolved with seqr variants</strong> — <em>prioritization</em>. Analysts have tagged candidate variants
          but none is confirmed. Does the RNA-seq data support any of them? A candidate gene with a splicing outlier
          or lost expression moves to the front of the queue.
        </li>
        <li>
          <strong>Unsolved with no seqr variants</strong> — <em>discovery</em>. RNA-seq first approach:
          genes with significant splicing outliers in this sample, restricted to
          constrained or disease-associated genes, as starting points for a new candidate.
        </li>
      </ul>

      <h3>What are the three cohorts?</h3>
      <ul>
        <li><strong>Solved</strong> — individuals whose seqr status is Solved, Partially solved or Probably solved. Rows are their seqr-tagged variants.</li>
        <li><strong>Unsolved with seqr variants</strong> — individuals with status Unsolved who have at least one seqr-tagged variant. Rows are those variants.</li>
        <li><strong>Unsolved with no seqr variants</strong> — individuals with status Unsolved and no tagged variants. Rows are genes with a significant FRASER2 outlier, restricted to <span className="emph">constrained or disease-associated genes</span> (below).</li>
      </ul>
      <p>Individuals with any other seqr status, including a blank one, belong to no cohort and only appear as grey dots in the outliers plot.</p>

      <h3 id="gene-sets">How are constrained genes selected?</h3>
      <p>
        From the gnomAD v4 loss-of-function constraint score LOEUF (the upper bound of the observed/expected
        confidence interval for loss-of-function variants). A gene is <strong>constrained</strong> when its
        LOEUF is <strong>≤ 0.45</strong>. Low LOEUF means the gene tolerates far fewer loss-of-function variants
        than expected, so disruption of it is likely to matter. Missense constraint is not used. The list holds
        2,584 genes.
      </p>

      <h3>How are disease-associated genes selected?</h3>
      <p>
        From GenCC (the Gene Curation Coalition), which collects gene–disease validity assertions from
        curating groups. A gene is <strong>disease-associated</strong> when at least one of its GenCC
        classifications is <strong>Definitive, Strong or Moderate</strong>. The weaker levels, Supportive and
        Limited, are left out. The list holds 3,211 genes.
      </p>

      <h3>Where do those scores and classifications come from?</h3>
      <p>
        Both sets are drawn from one gene table (<code>mendelian_genes.tsv</code>, about 10,600 genes) that
        combines OMIM, ClinGen, GenCC, PanelApp UK and Australia, DECIPHER, ClinVar, Fridman et al. and the
        gnomAD v2 and v4 constraint scores. The selection code is in the <code>restricted_gene_sets</code>
        repository; the resulting lists are shipped with the dashboard as <code>constrained_genes.json</code> and
        <code>gencc_da_genes.json</code>. A gene can be in both sets; the <em>Gene set</em> column says which.
      </p>

      <h3>Why restrict the untagged table at all?</h3>
      <p>
        A sample can carry hundreds of significant splicing outliers, most of them in genes with no plausible
        link to disease. Keeping only constrained or disease-associated genes turns that list into something a
        curator can read. The <em>Outliers per sample</em> plot still counts <span className="emph">all genes</span>,
        so you can tell a noisy sample from a quiet one before reading its rows.
      </p>

      <h3>What counts as a FRASER2 outlier?</h3>
      <p>
        A junction with adjusted p-value below the cutoff shown next to the Build button (default 0.05, at most
        0.3). Changing the cutoff rebuilds the tables and plots without re-reading any files. When FRASER2
        annotates a junction to more than one gene, it counts for each of them.
      </p>

      <h3>What are the dashed z lines in the outliers plot?</h3>
      <p>
        The mean plus two or three standard deviations of the per-sample outlier counts across the run. Samples
        above them have unusually many outliers; an outlier in such a sample is weaker evidence than the same
        outlier in a typical sample.
      </p>

      <h3>What are TPM and Median TPM?</h3>
      <p>
        Gene expression from RNA-SeQC, in transcripts per million. <em>TPM</em> is the sample's own value;{" "}
        <em>Median TPM</em> is the median over every RNA-seq sample of the same tissue. A sample far below the
        median points to loss of expression, which splicing analysis alone would miss.
      </p>

      <h3>Where does the data come from?</h3>
      <p>
        seqr exports (variants and solved status), the Airtable RNA-seq metadata (sample IDs, tissue, exclusions),
        FRASER2 result tables uploaded to a dated release folder, and TPM matrices built from the RNA-SeQC
        output. All of it is read from a Google Cloud Storage bucket with your own Google account; nothing is
        uploaded to any server. Rows for a sample flagged <code>exclude = yes</code> in Airtable are left out.
      </p>
    </section>
  );
}
