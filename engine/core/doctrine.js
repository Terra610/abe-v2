// engine/core/doctrine.js
// Minimal rule engine for A.B.E. — plugs federal doctrines and mappings into audit payloads.

async function loadJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error("Failed to load " + path);
  return res.json();
}

async function buildDoctrineEngine(stateCode) {
  const [
    doctrines,
    fundingConditions,
    commerceScope,
    preemptionRules,
    rightsTests,
    stateMap
  ] = await Promise.all([
    loadJson("../doctrine/federal_doctrines.json"),
    loadJson("../doctrine/funding_conditions.json"),
    loadJson("../mappings/commerce_scope.json"),
    loadJson("../mappings/preemption_rules.json"),
    loadJson("../mappings/rights_tests.json"),
    loadJson("../mappings/state_map_" + stateCode + ".json").catch(() => null)
  ]);

  const doctrineIndex = {};
  doctrines.doctrines.forEach(d => doctrineIndex[d.id] = d);

  const fundingIndex = {};
  fundingConditions.programs.forEach(p => fundingIndex[p.id] = p);

  return {
    evaluateAudit(auditPayload) {
      const findings = [];

      const state = (auditPayload.state || "").toUpperCase();
      const caseType = auditPayload.case_type || "traffic";
      const severity = auditPayload.severity || "medium";
      const lawsText = (auditPayload.laws || "").toLowerCase();
      const funding = auditPayload.funding || {};

      // Determine movement scope (very simple heuristic for now)
      const movementScope = "private"; // default assumption in this version

      // Infer funding program IDs from free-text grant field
      const fundingProgramIds = [];
      const grantText = (funding.grant || "").toLowerCase();
      if (grantText.includes("mcsap") || grantText.includes("motor carrier")) {
        fundingProgramIds.push("mcsap");
      }
      if (grantText.includes("402") || grantText.includes("nhtsa")) {
        fundingProgramIds.push("nhtsa_402");
      }

      // Apply preemption / authority rules
      preemptionRules.rules.forEach(rule => {
        // Case type filter
        if (rule.triggers.case_type &&
            !rule.triggers.case_type.includes(caseType)) return;

        // Movement scope filter
        if (rule.triggers.movement_scope &&
            !rule.triggers.movement_scope.includes(movementScope)) return;

        // Keyword filter
        if (rule.triggers.keywords_in_law_block) {
          const hit = rule.triggers.keywords_in_law_block.some(kw =>
            lawsText.includes(kw.toLowerCase())
          );
          if (!hit) return;
        }

        // Funding program filter
        if (rule.triggers.funding_program_ids &&
            !rule.triggers.funding_program_ids.some(id => fundingProgramIds.includes(id))) {
          return;
        }

        // Severity filter (rough)
        if (rule.triggers.severity_min) {
          const order = ["low", "medium", "high", "extreme"];
          const need = order.indexOf(rule.triggers.severity_min);
          const have = order.indexOf(severity);
          if (have < need) return;
        }

        const attachedDoctrines = (rule.doctrine_refs || [])
          .map(id => doctrineIndex[id])
          .filter(Boolean);

        findings.push({
          rule_id: rule.id,
          description: rule.description,
          doctrines: attachedDoctrines
        });
      });

      // Rights tests + state-specific
      const flags = [];
      if (stateMap && Array.isArray(stateMap.statutes)) {
        stateMap.statutes.forEach(s => {
          (s.risk_flags || []).forEach(flagId => {
            const rt = rightsTests.tests.find(t => t.id === flagId);
            if (rt) {
              flags.push({
                statute: s.citation,
                rights_test_id: rt.id,
                description: rt.description,
                doctrines: (rt.doctrine_refs || []).map(id => doctrineIndex[id]).filter(Boolean)
              });
            }
          });
        });
      }

      return {
        state,
        case_type: caseType,
        severity,
        funding_program_ids: fundingProgramIds,
        preemption_findings: findings,
        rights_flags: flags
      };
    }
  };
}

// Example usage on export page (conceptual):
// const engine = await buildDoctrineEngine(exportPayload.state);
// const analysis = engine.evaluateAudit(exportPayload);
// then embed `analysis` into your export JSON.
