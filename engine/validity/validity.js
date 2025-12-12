// engine/validity/validity.js
(function () {
  const LAWAUDIT_KEY = "ABE_LawAudit";
  const FUNDING_KEY = "ABE_FundingAudit";
  const DOCTRINE_KEY = "ABE_Doctrine";
  const SCORECARD_KEY = "ABE_Scorecard";
  const CLASSIFY_KEY = "ABE_Classify";
  const VALIDITY_KEY = "ABE_Validity";

  async function loadJson(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error("Failed to load " + path);
    return res.json();
  }

  function loadLocal(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.error("Validity: error reading", key, e);
      return null;
    }
  }

  function safe(val, fallback) {
    return typeof val === "undefined" || val === null ? fallback : val;
  }

  function evalCondition(cond, ctx) {
    try {
      const {
        tier1_status,
        tier2_scope_status,
        tier3_preemption_status,
        tier4_const_status,
        funding_risk,
        divergence_score,
        fidelity_score,
        driver_type,
        law_category
      } = ctx;
      /* eslint no-eval: 0 */
      return !!eval(cond);
    } catch (e) {
      console.error("Validity: condition eval failed for", cond, e);
      return false;
    }
  }

  function applyRules(map, ctx) {
    const grounds = new Set();
    const hooks = new Set();

    (map.rules || []).forEach(function (rule) {
      if (!rule.condition) return;
      if (!evalCondition(rule.condition, ctx)) return;

      (rule.add_grounds || []).forEach((g) => grounds.add(g));
      (rule.add_hooks || []).forEach((h) => hooks.add(h));
    });

    return {
      grounds: Array.from(grounds),
      hooks: Array.from(hooks)
    };
  }

  function computeStatus(ctx, grounds, doctrinesApplied, doctrinesImplicated) {
    const t1 = ctx.tier1_status;
    const t2 = ctx.tier2_scope_status;
    const t3 = ctx.tier3_preemption_status;
    const t4 = ctx.tier4_const_status;
    const fundingRisk = ctx.funding_risk;
    const div = ctx.divergence_score;

    const hasDoctrine = (code) =>
      doctrinesApplied.includes(code) || doctrinesImplicated.includes(code);

    // Strong void ab initio: combo of structural and textual failures
    const strongVoid =
      t4 === "void_ab_initio" ||
      (t4 === "rights_infringing" &&
        (t3 !== "no_preemption_issue" || t1 === "ultra_vires")) ||
      (hasDoctrine("supremacy_preemption") && hasDoctrine("ultra_vires")) ||
      (div >= 75 && (t4 === "over_reach" || t4 === "rights_infringing"));

    if (strongVoid) {
      return "void_ab_initio_strong";
    }

    // Candidate void ab initio: big problems but maybe not fully proven
    const candidateVoid =
      t4 === "over_reach" ||
      t4 === "rights_infringing" ||
      t1 === "ultra_vires" ||
      t2 === "beyond_scope" ||
      t3 !== "no_preemption_issue" ||
      fundingRisk === "high" ||
      div >= 55;

    if (candidateVoid) {
      return "void_ab_initio_candidate";
    }

    // Structurally defective: clear issues but maybe fixable or context-dependent
    const structuralDefect =
      grounds.length > 0 ||
      hasDoctrine("supremacy_preemption") ||
      hasDoctrine("police_power_overreach") ||
      div >= 35;

    if (structuralDefect) {
      return "structurally_defective";
    }

    // Otherwise, presumptively valid
    return "presumptively_valid";
  }

  function recommendedActions(status, fundingRisk) {
    const actions = [];

    if (status === "presumptively_valid") {
      actions.push(
        "Document the scenario for your records.",
        "Monitor for any pattern of escalation or repeat misuse."
      );
    } else if (status === "structurally_defective") {
      actions.push(
        "Consult with counsel about raising statutory and constitutional objections.",
        "Consider requesting written justification from the enforcing agency.",
        "Preserve all records, citations, and communications."
      );
    } else if (status === "void_ab_initio_candidate") {
      actions.push(
        "Consult with constitutional or civil rights counsel about a void ab initio challenge.",
        "Preserve all court filings, transcripts, and evidence.",
        "Consider coordinating with others affected to show pattern and practice."
      );
      if (fundingRisk === "high" || fundingRisk === "medium") {
        actions.push(
          "Consider speaking with counsel familiar with False Claims Act or funding misuse."
        );
      }
    } else if (status === "void_ab_initio_strong") {
      actions.push(
        "Seek specialized constitutional/civil rights counsel as soon as possible.",
        "Treat this as a potential void ab initio case: the law or application may be invalid from the outset.",
        "Preserve every piece of documentation and evidence, including bodycam, dashcam, and court records."
      );
      if (fundingRisk === "high") {
        actions.push(
          "Strongly consider consulting with False Claims Act / whistleblower counsel regarding systemic funding misuse."
        );
      }
    } else {
      actions.push("Gather more information and seek legal advice if possible.");
    }

    return actions;
  }

  function buildSummary(jurisdiction, lawCategory, validity, inputs, map) {
    const hookLabels = map.constitutional_hooks || {};
    const groundsLabels = map.grounds_labels || {};

    const prettyHooks = (validity.constitutional_hooks || []).map(
      (k) => hookLabels[k] || k
    );
    const prettyGrounds = (validity.grounds || []).map(
      (g) => groundsLabels[g] || g
    );

    const parts = [];
    parts.push(
      "In " +
        jurisdiction.state +
        ", this '" +
        lawCategory +
        "' enforcement pattern is assessed as: " +
        validity.status.replace(/_/g, " ") +
        "."
    );

    if (prettyGrounds.length > 0) {
      parts.push("Key grounds: " + prettyGrounds.join("; ") + ".");
    }

    if (prettyHooks.length > 0) {
      parts.push("Constitutional hooks: " + prettyHooks.join("; ") + ".");
    }

    const tech = {
      jurisdiction: jurisdiction,
      law_category: lawCategory,
      inputs: inputs,
      validity: validity
    };

    return {
      user_friendly: parts.join(" "),
      technical: JSON.stringify(tech, null, 2)
    };
  }

  async function runValidity() {
    const lawAudit = loadLocal(LAWAUDIT_KEY);
    const funding = loadLocal(FUNDING_KEY);
    const doctrine = loadLocal(DOCTRINE_KEY);
    const scorecard = loadLocal(SCORECARD_KEY);
    const classify = loadLocal(CLASSIFY_KEY);

    if (!lawAudit || !scorecard) {
      console.warn("Validity: missing law audit or scorecard; aborting.");
      return;
    }

    const map = await loadJson("../engine/validity/validity_map.json");

    const checks = lawAudit.audit_checks || {};
    const t1 = checks.tier1_federal_alignment || {};
    const t2 = checks.tier2_scope_and_nexus || {};
    const t3 = checks.tier3_preemption || {};
    const t4 = checks.tier4_constitutional || {};

    const fundingRisk = safe(funding?.assessment?.risk_level, "unknown");
    const doctrinesApplied = safe(doctrine?.doctrines?.applied, []);
    const doctrinesImplicated = safe(doctrine?.doctrines?.implicated, []);
    const divergence = safe(scorecard?.scores?.divergence_score, 0);
    const fidelity = safe(scorecard?.scores?.fidelity_score, 0);
    const driverType = safe(classify?.driver_type, "unknown");

    const lawCategory = lawAudit.law_reference?.category || "other";

    const jurisdiction = {
      country: lawAudit.jurisdiction?.country || "United States",
      state: lawAudit.jurisdiction?.state || "Unknown"
    };

    const ctx = {
      tier1_status: safe(t1.status, "unknown"),
      tier2_scope_status: safe(t2.scope_status, "unknown"),
      tier3_preemption_status: safe(t3.status, "no_preemption_issue"),
      tier4_const_status: safe(t4.status, "unknown"),
      funding_risk: fundingRisk,
      divergence_score: divergence,
      fidelity_score: fidelity,
      driver_type: driverType,
      law_category: lawCategory
    };

    const ruleResult = applyRules(map, ctx);

    const status = computeStatus(
      ctx,
      ruleResult.grounds,
      doctrinesApplied,
      doctrinesImplicated
    );

    const actions = recommendedActions(status, fundingRisk);

    const validity = {
      status: status,
      grounds: ruleResult.grounds,
      constitutional_hooks: ruleResult.hooks,
      recommended_actions: actions,
      notes: ""
    };

    const inputs = {
      ...ctx,
      doctrines_applied: doctrinesApplied,
      doctrines_implicated: doctrinesImplicated
    };

    const summary = buildSummary(
      jurisdiction,
      lawCategory,
      validity,
      inputs,
      map
    );

    const result = {
      jurisdiction: jurisdiction,
      law_category: lawCategory,
      inputs: inputs,
      validity: validity,
      summary: summary
    };

    try {
      localStorage.setItem(VALIDITY_KEY, JSON.stringify(result));
      console.log("ABE_Validity stored:", result);
    } catch (e) {
      console.error("Validity: error saving:", e);
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    runValidity().catch(function (e) {
      console.error("Validity: failure:", e);
    });
  });
})();
