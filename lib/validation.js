const ValidationEngine = {
  validateDomainSchema(data, appConfig) {
    if (!data || typeof data !== 'object') {
      throw new Error('Analysis response must be a JSON object.');
    }

    if (typeof data.summary !== 'string' || data.summary.trim() === '') {
      throw new Error('Analysis response must contain a non-empty summary string.');
    }

    if (!Array.isArray(data.topBlockers)) {
      throw new Error('Analysis response must contain a topBlockers array.');
    }

    if (!Array.isArray(data.risks)) {
      throw new Error('Analysis response must contain a risks array.');
    }

    // Validate risks
    data.risks.forEach((risk, idx) => {
      const rLabel = risk.title || `Risk #${idx + 1}`;
      if (!risk.id || typeof risk.id !== 'string') {
        throw new Error(`[${rLabel}] Missing or invalid id.`);
      }
      if (!risk.title || typeof risk.title !== 'string') {
        throw new Error(`[${rLabel}] Missing or invalid title.`);
      }
      
      // Validate Category
      if (!appConfig.categories.includes(risk.category)) {
        throw new Error(`[${rLabel}] Invalid category '${risk.category}'. Expected one of: ${appConfig.categories.join(', ')}`);
      }

      // Validate Severity
      if (!appConfig.severities.includes(risk.severity)) {
        throw new Error(`[${rLabel}] Invalid severity '${risk.severity}'. Expected one of: ${appConfig.severities.join(', ')}`);
      }

      // Validate Confidence
      if (typeof risk.confidence !== 'number' || risk.confidence < 0 || risk.confidence > 1) {
        throw new Error(`[${rLabel}] Invalid confidence '${risk.confidence}'. Must be a number between 0.0 and 1.0.`);
      }

      // Validate Evidence
      if (!Array.isArray(risk.evidence) || risk.evidence.length === 0) {
        throw new Error(`[${rLabel}] Missing supporting evidence. Each risk must have at least one evidence reference.`);
      }
      risk.evidence.forEach((ev, evIdx) => {
        if (!ev.excerpt || typeof ev.excerpt !== 'string' || ev.excerpt.trim() === '') {
          throw new Error(`[${rLabel}] Evidence #${evIdx + 1} has a missing or empty excerpt.`);
        }
        if (!ev.sourceReference || typeof ev.sourceReference !== 'string' || ev.sourceReference.trim() === '') {
          throw new Error(`[${rLabel}] Evidence #${evIdx + 1} has a missing or empty sourceReference.`);
        }
      });

      // Validate other string properties
      const stringFields = ['businessImpact', 'reasoning', 'recommendedAction', 'requiredDecision', 'suggestedOwner', 'ownerStatus', 'status'];
      stringFields.forEach(field => {
        if (typeof risk[field] !== 'string') {
          throw new Error(`[${rLabel}] Missing or invalid string property: ${field}`);
        }
      });

      if (!['open', 'mitigating', 'resolved', 'accepted'].includes(risk.status)) {
        throw new Error(`[${rLabel}] Invalid status: '${risk.status}'. Expected 'open', 'mitigating', 'resolved', or 'accepted'.`);
      }

      // Resolved risk validation
      if (risk.status === 'resolved') {
        if (risk.ownerStatus !== 'confirmed') {
          throw new Error(`[${rLabel}] Resolved risk must have a confirmed owner.`);
        }
        if (!risk.resolutionNote || typeof risk.resolutionNote !== 'string' || risk.resolutionNote.trim() === '') {
          throw new Error(`[${rLabel}] Resolved risk must have a non-empty resolutionNote.`);
        }
        if (!risk.resolvedAt || typeof risk.resolvedAt !== 'string' || risk.resolvedAt.trim() === '' || Number.isNaN(Date.parse(risk.resolvedAt))) {
          throw new Error(`[${rLabel}] Resolved risk must have a valid non-empty resolvedAt timestamp.`);
        }
      }
    });

    // Validate Stakeholders
    if (!Array.isArray(data.stakeholders)) {
      throw new Error('Analysis response must contain a stakeholders array.');
    }
    data.stakeholders.forEach((sh, idx) => {
      if (!sh.name || typeof sh.name !== 'string') throw new Error(`Stakeholder #${idx + 1} is missing a name.`);
      if (!sh.role || typeof sh.role !== 'string') throw new Error(`Stakeholder #${idx + 1} is missing a role.`);
      if (!Array.isArray(sh.goals)) throw new Error(`Stakeholder '${sh.name}' is missing a goals array.`);
      if (!Array.isArray(sh.conflicts)) throw new Error(`Stakeholder '${sh.name}' is missing a conflicts array.`);
      if (typeof sh.authority !== 'string') throw new Error(`Stakeholder '${sh.name}' is missing an authority description.`);
    });

    // Validate Dependencies
    if (!Array.isArray(data.dependencies)) {
      throw new Error('Analysis response must contain a dependencies array.');
    }
    const validDepTypes = ['data', 'technical', 'configuration', 'people', 'policy', 'data-dependency', 'configuration-dependency', 'technical-dependency', 'people-dependency', 'policy-dependency'];
    data.dependencies.forEach((dep, idx) => {
      if (!dep.name || typeof dep.name !== 'string') throw new Error(`Dependency #${idx + 1} is missing a name.`);
      if (!validDepTypes.includes(dep.type)) throw new Error(`Dependency '${dep.name}' has an invalid type '${dep.type}'.`);
      if (typeof dep.description !== 'string') throw new Error(`Dependency '${dep.name}' is missing a description.`);
      if (!['missing', 'resolved'].includes(dep.status)) throw new Error(`Dependency '${dep.name}' has an invalid status '${dep.status}'.`);
    });

    // Validate Decisions
    if (!Array.isArray(data.decisions)) {
      throw new Error('Analysis response must contain a decisions array.');
    }
    data.decisions.forEach((dec, idx) => {
      if (!dec.id || typeof dec.id !== 'string') throw new Error(`Decision #${idx + 1} is missing an id.`);
      if (!dec.decision || typeof dec.decision !== 'string') throw new Error(`Decision #${idx + 1} is missing a decision statement.`);
      if (!Array.isArray(dec.relatedRisks)) throw new Error(`Decision '${dec.id}' is missing a relatedRisks array.`);
      if (typeof dec.suggestedOwner !== 'string') throw new Error(`Decision '${dec.id}' is missing a suggestedOwner.`);
      if (typeof dec.consequence !== 'string') throw new Error(`Decision '${dec.id}' is missing a consequence description.`);
    });

    // Validate Validation Questions
    if (!Array.isArray(data.validationQuestions)) {
      throw new Error('Analysis response must contain a validationQuestions array.');
    }
    const validQuestionCats = ['scope', 'workflow', 'ownership', 'data', 'configuration', 'security', 'success', 'rollout'];
    data.validationQuestions.forEach((q, idx) => {
      if (!q.category || !validQuestionCats.includes(q.category)) {
        throw new Error(`Validation Question #${idx + 1} has an invalid category '${q.category}'.`);
      }
      if (!q.question || typeof q.question !== 'string') {
        throw new Error(`Validation Question #${idx + 1} is missing a question string.`);
      }
    });

    // Validate Rollout Recommendations
    if (!Array.isArray(data.rolloutRecommendations)) {
      throw new Error('Analysis response must contain a rolloutRecommendations array.');
    }
    data.rolloutRecommendations.forEach((rec, idx) => {
      if (!['30-day', '60-day', '90-day'].includes(rec.phase)) {
        throw new Error(`Rollout Recommendation #${idx + 1} has an invalid phase '${rec.phase}'.`);
      }
      if (!rec.action || typeof rec.action !== 'string') {
        throw new Error(`Rollout Recommendation #${idx + 1} is missing an action.`);
      }
      if (typeof rec.owner !== 'string') {
        throw new Error(`Rollout Recommendation #${idx + 1} is missing an owner.`);
      }
    });

    return true;
  }
};

if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
  module.exports = ValidationEngine;
} else {
  window.ValidationEngine = ValidationEngine;
}
