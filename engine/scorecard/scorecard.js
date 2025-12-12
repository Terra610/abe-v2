// engine/scorecard/scorecard.js
(function () {
  const LAWAUDIT_KEY = "ABE_LawAudit";
  const FUNDING_KEY = "ABE_FundingAudit";
  const DOCTRINE_KEY = "ABE_Doctrine";
  const SCORECARD_KEY = "ABE_Scorecard";

  function loadLocal(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      console.error("Scorecard: error reading", key, e);
      return null;
    }
  }

  function safe(val, fallback) {
    return typeof val === "undefined" || val === null ? fallback : val;
  }

  function mapTier1(status) {
    switch (status) {
      case "aligned":
        return 0;
      case "over_broad":
        return 15;
      case "ultra_vires":
        return 25;
      case "unknown":
      default:
        return 5;
    }
  }

  function mapTier2(status) {
    switch (status) {
      case "within_scope":
        return 0;
      case "beyond_scope":
        return 20;
      case "unknown":
      default:
        return 5;
    }
  }

  function mapTier3(status) {
    switch (status) {
      case "no_preemption_issue":
        return 0;
      case "express_preempted":
      case "field_preempted":
      case "conflict_preempted":
      case "obstacle_preempted":
        return 20;
      case "unclear":
      default:
        return 10;
    }
  }

  function mapTier4(status) {
    switch (status) {
      case "text_aligned":
        return 0;
      case "over_reach":
        return 25;
      case "rights_infringing":
        return 30;
      case "void_ab_initio":
        return 40;
      case "unknown":
      default:
        return 10;
    }
  }

  function mapFundingRisk(risk) {
    switch (risk) {
      case "none":
        return 0;
      case "low":
        return 5;
      case "medium":
        return 15;
      case "high":
        return 25;
      case "unknown":
      default:
        return 5;
    }
  }

  function scoreDoctrines(applied, implicated) {
    const a = applied ? applied.length : 0;
    const i = implicated ? implicated.length : 0;
    // Each firmly applied doctrine is heavier than implicated.
    const score = a * 5 + i * 3;
    // Cap to avoid blowing up the scale
    return Math.min(score, 30);
  }

  function clamp(num, min, max) {
    return Math.max(min, Math.min(max, num));
  }

  function bandFromDivergence(d) {
    if (d <= 20) {
      return { band: "green", label: "Constitutionally sound (low divergence)" };
    }
    if (d <= 40) {
      return { band: "yellow", label: "Mixed — caution warranted" };
    }
    if (d <= 65) {
      return { band: "orange", label: "High concern — probable overreach" };
    }
    return { band: "red", label: "Severe constitutional failure" };
  }

  function buildSummary(jurisdiction, lawCategory, scores, inputs) {
    const parts = [];
    parts.push(
      "In " +
        jurisdiction.state +
        ", this '" +
        lawCategory +
        "' scenario has a constitutional fidelity score of " +
        scores.fidelity_score +
        " out of 100."
    );
    parts.push(
      "Divergence score " +
        scores.divergence_score +
        " places it in the " +
        scores.band_label +
        " band."
    );

    const tech = {
      jurisdiction: jurisdiction,
      law_category: lawCategory,
      inputs: inputs,
      scores: scores
    };

    return {
      user_friendly: parts.join(" "),
      technical: JSON.stringify(tech, null, 2)
    };
  }

  function runScorecard() {
    const lawAudit = loadLocal(LAWAUDIT_KEY);
    const funding = loadLocal(FUNDING_KEY);
    const doctrine = loadLocal(DOCTRINE_KEY);

    if (!lawAudit) {
      console.warn("Scorecard: missing ABE_LawAudit; cannot compute score.");
      return;
    }

    const checks = lawAudit.audit_checks || {};
    const t1 = checks.tier1_federal_alignment || {};
    const t2 = checks.tier2_scope_and_nexus || {};
    const t3 = checks.tier3_preemption || {};
    const t4 = checks.tier4_constitutional || {};

    const fundingRisk = safe(funding?.assessment?.risk_level, "unknown");
    const doctrinesApplied = safe(
      doctrine?.doctrines?.applied,
      []
    );
    const doctrinesImplicated = safe(
      doctrine?.doctrines?.implicated,
      []
    );

    const lawCategory = lawAudit.law_reference?.category || "other";

    const jurisdiction = {
      country: lawAudit.jurisdiction?.country || "United States",
      state: lawAudit.jurisdiction?.state || "Unknown"
    };

    const inputs = {
      tier1_status: safe(t1.status, "unknown"),
      tier2_scope_status: safe(t2.scope_status, "unknown"),
      tier3_preemption_status: safe(t3.status, "no_preemption_issue"),
      tier4_const_status: safe(t4.status, "unknown"),
      funding_risk: fundingRisk,
      doctrines_applied: doctrinesApplied,
      doctrines_implicated: doctrinesImplicated
    };

    // Raw divergence components
    const d1 = mapTier1(inputs.tier1_status);
    const d2 = mapTier2(inputs.tier2_scope_status);
    const d3 = mapTier3(inputs.tier3_preemption_status);
    const d4 = mapTier4(inputs.tier4_const_status);
    const df = mapFundingRisk(inputs.funding_risk);
    const dd = scoreDoctrines(doctrinesApplied, doctrinesImplicated);

    let divergence = d1 + d2 + d3 + d4 + df + dd;
    divergence = clamp(divergence, 0, 100);

    const fidelity = clamp(100 - divergence, 0, 100);

    const bandInfo = bandFromDivergence(divergence);

    const scores = {
      fidelity_score: Math.round(fidelity),
      divergence_score: Math.round(divergence),
      band: bandInfo.band,
      band_label: bandInfo.label
    };

    const summary = buildSummary(jurisdiction, lawCategory, scores, inputs);

    const scorecard = {
      jurisdiction: jurisdiction,
      law_category: lawCategory,
      inputs: inputs,
      scores: scores,
      summary: summary
    };

    try {
      localStorage.setItem(SCORECARD_KEY, JSON.stringify(scorecard));
      console.log("ABE_Scorecard stored:", scorecard);
    } catch (e) {
      console.error("Scorecard: error saving:", e);
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    try {
      runScorecard();
    } catch (e) {
      console.error("Scorecard: failure:", e);
    }
  });
})();
