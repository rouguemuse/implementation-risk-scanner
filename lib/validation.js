'use strict';

const OWNER_STATUSES = ['confirmed', 'unconfirmed', 'shared', 'tentative', 'missing'];
const RISK_STATUSES = ['open', 'mitigating', 'resolved', 'accepted'];
const DEPENDENCY_TYPES = [
  'data', 'technical', 'configuration', 'people', 'policy',
  'data-dependency', 'configuration-dependency', 'technical-dependency',
  'people-dependency', 'policy-dependency'
];
const QUESTION_CATEGORIES = ['scope', 'workflow', 'ownership', 'data', 'configuration', 'security', 'success', 'rollout'];
const ROLLOUT_PHASES = ['30-day', '60-day', '90-day'];

function requireNonEmptyString(value, message) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(message);
}

function requireStringArray(value, message) {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || item.trim() === '')) {
    throw new Error(message);
  }
}

const ValidationEngine = {
  OWNER_STATUSES,
  RISK_STATUSES,
  DEPENDENCY_TYPES,
  QUESTION_CATEGORIES,
  ROLLOUT_PHASES,

  validateDomainSchema(data, appConfig) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('Analysis response must be a JSON object.');
    }

    requireNonEmptyString(data.summary, 'Analysis response must contain a non-empty summary string.');
    requireStringArray(data.topBlockers, 'Analysis response must contain a topBlockers array of non-empty strings.');

    if (!Array.isArray(data.risks)) {
      throw new Error('Analysis response must contain a risks array.');
    }

    const riskIds = new Set();
    data.risks.forEach((risk, idx) => {
      const rLabel = risk && risk.title ? risk.title : `Risk #${idx + 1}`;
      if (!risk || typeof risk !== 'object' || Array.isArray(risk)) {
        throw new Error(`[${rLabel}] Risk must be an object.`);
      }

      requireNonEmptyString(risk.id, `[${rLabel}] Missing or invalid id.`);
      if (riskIds.has(risk.id)) throw new Error(`[${rLabel}] Duplicate risk id '${risk.id}'.`);
      riskIds.add(risk.id);
      requireNonEmptyString(risk.title, `[${rLabel}] Missing or invalid title.`);

      if (!appConfig.categories.includes(risk.category)) {
        throw new Error(`[${rLabel}] Invalid category '${risk.category}'. Expected one of: ${appConfig.categories.join(', ')}`);
      }
      if (!appConfig.severities.includes(risk.severity)) {
        throw new Error(`[${rLabel}] Invalid severity '${risk.severity}'. Expected one of: ${appConfig.severities.join(', ')}`);
      }
      if (typeof risk.confidence !== 'number' || !Number.isFinite(risk.confidence) || risk.confidence < 0 || risk.confidence > 1) {
        throw new Error(`[${rLabel}] Invalid confidence '${risk.confidence}'. Must be a number between 0.0 and 1.0.`);
      }

      if (!Array.isArray(risk.evidence) || risk.evidence.length === 0) {
        throw new Error(`[${rLabel}] Missing supporting evidence. Each risk must have at least one evidence reference.`);
      }
      risk.evidence.forEach((evidence, evIdx) => {
        if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
          throw new Error(`[${rLabel}] Evidence #${evIdx + 1} must be an object.`);
        }
        requireNonEmptyString(evidence.excerpt, `[${rLabel}] Evidence #${evIdx + 1} has a missing or empty excerpt.`);
        requireNonEmptyString(evidence.sourceReference, `[${rLabel}] Evidence #${evIdx + 1} has a missing or empty sourceReference.`);
      });

      const stringFields = [
        'businessImpact',
        'reasoning',
        'recommendedAction',
        'requiredDecision',
        'suggestedOwner',
        'ownerStatus',
        'status'
      ];
      stringFields.forEach((field) => {
        requireNonEmptyString(risk[field], `[${rLabel}] Missing or invalid string property: ${field}`);
      });

      if (!OWNER_STATUSES.includes(risk.ownerStatus)) {
        throw new Error(`[${rLabel}] Invalid ownerStatus '${risk.ownerStatus}'. Expected one of: ${OWNER_STATUSES.join(', ')}`);
      }
      if (!RISK_STATUSES.includes(risk.status)) {
        throw new Error(`[${rLabel}] Invalid status: '${risk.status}'. Expected ${RISK_STATUSES.join(', ')}.`);
      }
      if (risk.validationQuestion !== undefined) {
        requireNonEmptyString(risk.validationQuestion, `[${rLabel}] validationQuestion must be a non-empty string when provided.`);
      }

      if (risk.status === 'resolved') {
        if (risk.ownerStatus !== 'confirmed') {
          throw new Error(`[${rLabel}] Resolved risk must have a confirmed owner.`);
        }
        requireNonEmptyString(risk.resolutionNote, `[${rLabel}] Resolved risk must have a non-empty resolutionNote.`);
        if (typeof risk.resolvedAt !== 'string' || risk.resolvedAt.trim() === '' || Number.isNaN(Date.parse(risk.resolvedAt))) {
          throw new Error(`[${rLabel}] Resolved risk must have a valid non-empty resolvedAt timestamp.`);
        }
      }
    });

    if (!Array.isArray(data.stakeholders)) {
      throw new Error('Analysis response must contain a stakeholders array.');
    }
    data.stakeholders.forEach((stakeholder, idx) => {
      const label = stakeholder && stakeholder.name ? stakeholder.name : `Stakeholder #${idx + 1}`;
      requireNonEmptyString(stakeholder && stakeholder.name, `Stakeholder #${idx + 1} is missing a name.`);
      requireNonEmptyString(stakeholder.role, `Stakeholder '${label}' is missing a role.`);
      requireStringArray(stakeholder.goals, `Stakeholder '${label}' is missing a valid goals array.`);
      requireStringArray(stakeholder.conflicts, `Stakeholder '${label}' is missing a valid conflicts array.`);
      requireNonEmptyString(stakeholder.authority, `Stakeholder '${label}' is missing an authority description.`);
    });

    if (!Array.isArray(data.dependencies)) {
      throw new Error('Analysis response must contain a dependencies array.');
    }
    data.dependencies.forEach((dependency, idx) => {
      const label = dependency && dependency.name ? dependency.name : `Dependency #${idx + 1}`;
      requireNonEmptyString(dependency && dependency.name, `Dependency #${idx + 1} is missing a name.`);
      if (!DEPENDENCY_TYPES.includes(dependency.type)) {
        throw new Error(`Dependency '${label}' has an invalid type '${dependency.type}'.`);
      }
      requireNonEmptyString(dependency.description, `Dependency '${label}' is missing a description.`);
      if (!['missing', 'resolved'].includes(dependency.status)) {
        throw new Error(`Dependency '${label}' has an invalid status '${dependency.status}'.`);
      }
    });

    if (!Array.isArray(data.decisions)) {
      throw new Error('Analysis response must contain a decisions array.');
    }
    const decisionIds = new Set();
    data.decisions.forEach((decision, idx) => {
      requireNonEmptyString(decision && decision.id, `Decision #${idx + 1} is missing an id.`);
      if (decisionIds.has(decision.id)) throw new Error(`Decision #${idx + 1} has duplicate id '${decision.id}'.`);
      decisionIds.add(decision.id);
      requireNonEmptyString(decision.decision, `Decision '${decision.id}' is missing a decision statement.`);
      requireStringArray(decision.relatedRisks, `Decision '${decision.id}' is missing a valid relatedRisks array.`);
      requireNonEmptyString(decision.suggestedOwner, `Decision '${decision.id}' is missing a suggestedOwner.`);
      requireNonEmptyString(decision.consequence, `Decision '${decision.id}' is missing a consequence description.`);
    });

    if (!Array.isArray(data.validationQuestions)) {
      throw new Error('Analysis response must contain a validationQuestions array.');
    }
    data.validationQuestions.forEach((question, idx) => {
      if (!question || !QUESTION_CATEGORIES.includes(question.category)) {
        throw new Error(`Validation Question #${idx + 1} has an invalid category '${question && question.category}'.`);
      }
      requireNonEmptyString(question.question, `Validation Question #${idx + 1} is missing a question string.`);
    });

    if (!Array.isArray(data.rolloutRecommendations)) {
      throw new Error('Analysis response must contain a rolloutRecommendations array.');
    }
    data.rolloutRecommendations.forEach((recommendation, idx) => {
      if (!recommendation || !ROLLOUT_PHASES.includes(recommendation.phase)) {
        throw new Error(`Rollout Recommendation #${idx + 1} has an invalid phase '${recommendation && recommendation.phase}'.`);
      }
      requireNonEmptyString(recommendation.action, `Rollout Recommendation #${idx + 1} is missing an action.`);
      requireNonEmptyString(recommendation.owner, `Rollout Recommendation #${idx + 1} is missing an owner.`);
    });

    return true;
  }
};

if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
  module.exports = ValidationEngine;
} else {
  window.ValidationEngine = ValidationEngine;
}
