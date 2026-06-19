class SchemaError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SchemaError';
    this.code = 'schema-invalid';
  }
}

class DomainError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DomainError';
    this.code = 'domain-invalid';
  }
}

const COMPATIBILITY_MAP = {
  'missing_owner': ['workflow_owner_missing', 'post_launch_owner_missing'],
  'unclear_requirement': ['core_requirements_conflict', 'acceptance_criteria_missing'],
  'timeline_risk': ['implementation_sequence_invalid', 'customer_milestone_unconfirmed'],
  'dependency_risk': ['launch_dependency_unconfirmed', 'launch_dependency_failed', 'essential_data_unavailable', 'integration_feasibility_unknown'],
  'adoption_risk': ['training_plan_missing', 'change_communication_missing', 'adoption_measurement_missing'],
  'operational_readiness_gap': ['support_model_missing', 'escalation_path_missing', 'monitoring_plan_missing', 'rollback_plan_missing'],
  'handoff_risk': ['workflow_owner_missing', 'post_launch_owner_missing'],
  'success_measurement_gap': ['success_criteria_missing', 'adoption_measurement_missing'],
  'decision_gap': ['required_approval_missing']
};

const APPROVED_CODES = new Set([
  'required_approval_missing', 'workflow_owner_missing', 'launch_dependency_unconfirmed',
  'launch_dependency_failed', 'essential_data_unavailable', 'integration_feasibility_unknown',
  'core_requirements_conflict', 'acceptance_criteria_missing', 'implementation_sequence_invalid',
  'customer_milestone_unconfirmed', 'training_plan_missing', 'change_communication_missing',
  'adoption_measurement_missing', 'post_launch_owner_missing', 'support_model_missing',
  'escalation_path_missing', 'monitoring_plan_missing', 'rollback_plan_missing',
  'success_criteria_missing'
]);

const VALID_SEVERITIES = ['critical', 'high', 'medium', 'low'];
const VALID_STATUSES = ['open', 'mitigating', 'resolved', 'accepted'];

function validateOptionalReviewerFields(risk, label) {
  if (
    risk.severityOverride !== undefined &&
    risk.severityOverride !== null &&
    !VALID_SEVERITIES.includes(risk.severityOverride)
  ) {
    throw new SchemaError(`[${label}] Invalid severityOverride '${risk.severityOverride}'.`);
  }

  ['blocksLaunchOverride', 'blocksProgressionOverride'].forEach(field => {
    if (risk[field] !== undefined && risk[field] !== null && typeof risk[field] !== 'boolean') {
      throw new SchemaError(`[${label}] ${field} must be a boolean when provided.`);
    }
  });

  if (
    risk.targetDate !== undefined &&
    risk.targetDate !== null &&
    risk.targetDate !== '' &&
    (
      typeof risk.targetDate !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(risk.targetDate) ||
      Number.isNaN(Date.parse(`${risk.targetDate}T00:00:00Z`))
    )
  ) {
    throw new SchemaError(`[${label}] targetDate must be a valid YYYY-MM-DD date.`);
  }

  if (
    risk.overrideReason !== undefined &&
    (typeof risk.overrideReason !== 'string' || risk.overrideReason.length > 2000)
  ) {
    throw new SchemaError(`[${label}] overrideReason must be a string no longer than 2000 characters.`);
  }

  if (
    risk.overrideUpdatedAt !== undefined &&
    (
      typeof risk.overrideUpdatedAt !== 'string' ||
      Number.isNaN(Date.parse(risk.overrideUpdatedAt))
    )
  ) {
    throw new SchemaError(`[${label}] overrideUpdatedAt must be a valid timestamp.`);
  }
}

