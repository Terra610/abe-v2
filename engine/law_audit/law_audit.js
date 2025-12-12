// engine/law_audit/law_audit.js
(function () {
  const INTAKE_KEY = "ABE_IntakeSession";
  const CLASSIFY_KEY = "ABE_Classify";
  const LAWAUDIT_KEY = "ABE_LawAudit";

  async function loadJson(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`Failed to load ${path}`);
    return res.json();
  }

  function loadIntake() {
    try {
      const raw = localStorage.getItem(INTAKE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      console.error("LawAudit: error reading intake:", e);
      return null;
    }
  }

  function loadClassify() {
    try {
      const raw = localStorage.getItem(CLASSIFY_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      console.error("LawAudit: error reading classify:", e);
      return null;
    }
  }

  function inferCategory(intake, classify) {
    const suspected = classify?.suspected_basis || "unknown";
    const statutesText = (intake?.statutes || [])
      .map((s) => s.raw.toLowerCase())
      .join(" ");

    if (suspected === "licensing_only") return "driver_licensing";
    if (suspected === "registration_insurance") {
      if (statutesText.includes("registr")) return "vehicle_registration";
      if (statutesText.includes("insur")) return "insurance";
    }
    if (suspected === "impaired_driving") return "dwi_dui_owi";
    if (suspected === "commercial_compliance") return "commercial_transport";

    if (statutesText.includes("fmcsr") || statutesText.includes("390.")) {
      return "fmcsr_adoption";
    }
    if (statutesText.includes("implied consent")) return "implied_consent";

    return "other";
  }

  function evaluateTier1FederalAlignment(category, rules, classify) {
    const cat = rules.categories[category] || rules.categories.other;
    const driverType = classify?.driver_type || "private";

    let status = "aligned";
    let notes = "";
    const sources = rules.federal.anchors.concat(cat.federal_sources || []);

    if (
      (category === "fmcsr_adoption" || category === "commercial_transport") &&
      driverType === "private"
    ) {
      status = "ultra_vires";
      notes =
        "FMCSRs and commercial transport rules are being applied to a private driver. This extends beyond the federal commercial scope in Title 49 and FMCSRs.";
    } else if (
      category === "implied_consent" &&
      driverType === "private"
    ) {
      status = "over_broad";
      notes =
        "Implied consent doctrine is extended to a non-commercial driver without a clear federal or textual mandate.";
    } else {
      notes =
        "No explicit federal statutory anchor found that justifies extending this framework to the classified driver type.";
    }

    return {
      status,
      notes,
      federal_sources: sources
    };
  }

  function evaluateTier2ScopeAndNexus(category, rules, classify) {
    const cat = rules.categories[category] || rules.categories.other;
    const commercialRequired = !!cat.commercial_nexus_required;

    const driverType = classify?.driver_type || "private";
    const vehicleUse = classify?.vehicle_use || "personal";

    const isCommercialUse =
      driverType === "commercial_intrastate" ||
      driverType === "commercial_interstate" ||
      vehicleUse === "intrastate_commercial" ||
      vehicleUse === "interstate_commercial";

    let scopeStatus = "within_scope";
    let notes = "";

    if (commercialRequired && !isCommercialUse) {
      scopeStatus = "beyond_scope";
      notes =
        "The ruleset being used assumes a commercial nexus, but the intake and classification show private, non-commercial use.";
    } else if (commercialRequired && isCommercialUse) {
      scopeStatus = "within_scope";
      notes = "Commercial nexus is present; analysis will hinge on correct FMCSR application.";
    } else {
      scopeStatus = "within_scope";
      notes =
        "No explicit commercial nexus requirement for this category; scope must still respect constitutional limits.";
    }

    return {
      commercial_nexus_required: commercialRequired,
      commercial_nexus_present: isCommercialUse,
      scope_status: scopeStatus,
      notes
    };
  }

  function evaluateTier3Preemption(category, rules, preemptionTree, classify) {
    // For now, we apply a simple heuristic:
    // - FMCSR-related categories applied to private drivers → obstacle preemption.
    const driverType = classify?.driver_type || "private";

    if (
      (category === "fmcsr_adoption" || category === "commercial_transport") &&
      driverType === "private"
    ) {
      return {
        status: "obstacle_preempted",
        notes:
          "State practice obstructs Congress’s decision to limit FMCSRs and related funding conditions to commercial motor carriers."
      };
    }

    return {
      status: "no_preemption_issue",
      notes:
        "No immediate federal preemption conflict inferred from category and classification alone."
    };
  }

  function evaluateTier4Constitutional(category, rules, classify) {
    const driverType = classify?.driver_type || "private";
    const suspected = classify?.suspected_basis || "unknown";

    let status = "text_aligned";
    const rights = [];
    let notes = "";

    if (category === "driver_licensing" && driverType === "private") {
      status = "void_ab_initio";
      rights.push(...rules.constitutional.rights_mapping.driver_licensing_private);
      notes =
        "Licensing private, non-commercial movement as a condition of basic travel exceeds delegated powers and burdens retained rights.";
    } else if (category === "implied_consent" && driverType === "private") {
      status = "rights_infringing";
      rights.push(...rules.constitutional.rights_mapping.implied_consent_private);
      notes =
        "Implied consent applied to non-commercial drivers raises serious Fourth, Fifth, Ninth, and Fourteenth Amendment concerns.";
    } else if (
      (category === "fmcsr_adoption" || category === "commercial_transport") &&
      driverType === "private"
    ) {
      status = "over_reach";
      notes =
        "Importing commercial enforcement tools into private, non-commercial conduct suggests structural overreach.";
    } else if (suspected === "licensing_only") {
      status = "over_reach";
      rights.push("Ninth Amendment", "Tenth Amendment", "Fourteenth Amendment");
      notes =
        "Licensing-only enforcement on a driver classified as exercising private movement indicates potential infringement on retained rights.";
    } else {
      status = "text_aligned";
      notes =
        "No immediate constitutional defect categorized at this tier, but detailed review may still reveal issues.";
    }

    return {
      status,
      rights_implicated: rights,
      notes
    };
  }

  function buildSummary(jurisdiction, lawRef, userProfile, checks) {
    const flags = [];

    if (checks.tier1_federal_alignment.status === "ultra_vires") {
      flags.push("ultra_vires_enforcement");
    }
    if (
      checks.tier2_scope_and_nexus.commercial_nexus_required &&
      !checks.tier2_scope_and_nexus.commercial_nexus_present
    ) {
      flags.push("no_commercial_nexus", "private_driver_in_commercial_framework");
    }
    if (
      checks.tier3_preemption.status === "express_preempted" ||
      checks.tier3_preemption.status === "field_preempted" ||
      checks.tier3_preemption.status === "conflict_preempted" ||
      checks.tier3_preemption.status === "obstacle_preempted"
    ) {
      flags.push("likely_preempted");
    }
    if (
      checks.tier4_constitutional.status === "over_reach" ||
      checks.tier4_constitutional.status === "rights_infringing" ||
      checks.tier4_constitutional.status === "void_ab_initio"
    ) {
      flags.push("constitutional_violation");
    }
    if (checks.tier4_constitutional.status === "void_ab_initio") {
      flags.push("void_ab_initio_pattern");
    }

    const uf =
      `You are classified as a ${userProfile.driver_type} driver in ${jurisdiction.state}. ` +
      `The laws or practices applied appear ${checks.tier1_federal_alignment.status.replace("_", " ")} under federal scope, ` +
      `${checks.tier2_scope_and_nexus.scope_status.replace("_", " ")} on commercial nexus, ` +
      `and ${checks.tier4_constitutional.status.replace("_", " ")} at the constitutional level.`;

    const technical = JSON.stringify(checks, null, 2);

    return {
      user_friendly: uf,
      technical: technical,
      risk_flags: flags
    };
  }

  async function runLawAudit() {
    const intake = loadIntake();
    const classify = loadClassify();

    if (!intake || !classify) {
      console.warn(
        "LawAudit: Missing intake or classification. Run intake and classify first."
      );
      return;
    }

    const [rules, preemptionTree] = await Promise.all([
      loadJson("../engine/law_audit/rules.json"),
      loadJson("../engine/law_audit/preemption_tree.json")
    ]);

    const jurisdiction = {
      country: intake.jurisdiction?.country || "United States",
      state: intake.jurisdiction?.state || "Unknown",
      county: intake.jurisdiction?.county || ""
    };

    const category = inferCategory(intake, classify);

    const lawRef = {
      category: category,
      statutes_raw: (intake.statutes || []).map((s) => s.raw)
    };

    const userProfile = {
      driver_type: classify.driver_type,
      cdl_status: classify.cdl_status,
      vehicle_use: classify.vehicle_use || intake.driver_context?.vehicle_use,
      scenario: classify.scenario,
      suspected_basis: classify.suspected_basis
    };

    const tier1 = evaluateTier1FederalAlignment(category, rules, classify);
    const tier2 = evaluateTier2ScopeAndNexus(category, rules, classify);
    const tier3 = evaluateTier3Preemption(category, rules, preemptionTree, classify);
    const tier4 = evaluateTier4Constitutional(category, rules, classify);

    const checks = {
      tier1_federal_alignment: tier1,
      tier2_scope_and_nexus: tier2,
      tier3_preemption: tier3,
      tier4_constitutional: tier4
    };

    const summary = buildSummary(jurisdiction, lawRef, userProfile, checks);

    const audit = {
      jurisdiction,
      law_reference: lawRef,
      user_profile: userProfile,
      audit_checks: checks,
      summary
    };

    try {
      localStorage.setItem(LAWAUDIT_KEY, JSON.stringify(audit));
      console.log("ABE_LawAudit stored:", audit);
    } catch (e) {
      console.error("LawAudit: error saving result:", e);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    // This will run whenever law_audit.js is included on a page (e.g., results.html later)
    runLawAudit().catch((e) => {
      console.error("LawAudit: failure:", e);
    });
  });
})();
