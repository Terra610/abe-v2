(function () {
  const LAW_KEY = "ABE_LawAudit";
  const FUND_KEY = "ABE_FundingAudit";
  const DOC_KEY = "ABE_Doctrine";
  const SCORE_KEY = "ABE_Scorecard";
  const EXPORT_KEY = "ABE_Export";

  function load(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.error("Export load error:", key, e);
      return null;
    }
  }

  function mkHTML(bundle) {
    const { jurisdiction, law_category, modules, scorecard } = bundle;

    return `
<h1>ABE Constitutional Audit Report</h1>

<p><strong>Generated:</strong> ${bundle.timestamp}</p>
<p><strong>Jurisdiction:</strong> ${jurisdiction.state}, ${jurisdiction.country}</p>
<p><strong>Law Category:</strong> ${law_category}</p>

<h2>Scorecard</h2>
<p><strong>Fidelity:</strong> ${scorecard.scores.fidelity_score}</p>
<p><strong>Divergence:</strong> ${scorecard.scores.divergence_score}</p>
<p><strong>Band:</strong> ${scorecard.scores.band_label}</p>
<p>${scorecard.summary.user_friendly}</p>

<h2>Law Audit</h2>
<pre>${JSON.stringify(modules.law_audit, null, 2)}</pre>

<h2>Funding Audit</h2>
<pre>${JSON.stringify(modules.funding_audit, null, 2)}</pre>

<h2>Doctrine Analysis</h2>
<pre>${JSON.stringify(modules.doctrine, null, 2)}</pre>
    `;
  }

  function runExport() {
    const law = load(LAW_KEY);
    const fund = load(FUND_KEY);
    const doc = load(DOC_KEY);
    const score = load(SCORE_KEY);

    if (!law || !score) {
      console.warn("Export aborted — missing law audit or scorecard.");
      return;
    }

    const bundle = {
      timestamp: new Date().toISOString(),
      jurisdiction: law.jurisdiction || { country: "USA", state: "Unknown" },
      law_category: law.law_reference?.category || "Other",

      modules: {
        law_audit: law,
        funding_audit: fund,
        doctrine: doc
      },

      scorecard: score,

      export_bundle: {}
    };

    // Build JSON string
    const jsonString = JSON.stringify(bundle, null, 2);

    // Build HTML report
    const htmlString = mkHTML(bundle);

    bundle.export_bundle.json = jsonString;
    bundle.export_bundle.html = htmlString;

    try {
      localStorage.setItem(EXPORT_KEY, JSON.stringify(bundle));
      console.log("ABE_Export stored:", bundle);
    } catch (e) {
      console.error("Export save error:", e);
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    try {
      runExport();
    } catch (e) {
      console.error("Export module failure:", e);
    }
  });
})();
