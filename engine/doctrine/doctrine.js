// engine/doctrine/doctrine.js
(function () {
  const CLASSIFY_KEY = "ABE_Classify";
  const LAWAUDIT_KEY = "ABE_LawAudit";
  const FUNDING_KEY = "ABE_FundingAudit";
  const DOCTRINE_KEY = "ABE_Doctrine";

  async function loadJson(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error("Failed to load " + path);
    return res.json();
  }

  function loadLocal(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      console.error("Doctrine: error reading", key, e);
      return null;
    }
  }

  function safe(val, fallback) {
    return typeof val === "undefined" || val === null ? fallback : val;
  }

  function evalCondition(cond, context) {
    // Very small, controlled expression evaluator.
    // We only allow references to known keys and == / != / && / ||.
    try {
      const {
        tier1_status,
        tier2_scope_status,
        tier3_preemption_status,
        tier4_const_status,
        funding_risk,
        driver_type,
        law_category
      } = context;

      /* eslint no-eval: 0 */
      // This stays local to the closure; we are not exposing user input to eval directly.
      return !!eval(cond);
    } catch (e) {
      console.error("Doctrine: condition eval failed for", cond, e);
      return false;
    }
  }

  function applyDoctrineRules(map, context) {
    const applied = new Set();
    const implicated = new Set();

    (map.rules || []).forEach(function (rule) {
      if (!rule.condition) return;
      if (!evalCondition(rule.condition, context)) return;

      (rule.add_applied || []).forEach(function (d) {
        applied.add(d);
      });
      (rule.add_implicated || []).forEach(function (d) {
        implicated.add(d);
      });
    });

    return {
      applied: Array.from(applied),
      implicated: Array.from(implicated)
    };
  }

  function buildSummary(jurisdiction, lawCategory, context, doctrineCodes, map) {
    const labels = map.doctrines || {};
    function label(code) {
      return labels[code]?.label || code;
    }

    const appliedLabels = doctrineCodes.applied.map(label);
    const impliedLabels = doctrineCodes.implicated.map(label);

    const ufParts = [];

    ufParts.push(
      "In " +
        jurisdiction.state +
        ", your scenario in the '" +
        lawCategory +
        "' category raises the following doctrinal picture."
    );

    if (appliedLabels.length > 0) {
      ufParts.push(
        "Directly applied doctrines: " + appliedLabels.join(", ") + "."
      );
    } else {
      ufParts.push("No clear doctrine is firmly applied by the current ruleset.");
    }

    if (impliedLabels.length > 0) {
      ufParts.push(
        "Doctrines implicated or suggested by the pattern: " +
          impliedLabels.join(", ") +
          "."
      );
    }

    const technical = {
      context: context,
      doctrines_applied: doctrineCodes.applied,
      doctrines_implicated: doctrineCodes.implicated
    };

    return {
      user_friendly: ufParts.join(" "),
      technical: JSON.stringify(technical, null, 2)
    };
  }

  async function runDoctrine() {
    const classify = loadLocal(CLASSIFY_KEY);
    const lawAudit = loadLocal(LAWAUDIT_KEY);
    const funding = loadLocal(FUNDING_KEY);

    if (!classify || !lawAudit) {
      console.warn("Doctrine: missing classify or law audit results.");
      return;
    }

    const map = await loadJson("../engine/doctrine/doctrine_map.json");

    const checks = lawAudit.audit_checks || {};
    const t1 = checks.tier1_federal_alignment || {};
    const t2 = checks.tier2_scope_and_nexus || {};
    const t3 = checks.tier3_preemption || {};
    const t4 = checks.tier4_constitutional || {};

    const fundingRisk = safe(funding?.assessment?.risk_level, "unknown");

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
      driver_type: safe(classify.driver_type, "unknown"),
      law_category: lawCategory
    };

    const doctrineCodes = applyDoctrineRules(map, ctx);

    const notesParts = [];
    doctrineCodes.applied.forEach(function (code) {
      const d = map.doctrines[code];
      if (d && d.description) {
        notesParts.push(d.label + ": " + d.description);
      }
    });
    doctrineCodes.implicated.forEach(function (code) {
      const d = map.doctrines[code];
      if (d && d.description) {
        notesParts.push("(Implicated) " + d.label + ": " + d.description);
      }
    });

    const doctrines = {
      applied: doctrineCodes.applied,
      implicated: doctrineCodes.implicated,
      notes: notesParts.join("\n")
    };

    const summary = buildSummary(jurisdiction, lawCategory, ctx, doctrineCodes, map);

    const doctrineResult = {
      jurisdiction: jurisdiction,
      law_category: lawCategory,
      inputs: ctx,
      doctrines: doctrines,
      summary: summary
    };

    try {
      localStorage.setItem(DOCTRINE_KEY, JSON.stringify(doctrineResult));
      console.log("ABE_Doctrine stored:", doctrineResult);
    } catch (e) {
      console.error("Doctrine: error saving:", e);
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    runDoctrine().catch(function (e) {
      console.error("Doctrine: failure:", e);
    });
  });
})();
