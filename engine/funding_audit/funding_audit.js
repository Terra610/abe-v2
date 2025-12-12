// engine/funding_audit/funding_audit.js
(function () {
  const INTAKE_KEY = "ABE_IntakeSession";
  const CLASSIFY_KEY = "ABE_Classify";
  const LAWAUDIT_KEY = "ABE_LawAudit";
  const FUNDING_KEY = "ABE_FundingAudit";

  async function loadJson(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`Failed to load ${path}`);
    return res.json();
  }

  function loadLocal(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      console.error("FundingAudit: error reading", key, e);
      return null;
    }
  }

  function inferCategoryFromLawAudit(lawAudit) {
    if (!lawAudit || !lawAudit.law_reference) return "other";
    return lawAudit.law_reference.category || "other";
  }

  function selectPrograms(category, programsConfig) {
    const map = programsConfig.category_to_programs || {};
    const ids = map[category] || map["other"] || [];
    const byId = {};
    (programsConfig.programs || []).forEach((p) => (byId[p.id] = p));
    return ids
      .map((id) => byId[id])
      .filter(Boolean)
      .map((p) => ({
        id: p.id,
        name: p.name,
        type: p.type,
        notes: p.notes
      }));
  }

  function assessRisk(category, programs, lawAudit, classify) {
    const checks = lawAudit?.audit_checks || {};
    const t1 = checks.tier1_federal_alignment || {};
    const t2 = checks.tier2_scope_and_nexus || {};
    const t3 = checks.tier3_preemption || {};
    const t4 = checks.tier4_constitutional || {};

    const driverType = classify?.driver_type || "private";

    let risk = "unknown";
    const theories = [];
    let notes = "";

    const ultraVires = t1.status === "ultra_vires";
    const beyondScope = t2.scope_status === "beyond_scope";
    const preempted =
      t3.status === "express_preempted" ||
      t3.status === "field_preempted" ||
      t3.status === "conflict_preempted" ||
      t3.status === "obstacle_preempted";
    const constBad =
      t4.status === "over_reach" ||
      t4.status === "rights_infringing" ||
      t4.status === "void_ab_initio";

    const usesMcsap = programs.some((p) => p.id === "fmcsr_mcsap");

    // Heuristics:
    if (usesMcsap && driverType === "private" && (ultraVires || beyondScope)) {
      risk = "high";
      theories.push("false_certification", "metrics_inflation");
      notes =
        "Commercial FMCSR-style funding appears to be supported by enforcement metrics applied to a private, non-commercial driver. " +
        "This raises concern that the state certified commercial compliance while counting non-commercial events.";
    } else if (preempted && constBad) {
      risk = "high";
      theories.push("implied_false_certification");
      notes =
        "The combination of preemption concerns and constitutional overreach suggests that funding certifications may not match actual practices.";
    } else if (beyondScope || constBad) {
      risk = "medium";
      theories.push("implied_false_certification");
      notes =
        "Enforcement appears structurally over-broad. Funding tied to these practices may be at risk if certifications assumed narrower, lawful use.";
    } else if (ultraVires) {
      risk = "medium";
      theories.push("false_certification");
      notes =
        "Enforcement is characterized as ultra vires under the law audit. Funding that depends on lawful implementation may be subject to challenge.";
    } else {
      risk = "low";
      theories.push("no_clear_theory");
      notes =
        "No strong indication from the law audit that existing funding is being used in a way that contradicts certifications or statutory intent.";
    }

    // Reverse false claim: if practices are pulled back to avoid scrutiny
    if (risk === "high" && preempted) {
      theories.push("reverse_false_claim");
    }

    return {
      risk_level: risk,
      theories: Array.from(new Set(theories)),
      notes
    };
  }

  function buildSummary(jurisdiction, lawCategory, programs, assessment) {
    const uf =
      `In ${jurisdiction.state}, this enforcement pattern appears in the category ` +
      `'${lawCategory}'. Based on the sovereign law audit and the likely funding sources, ` +
      `the False Claims Act / funding misalignment risk is assessed as ${assessment.risk_level.toUpperCase()}.`;

    const tech = {
      law_category: lawCategory,
      programs_considered: programs,
      risk_level: assessment.risk_level,
      theories: assessment.theories,
      notes: assessment.notes
    };

    return {
      user_friendly: uf,
      technical: JSON.stringify(tech, null, 2)
    };
  }

  async function runFundingAudit() {
    const intake = loadLocal(INTAKE_KEY);
    const classify = loadLocal(CLASSIFY_KEY);
    const lawAudit = loadLocal(LAWAUDIT_KEY);

    if (!intake || !classify || !lawAudit) {
      console.warn(
        "FundingAudit: missing intake, classify, or law audit. Run earlier steps first."
      );
      return;
    }

    const programsConfig = await loadJson("../engine/funding_audit/programs.json");

    const jurisdiction = {
      country: intake.jurisdiction?.country || "United States",
      state: intake.jurisdiction?.state || "Unknown"
    };

    const lawCategory = inferCategoryFromLawAudit(lawAudit);

    const programs = selectPrograms(lawCategory, programsConfig);
    const assessment = assessRisk(lawCategory, programs, lawAudit, classify);
    const summary = buildSummary(jurisdiction, lawCategory, programs, assessment);

    const fundingAudit = {
      jurisdiction,
      law_category: lawCategory,
      programs_considered: programs,
      assessment,
      summary
    };

    try {
      localStorage.setItem(FUNDING_KEY, JSON.stringify(fundingAudit));
      console.log("ABE_FundingAudit stored:", fundingAudit);
    } catch (e) {
      console.error("FundingAudit: error saving:", e);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    runFundingAudit().catch((e) => {
      console.error("FundingAudit: failure:", e);
    });
  });
})();