const ValidationEngine = {
  SchemaError,
  DomainError,

  validateDomainSchema(data, appConfig) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new SchemaError('Analysis response must be a JSON object.');
    }

    if (typeof data.summary !== 'string' || data.summary.trim() === '') {
      throw new SchemaError('Analysis response must contain a non-empty summary string.');
    }

    if (!Array.isArray(data.topBlockers)) {
      throw new SchemaError('Analysis response must contain a topBlockers array.');
    }

    if (!Array.isArray(data.risks)) {
      throw new SchemaError('Analysis response must contain a risks array.');
    }

    const categories = appConfig.categories;
    const severities = appConfig.severities;

    data.risks.forEach((risk, idx) => {
      const rLabel = risk && risk.title ? risk.title : `Risk #${idx + 1}`;
      if (!risk || typeof risk !== 'object' || Array.isArray(risk)) {
        throw new SchemaError(`[${rLabel}] Risk must be an object.`);
      }

      const idVal = risk.id || risk.tempId;
      if (!idVal || typeof idVal !== 'string') {
        throw new SchemaError(`[${rLabel}] Missing or invalid id/tempId.`);
      }

      if (!risk.title || typeof risk.title !== 'string') {
        throw new SchemaError(`[${rLabel}] Missing or invalid title.`);
      }

      if (!categories.includes(risk.category)) {
        throw new DomainError(`[${rLabel}] Invalid category '${risk.category}'. Expected one of: ${categories.join(', ')}`);
      }

      if (!VALID_SEVERITIES.includes(risk.suggestedSeverity)) {
        throw new SchemaError(`[${rLabel}] Invalid suggestedSeverity '${risk.suggestedSeverity}'.`);
      }

      if (risk.finalSeverity !== undefined && !severities.includes(risk.finalSeverity)) {
        throw new SchemaError(`[${rLabel}] Invalid finalSeverity '${risk.finalSeverity}'.`);
      }

      validateOptionalReviewerFields(risk, rLabel);

      if (typeof risk.confidence !== 'number' || risk.confidence < 0 || risk.confidence > 1) {
        throw new SchemaError(`[${rLabel}] Invalid confidence '${risk.confidence}'. Must be a number between 0.0 and 1.0.`);
      }

      if (!Array.isArray(risk.evidence) || risk.evidence.length === 0) {
        throw new SchemaError(`[${rLabel}] Missing supporting evidence. Each risk must have at least one evidence reference.`);
      }
      risk.evidence.forEach((ev, evIdx) => {
        if (!ev.excerpt || typeof ev.excerpt !== 'string' || ev.excerpt.trim() === '') {
          throw new SchemaError(`[${rLabel}] Evidence #${evIdx + 1} has a missing or empty excerpt.`);
        }
        if (!ev.sourceReference || typeof ev.sourceReference !== 'string' || ev.sourceReference.trim() === '') {
          throw new SchemaError(`[${rLabel}] Evidence #${evIdx + 1} has a missing or empty sourceReference.`);
        }
      });

      const validEvidenceTypes = ['explicit', 'inferred', 'missing_information'];
      if (!validEvidenceTypes.includes(risk.evidenceType)) {
        throw new SchemaError(`[${rLabel}] Invalid evidenceType '${risk.evidenceType}'.`);
      }

      if (risk.evidenceType === 'missing_information') {
        if (!risk.missingElement || typeof risk.missingElement !== 'string' || risk.missingElement.trim() === '') {
          throw new DomainError(`[${rLabel}] Missing or empty missingElement for missing_information.`);
        }
        if (!risk.reviewedContext || typeof risk.reviewedContext !== 'string' || risk.reviewedContext.trim() === '') {
          throw new DomainError(`[${rLabel}] Missing or empty reviewedContext for missing_information.`);
        }
      }

      if (!Array.isArray(risk.conditionCodes)) {
        throw new SchemaError(`[${rLabel}] conditionCodes must be an array.`);
      }

      const compatibleCodes = COMPATIBILITY_MAP[risk.category] || [];
      risk.conditionCodes.forEach(code => {
        if (!APPROVED_CODES.has(code)) {
          throw new DomainError(`[${rLabel}] Invalid condition code '${code}'.`);
        }
        if (!compatibleCodes.includes(code)) {
          throw new DomainError(`[${rLabel}] Condition code '${code}' is incompatible with category '${risk.category}'.`);
        }
      });

      const codesSet = new Set(risk.conditionCodes);
      if (codesSet.has('launch_dependency_failed') && codesSet.has('launch_dependency_unconfirmed')) {
        throw new DomainError(`[${rLabel}] Contradictory condition codes: cannot have both launch_dependency_failed and launch_dependency_unconfirmed.`);
      }
      if (risk.accountabilityStatus === 'confirmed') {
        if (codesSet.has('workflow_owner_missing') || codesSet.has('post_launch_owner_missing')) {
          throw new DomainError(`[${rLabel}] Contradictory fields: accountabilityStatus is confirmed but condition codes indicate missing owner.`);
        }
      }

      const validScopes = ['core', 'supporting', 'peripheral'];
      if (!validScopes.includes(risk.affectedScope)) {
        throw new SchemaError(`[${rLabel}] Invalid affectedScope '${risk.affectedScope}'.`);
      }

      const validStages = ['discovery', 'configuration', 'validation', 'training', 'launch', 'post_launch'];
      if (!validStages.includes(risk.affectedStage)) {
        throw new SchemaError(`[${rLabel}] Invalid affectedStage '${risk.affectedStage}'.`);
      }

      const stringFields = [
        'implementationImpact', 'requiredClarificationOrAction', 'confidenceReason',
        'suggestedBlockerReason'
      ];
      stringFields.forEach(field => {
        if (typeof risk[field] !== 'string') {
          throw new SchemaError(`[${rLabel}] Missing or invalid string property: ${field}`);
        }
      });

      if (risk.status !== undefined && !VALID_STATUSES.includes(risk.status)) {
        throw new SchemaError(`[${rLabel}] Invalid status: '${risk.status}'.`);
      }

      if (risk.suggestedOwner !== undefined && typeof risk.suggestedOwner !== 'string') {
        throw new SchemaError(`[${rLabel}] suggestedOwner must be a string when provided.`);
      }

      if (risk.ownerStatus !== undefined && !['confirmed', 'unconfirmed'].includes(risk.ownerStatus)) {
        throw new SchemaError(`[${rLabel}] Invalid ownerStatus '${risk.ownerStatus}'.`);
      }

      if (risk.status === 'resolved') {
        if (risk.ownerStatus !== 'confirmed') {
          throw new SchemaError(`[${rLabel}] Resolved risk must have a confirmed owner.`);
        }
        if (!risk.resolutionNote || typeof risk.resolutionNote !== 'string' || risk.resolutionNote.trim() === '') {
          throw new SchemaError(`[${rLabel}] Resolved risk must have a non-empty resolutionNote.`);
        }
        if (!risk.resolvedAt || typeof risk.resolvedAt !== 'string' || risk.resolvedAt.trim() === '' || Number.isNaN(Date.parse(risk.resolvedAt))) {
          throw new SchemaError(`[${rLabel}] Resolved risk must have a valid non-empty resolvedAt timestamp.`);
        }
      }
    });

    if (!Array.isArray(data.stakeholders)) {
      throw new SchemaError('Analysis response must contain a stakeholders array.');
    }
    data.stakeholders.forEach((sh, idx) => {
      if (!sh.name || typeof sh.name !== 'string') throw new SchemaError(`Stakeholder #${idx + 1} is missing a name.`);
      if (!sh.role || typeof sh.role !== 'string') throw new SchemaError(`Stakeholder #${idx + 1} is missing a role.`);
      if (!Array.isArray(sh.goals)) throw new SchemaError(`Stakeholder '${sh.name}' is missing a goals array.`);
      if (!Array.isArray(sh.conflicts)) throw new SchemaError(`Stakeholder '${sh.name}' is missing a conflicts array.`);
      if (typeof sh.authority !== 'string') throw new SchemaError(`Stakeholder '${sh.name}' is missing an authority description.`);
    });

    if (!Array.isArray(data.dependencies)) {
      throw new SchemaError('Analysis response must contain a dependencies array.');
    }
    const validDepTypes = ['data', 'technical', 'configuration', 'people', 'policy', 'data-dependency', 'configuration-dependency', 'technical-dependency', 'people-dependency', 'policy-dependency'];
    data.dependencies.forEach((dep, idx) => {
      if (!dep.name || typeof dep.name !== 'string') throw new SchemaError(`Dependency #${idx + 1} is missing a name.`);
      if (!validDepTypes.includes(dep.type)) throw new SchemaError(`Dependency '${dep.name}' has an invalid type '${dep.type}'.`);
      if (typeof dep.description !== 'string') throw new SchemaError(`Dependency '${dep.name}' is missing a description.`);
      if (!['missing', 'resolved'].includes(dep.status)) throw new SchemaError(`Dependency '${dep.name}' has an invalid status '${dep.status}'.`);
    });

    if (!Array.isArray(data.decisions)) {
      throw new SchemaError('Analysis response must contain a decisions array.');
    }
    data.decisions.forEach((dec, idx) => {
      if (!dec.id || typeof dec.id !== 'string') throw new SchemaError(`Decision #${idx + 1} is missing an id.`);
      if (!dec.decision || typeof dec.decision !== 'string') throw new SchemaError(`Decision #${idx + 1} is missing a decision statement.`);
      if (!Array.isArray(dec.relatedRisks)) throw new SchemaError(`Decision '${dec.id}' is missing a relatedRisks array.`);
      if (typeof dec.suggestedOwner !== 'string') throw new SchemaError(`Decision '${dec.id}' is missing a suggestedOwner.`);
      if (typeof dec.consequence !== 'string') throw new SchemaError(`Decision '${dec.id}' is missing a consequence description.`);
    });

    if (!Array.isArray(data.validationQuestions)) {
      throw new SchemaError('Analysis response must contain a validationQuestions array.');
    }
    const validQuestionCats = ['scope', 'workflow', 'ownership', 'data', 'configuration', 'security', 'success', 'rollout'];
    data.validationQuestions.forEach((q, idx) => {
      if (!q.category || !validQuestionCats.includes(q.category)) {
        throw new SchemaError(`Validation Question #${idx + 1} has an invalid category '${q.category}'.`);
      }
      if (!q.question || typeof q.question !== 'string') {
        throw new SchemaError(`Validation Question #${idx + 1} is missing a question string.`);
      }
    });

    if (!Array.isArray(data.rolloutRecommendations)) {
      throw new SchemaError('Analysis response must contain a rolloutRecommendations array.');
    }
    data.rolloutRecommendations.forEach((rec, idx) => {
      if (!['30-day', '60-day', '90-day'].includes(rec.phase)) {
        throw new SchemaError(`Rollout Recommendation #${idx + 1} has an invalid phase '${rec.phase}'.`);
      }
      if (!rec.action || typeof rec.action !== 'string') {
        throw new SchemaError(`Rollout Recommendation #${idx + 1} is missing an action.`);
      }
      if (typeof rec.owner !== 'string') {
        throw new SchemaError(`Rollout Recommendation #${idx + 1} is missing an owner.`);
      }
    });

    return true;
  },

  normalizeRegistryImport(payload, appConfig) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new SchemaError('Imported registry must be a JSON object.');
    }

    let result = payload;
    let metadata = {};

    if (payload.exportFormat !== undefined) {
      if (payload.exportFormat !== 'risk-scan-registry') {
        throw new SchemaError(`Unsupported registry format '${payload.exportFormat}'.`);
      }
      if (payload.exportVersion !== 1) {
        throw new SchemaError(`Unsupported registry export version '${payload.exportVersion}'.`);
      }
      if (!payload.result || typeof payload.result !== 'object') {
        throw new SchemaError('Registry export is missing its result object.');
      }
      result = payload.result;
      metadata = {
        projectName: typeof payload.projectName === 'string' ? payload.projectName : '',
        analysisProfile: typeof payload.analysisProfile === 'string' ? payload.analysisProfile : '',
        sourceText: typeof payload.sourceText === 'string' ? payload.sourceText : '',
        exportedAt: typeof payload.exportedAt === 'string' ? payload.exportedAt : ''
      };
    }

    this.validateDomainSchema(result, appConfig);
    return { result, metadata };
  }
};

if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
  module.exports = ValidationEngine;
} else {
  window.ValidationEngine = ValidationEngine;
}
