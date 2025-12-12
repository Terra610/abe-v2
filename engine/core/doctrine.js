// engine/core/doctrine.js
// Minimal rule engine for A.B.E. — plugs federal doctrines, definitions, and mappings into audit payloads.

async function abeLoadJson(path) {
  const res = await fetch(path);
  if (!res.ok) {
    throw new Error("Failed to load " + path + " (" + res.status + ")");
  }
  return res.json();
}

async function buildDoctrineEngine(stateCodeRaw) {
  const stateCode = (stateCodeRaw || "NA").toUpperCase();

  const [
    doctrines,
    fundingConditions,
    commerceScope,
    preemptionRules,
    rightsTests,
    federalDefinitions,
    stateMap
  ] = await Promise.all([
    abeLoadJson("/engine/doctrine/federal_doctrines.json"),
    abeLoadJson("/engine/doctrine/funding_conditions.json"),
    abeLoadJson("/engine/mappings/commerce_scope.json"),
    abeLoadJson("/engine/mappings/preemption_rules.json"),
    abeLoadJson("/engine/mappings/rights_tests.json"),
    abeLoadJson("/engine/doctrine/federal_definitions.json"),
    abeLoadJson("/engine/mappings/state_map_" + stateCode + ".json").catch(() => null)
  ]);

  // Indexes for fast lookup
  const doctrineIndex = {};
  doctrines.doctrines.forEach(d => { doctrineIndex[d.id] = d; });

  const fundingIndex = {};
  fundingConditions.programs.forEach(p => { fundingIndex[p.id] = p; });

  const definitionIndex = {};
  Object.keys(federalDefinitions.definitions || {}).forEach(key => {
    const def = federalDefinitions.definitions[key];
    definitionIndex[def.id || key] = def;
  });

  const severityOrder = ["low", "medium", "high", "extreme"];

  function evaluateAudit(auditPayload) {
    const findings = [];
    const rightsFlags = [];
    const definitionsUsed = [];
    const fundingProgramsUsed = [];

    const state = (auditPayload.state || "").toUpperCase();
    const caseType = auditPayload.case_type || "traffic";
    const severity = auditPayload.severity || "medium";
    const lawsText = (auditPayload.laws || "").toLowerCase();
    const funding = auditPayload.funding || {};

    // Very simple movement scope heuristic for now:
    // assume private movement unless we detect explicit commercial terms.
    let movementScope = "private";
    if (lawsText.includes("for hire") ||
        lawsText.includes("motor carrier") ||
        lawsText.includes("cmv") ||
        lawsText.includes("commercial motor vehicle")) {
      movementScope = "commercial";
    }

    // Infer funding program IDs from free-text grant field
    const fundingProgramIds = [];
    const grantText = (funding.grant || "").toLowerCase();
    if (grantText.includes("mcsap") || grantText.includes("motor carrier")) {
      fundingProgramIds.push("mcsap");
    }
    if (grantText.includes("402") || grantText.includes("nhtsa")) {
      fundingProgramIds.push("nhtsa_402");
    }

    // Track which funding program definitions are actually touched
    fundingProgramIds.forEach(id => {
      if (fundingIndex[id]) {
        fundingProgramsUsed.push(fundingIndex[id]);
      }
    });

    // Apply preemption / authority rules
    (preemptionRules.rules || []).forEach(rule => {
      // Case type filter
      if (rule.triggers?.case_type &&
          !rule.triggers.case_type.includes(caseType)) return;

      // Movement scope filter
      if (rule.triggers?.movement_scope &&
          !rule.triggers.movement_scope.includes(movementScope)) return;

      // Keyword filter
      if (rule.triggers?.keywords_in_law_block) {
        const hit = rule.triggers.keywords_in_law_block.some(kw =>
          lawsText.includes(kw.toLowerCase())
        );
        if (!hit) return;
      }

      // Funding program filter
      if (rule.triggers?.funding_program_ids &&
          !rule.triggers.funding_program_ids.some(id => fundingProgramIds.includes(id))) {
        return;
      }

      // Severity filter
      if (rule.triggers?.severity_min) {
        const need = severityOrder.indexOf(rule.triggers.severity_min);
        const have = severityOrder.indexOf(severity);
        if (have < need) return;
      }

      const attachedDoctrines = (rule.doctrine_refs || [])
        .map(id => doctrineIndex[id])
        .filter(Boolean);

      attachedDoctrines.forEach(d => {
        if (!definitionsUsed.includes(d.id)) {
          definitionsUsed.push(d.id);
        }
      });

      findings.push({
        rule_id: rule.id,
        description: rule.description,
        doctrines: attachedDoctrines
      });
    });

    // Rights tests + state-specific links
    const rtList = rightsTests.tests || [];
    if (stateMap && Array.isArray(stateMap.statutes)) {
      stateMap.statutes.forEach(s => {
        (s.risk_flags || []).forEach(flagId => {
          const rt = rtList.find(t => t.id === flagId);
          if (rt) {
            const attachedDoctrines = (rt.doctrine_refs || [])
              .map(id => doctrineIndex[id])
              .filter(Boolean);

            attachedDoctrines.forEach(d => {
              if (!definitionsUsed.includes(d.id)) {
                definitionsUsed.push(d.id);
              }
            });

            rightsFlags.push({
              statute: s.citation,
              rights_test_id: rt.id,
              description: rt.description,
              doctrines: attachedDoctrines
            });
          }
        });
      });
    }

    // Build summary of implicated doctrines (deduplicated)
    const implicatedDoctrines = definitionsUsed
      .map(id => doctrineIndex[id])
      .filter(Boolean);

    return {
      state,
      case_type: caseType,
      severity,
      movement_scope: movementScope,
      funding_program_ids: fundingProgramIds,
      funding_programs: fundingProgramsUsed,
      preemption_findings: findings,
      rights_flags: rightsFlags,
      implicated_doctrines: implicatedDoctrines
    };
  }

  return {
    evaluateAudit,
    doctrines: doctrineIndex,
    definitions: definitionIndex,
    funding_programs: fundingIndex
  };
}

// Expose globally so HTML pages can call it.
window.ABE = window.ABE || {};
window.ABE.buildDoctrineEngine = buildDoctrineEngine;
