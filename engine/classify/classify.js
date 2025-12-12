// engine/classify/classify.js
(function () {
  const INTAKE_KEY = "ABE_IntakeSession";
  const CLASSIFY_KEY = "ABE_Classify";

  function loadIntake() {
    try {
      const raw = localStorage.getItem(INTAKE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      console.error("Error reading intake:", e);
      return null;
    }
  }

  function saveClassify(obj) {
    try {
      localStorage.setItem(CLASSIFY_KEY, JSON.stringify(obj));
    } catch (e) {
      console.error("Error saving classification:", e);
    }
  }

  function classifyFromIntake(intake) {
    if (!intake) {
      return null;
    }

    const flags = [];

    // Driver type
    let driverType = "private";
    const use = intake.driver_context?.vehicle_use || "personal";

    if (use === "intrastate_commercial") {
      driverType = "commercial_intrastate";
    } else if (use === "interstate_commercial") {
      driverType = "commercial_interstate";
    } else {
      driverType = "private";
    }

    const hasCdl = !!intake.driver_context?.has_cdl;
    const cdlStatus = hasCdl ? "has_cdl" : "none";

    // Scenario
    let scenario = "routine_stop";
    const eventType = intake.event?.type || "traffic_stop";

    if (eventType === "checkpoint") scenario = "checkpoint";
    else if (eventType === "hearing") scenario = "hearing";
    else if (eventType === "criminal_case") scenario = "criminal_case";
    else if (eventType === "civil_case") scenario = "civil_case";

    // Suspected basis
    const statutes = intake.statutes || [];
    const statutesText = statutes.map((s) => s.raw.toLowerCase()).join(" ");

    let suspected = "unknown";
    if (statutesText.includes("license") || statutesText.includes("licens"))
      suspected = "licensing_only";
    else if (
      statutesText.includes("owi") ||
      statutesText.includes("dwi") ||
      statutesText.includes("dui") ||
      statutesText.includes("intoxicat")
    )
      suspected = "impaired_driving";
    else if (
      statutesText.includes("registration") ||
      statutesText.includes("insurance")
    )
      suspected = "registration_insurance";
    else if (
      statutesText.includes("commercial") ||
      statutesText.includes("fmcsr") ||
      statutesText.includes("motor carrier")
    )
      suspected = "commercial_compliance";

    // Flags
    if (driverType === "private" && (suspected === "commercial_compliance")) {
      flags.push("private_driver_in_commercial_framework");
      flags.push("possible_fmcsr_misapplication");
    }

    if (hasCdl && driverType === "private") {
      flags.push("cdl_holder_private_use");
    }

    // Any driver + licensing_only => constitutional hot zone
    if (suspected === "licensing_only") {
      flags.push("high_value_constitutional_issue");
    }

    return {
      driver_type: driverType,
      cdl_status: cdlStatus,
      scenario: scenario,
      suspected_basis: suspected,
      flags: flags,
      source_intake_created_at: intake.created_at || null
    };
  }

  // For now, run classification immediately when this script is loaded.
  // Later, results.html can import this and re-run if needed.
  document.addEventListener("DOMContentLoaded", () => {
    const intake = loadIntake();
    if (!intake) {
      console.warn(
        "ABE_Classify: No intake session found. Run intake first."
      );
      return;
    }
    const classification = classifyFromIntake(intake);
    if (!classification) {
      console.warn("ABE_Classify: Could not classify intake.");
      return;
    }
    saveClassify(classification);
    console.log("ABE_Classify stored:", classification);
  });
})();
