const GEMINI_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      description: "Concise summary of overall implementation readiness findings."
    },
    topBlockers: {
      type: "array",
      items: { type: "string" },
      description: "List of the most critical launch blockers identified."
    },
    risks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          tempId: { type: "string" },
          category: {
            type: "string",
            enum: [
              "missing_owner", "unclear_requirement", "timeline_risk", "dependency_risk",
              "adoption_risk", "operational_readiness_gap", "handoff_risk", "success_measurement_gap",
              "decision_gap"
            ]
          },
          title: { type: "string" },
          evidence: {
            type: "array",
            items: {
              type: "object",
              properties: {
                excerpt: { type: "string" },
                sourceReference: { type: "string" }
              },
              required: ["excerpt", "sourceReference"]
            }
          },
          evidenceType: {
            type: "string",
            enum: ["explicit", "inferred", "missing_information"]
          },
          missingElement: { type: "string" },
          reviewedContext: { type: "string" },
          implementationImpact: { type: "string" },
          requiredClarificationOrAction: { type: "string" },
          affectedStakeholders: { type: "array", items: { type: "string" } },
          relatedDependencyIds: { type: "array", items: { type: "string" } },
          conditionCodes: {
            type: "array",
            items: {
              type: "string",
              enum: [
                "required_approval_missing", "workflow_owner_missing", "launch_dependency_unconfirmed",
                "launch_dependency_failed", "essential_data_unavailable", "integration_feasibility_unknown",
                "core_requirements_conflict", "acceptance_criteria_missing", "implementation_sequence_invalid",
                "customer_milestone_unconfirmed", "training_plan_missing", "change_communication_missing",
                "adoption_measurement_missing", "post_launch_owner_missing", "support_model_missing",
                "escalation_path_missing", "monitoring_plan_missing", "rollback_plan_missing",
                "success_criteria_missing"
              ]
            }
          },
          affectedScope: {
            type: "string",
            enum: ["core", "supporting", "peripheral"]
          },
          affectedStage: {
            type: "string",
            enum: ["discovery", "configuration", "validation", "training", "launch", "post_launch"]
          },
          suggestedSeverity: {
            type: "string",
            enum: ["critical", "high", "medium", "low"]
          },
          accountabilityStatus: {
            type: "string",
            enum: ["confirmed", "ambiguous", "missing", "not_applicable"]
          },
          suggestedBlocksProgression: { type: "boolean" },
          suggestedBlocksLaunch: { type: "boolean" },
          suggestedBlockerReason: { type: "string" },
          confidence: { type: "number" },
          confidenceReason: { type: "string" }
        },
        required: [
          "tempId", "category", "title", "evidence", "evidenceType",
          "implementationImpact", "requiredClarificationOrAction", "affectedStakeholders",
          "relatedDependencyIds", "conditionCodes", "affectedScope", "affectedStage",
          "suggestedSeverity", "accountabilityStatus", "suggestedBlocksProgression",
          "suggestedBlocksLaunch", "suggestedBlockerReason", "confidence", "confidenceReason"
        ]
      }
    },
    stakeholders: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          role: { type: "string" },
          goals: { type: "array", items: { type: "string" } },
          conflicts: { type: "array", items: { type: "string" } },
          authority: { type: "string" }
        },
        required: ["name", "role", "goals", "conflicts", "authority"]
      }
    },
    dependencies: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          type: {
            type: "string",
            enum: ["data", "technical", "configuration", "people", "policy", "data-dependency", "configuration-dependency", "technical-dependency", "people-dependency", "policy-dependency"]
          },
          description: { type: "string" },
          status: {
            type: "string",
            enum: ["missing", "resolved"]
          }
        },
        required: ["name", "type", "description", "status"]
      }
    },
    decisions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          decision: { type: "string" },
          relatedRisks: { type: "array", items: { type: "string" } },
          suggestedOwner: { type: "string" },
          consequence: { type: "string" }
        },
        required: ["id", "decision", "relatedRisks", "suggestedOwner", "consequence"]
      }
    },
    validationQuestions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          category: {
            type: "string",
            enum: ["scope", "workflow", "ownership", "data", "configuration", "security", "success", "rollout"]
          },
          question: { type: "string" }
        },
        required: ["category", "question"]
      }
    },
    rolloutRecommendations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          phase: {
            type: "string",
            enum: ["30-day", "60-day", "90-day"]
          },
          action: { type: "string" },
          owner: { type: "string" }
        },
        required: ["phase", "action", "owner"]
      }
    }
  },
  required: [
    "summary", "topBlockers", "risks", "stakeholders", "dependencies",
    "decisions", "validationQuestions", "rolloutRecommendations"
  ]
};

if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
  module.exports = { GEMINI_RESPONSE_SCHEMA };
} else {
  window.GEMINI_RESPONSE_SCHEMA = GEMINI_RESPONSE_SCHEMA;
}
