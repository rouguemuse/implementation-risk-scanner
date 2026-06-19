'use strict';

const ValidationEngine = require('./validation');
const SCHEMA_VERSION = '2026-06-19.v1';
const {
  OWNER_STATUSES,
  RISK_STATUSES,
  DEPENDENCY_TYPES,
  QUESTION_CATEGORIES,
  ROLLOUT_PHASES
} = ValidationEngine;

function stringSchema(description) {
  return { type: 'string', description };
}

function createAnalysisResponseSchema(appConfig) {
  if (!appConfig || !Array.isArray(appConfig.categories) || !Array.isArray(appConfig.severities)) {
    throw new Error('Application configuration must provide categories and severities.');
  }

  return {
    $id: `https://contextmuse.com/schemas/implementation-risk-analysis/${SCHEMA_VERSION}`,
    type: 'object',
    additionalProperties: false,
    required: [
      'summary',
      'topBlockers',
      'risks',
      'stakeholders',
      'dependencies',
      'decisions',
      'validationQuestions',
      'rolloutRecommendations'
    ],
    properties: {
      summary: stringSchema('Concise implementation-readiness summary grounded in the supplied material.'),
      topBlockers: {
        type: 'array',
        maxItems: 5,
        items: stringSchema('A specific unresolved condition most likely to block delivery, adoption, support, or launch.')
      },
      risks: {
        type: 'array',
        maxItems: 20,
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'id', 'title', 'category', 'severity', 'confidence', 'evidence',
            'businessImpact', 'reasoning', 'recommendedAction', 'requiredDecision',
            'suggestedOwner', 'ownerStatus', 'status'
          ],
          properties: {
            id: stringSchema('Stable identifier such as risk-001.'),
            title: stringSchema('Specific, non-duplicative finding title.'),
            category: { type: 'string', enum: appConfig.categories, description: 'Application-defined risk category.' },
            severity: { type: 'string', enum: appConfig.severities, description: 'Evidence-based operational severity. Do not inflate severity.' },
            confidence: { type: 'number', minimum: 0, maximum: 1, description: 'Confidence that the finding is supported by the supplied material.' },
            evidence: {
              type: 'array',
              minItems: 1,
              maxItems: 3,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['excerpt', 'sourceReference'],
                properties: {
                  excerpt: stringSchema('Short exact excerpt or concise description of missing evidence.'),
                  sourceReference: stringSchema('Section, paragraph, heading, or supplied-material reference.')
                }
              }
            },
            businessImpact: stringSchema('Likely operational consequence if the risk remains unresolved.'),
            reasoning: stringSchema('Why the evidence supports the finding, distinguishing facts from inference.'),
            recommendedAction: stringSchema('Concrete corrective action or control.'),
            requiredDecision: stringSchema('Decision or clarification required to close or control the risk.'),
            suggestedOwner: stringSchema('Explicit owner from the source or a clearly labeled suggested accountable role.'),
            ownerStatus: { type: 'string', enum: OWNER_STATUSES, description: 'Whether accountable ownership is confirmed, unclear, shared, tentative, or missing.' },
            validationQuestion: stringSchema('Focused question that would validate or resolve the finding.'),
            status: { type: 'string', enum: RISK_STATUSES, description: 'Current application risk status. Default unresolved findings to open.' },
            resolutionNote: stringSchema('Required only when status is resolved.'),
            resolvedAt: { type: 'string', format: 'date-time', description: 'Resolution timestamp required only when status is resolved.' }
          }
        }
      },
      stakeholders: {
        type: 'array',
        maxItems: 20,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'role', 'goals', 'conflicts', 'authority'],
          properties: {
            name: stringSchema('Stakeholder name or group explicitly supported by the source.'),
            role: stringSchema('Role in the implementation.'),
            goals: { type: 'array', items: stringSchema('Explicitly supported implementation goal.') },
            conflicts: { type: 'array', items: stringSchema('Conflict, tension, or competing requirement.') },
            authority: stringSchema('Known authority or clearly stated uncertainty about authority.')
          }
        }
      },
      dependencies: {
        type: 'array',
        maxItems: 20,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'type', 'description', 'status'],
          properties: {
            name: stringSchema('Specific dependency name.'),
            type: { type: 'string', enum: DEPENDENCY_TYPES },
            description: stringSchema('Why the dependency matters and what remains required.'),
            status: { type: 'string', enum: ['missing', 'resolved'] }
          }
        }
      },
      decisions: {
        type: 'array',
        maxItems: 20,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'decision', 'relatedRisks', 'suggestedOwner', 'consequence'],
          properties: {
            id: stringSchema('Stable identifier such as dec-001.'),
            decision: stringSchema('Specific decision needed.'),
            relatedRisks: { type: 'array', items: stringSchema('Related risk identifier.') },
            suggestedOwner: stringSchema('Explicit owner or clearly labeled suggested accountable role.'),
            consequence: stringSchema('Consequence of leaving the decision unresolved.')
          }
        }
      },
      validationQuestions: {
        type: 'array',
        maxItems: 20,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['category', 'question'],
          properties: {
            category: { type: 'string', enum: QUESTION_CATEGORIES },
            question: stringSchema('Focused question that would validate readiness or resolve uncertainty.')
          }
        }
      },
      rolloutRecommendations: {
        type: 'array',
        maxItems: 12,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['phase', 'action', 'owner'],
          properties: {
            phase: { type: 'string', enum: ROLLOUT_PHASES },
            action: stringSchema('Concrete readiness or risk-control action.'),
            owner: stringSchema('Explicit owner or clearly labeled suggested accountable role.')
          }
        }
      }
    }
  };
}

module.exports = {
  SCHEMA_VERSION,
  OWNER_STATUSES,
  RISK_STATUSES,
  DEPENDENCY_TYPES,
  QUESTION_CATEGORIES,
  ROLLOUT_PHASES,
  createAnalysisResponseSchema
};
