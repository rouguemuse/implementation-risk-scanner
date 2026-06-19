const LAUNCH_BLOCKING_CODES = new Set([
  'required_approval_missing', 'workflow_owner_missing', 'launch_dependency_failed',
  'essential_data_unavailable', 'integration_feasibility_unknown', 'core_requirements_conflict',
  'support_model_missing'
]);

const PROGRESSION_BLOCKING_CODES = new Set([
  'required_approval_missing', 'workflow_owner_missing', 'launch_dependency_failed',
  'essential_data_unavailable', 'integration_feasibility_unknown', 'core_requirements_conflict',
  'support_model_missing', 'launch_dependency_unconfirmed', 'customer_milestone_unconfirmed',
  'acceptance_criteria_missing', 'implementation_sequence_invalid', 'training_plan_missing'
]);

const VALID_SEVERITIES = new Set(['critical', 'high', 'medium', 'low']);

const ScoringEngine = {
  calculateCalculatedSeverity(risk) {
    const codes = new Set((risk && risk.conditionCodes) || []);
    const scope = risk && risk.affectedScope;
    const stage = risk && risk.affectedStage;

    if (scope === 'core') {
      if (codes.has('required_approval_missing') && stage === 'launch') return 'critical';
      if (codes.has('workflow_owner_missing') && (stage === 'launch' || stage === 'post_launch')) return 'critical';
      if (codes.has('launch_dependency_failed') && stage === 'launch') return 'critical';
      if (codes.has('essential_data_unavailable')) return 'critical';
      if (codes.has('integration_feasibility_unknown')) return 'critical';
      if (codes.has('core_requirements_conflict')) return 'critical';
      if (codes.has('support_model_missing') && stage === 'launch') return 'critical';
    }

    if (scope === 'core') return 'high';

    let hasProgressionCode = false;
    for (const code of codes) {
      if (PROGRESSION_BLOCKING_CODES.has(code)) {
        hasProgressionCode = true;
        break;
      }
    }
    if (scope === 'supporting' && hasProgressionCode) return 'high';
    if (scope === 'supporting') return 'medium';

    const secondaryCodes = new Set([
      'change_communication_missing', 'adoption_measurement_missing',
      'escalation_path_missing', 'monitoring_plan_missing',
      'rollback_plan_missing', 'success_criteria_missing'
    ]);
    let hasSecondaryCode = false;
    for (const code of codes) {
      if (secondaryCodes.has(code)) {
        hasSecondaryCode = true;
        break;
      }
    }
    if (scope === 'peripheral' && (hasProgressionCode || hasSecondaryCode)) return 'medium';
    return 'low';
  },

  getCalculatedSeverity(risk) {
    if (risk && VALID_SEVERITIES.has(risk.finalSeverity)) {
      return risk.finalSeverity;
    }
    return this.calculateCalculatedSeverity(risk || {});
  },

  calculateFinalSeverity(risk) {
    const calculatedSeverity = this.getCalculatedSeverity(risk);
    if (risk && VALID_SEVERITIES.has(risk.severityOverride)) {
      return risk.severityOverride;
    }
    return calculatedSeverity;
  },

  calculateBlockers(risk, finalSeverity) {
    const codes = new Set((risk && risk.conditionCodes) || []);
    const unresolved = !this.isValidResolution(risk);

    let hasLaunchBlockingCode = false;
    for (const code of codes) {
      if (LAUNCH_BLOCKING_CODES.has(code)) {
        hasLaunchBlockingCode = true;
        break;
      }
    }

    let hasProgressionBlockingCode = false;
    for (const code of codes) {
      if (PROGRESSION_BLOCKING_CODES.has(code)) {
        hasProgressionBlockingCode = true;
        break;
      }
    }

    const calculatedBlocksLaunch =
      unresolved && finalSeverity === 'critical' && hasLaunchBlockingCode;
    const calculatedBlocksProgression =
      unresolved && hasProgressionBlockingCode;

    // A valid resolution always clears gates. Overrides are reviewer judgments for active risks,
    // not a way to keep a fully resolved item blocked.
    const blocksLaunch = unresolved && typeof risk.blocksLaunchOverride === 'boolean'
      ? risk.blocksLaunchOverride
      : calculatedBlocksLaunch;
    const blocksProgression = unresolved && typeof risk.blocksProgressionOverride === 'boolean'
      ? risk.blocksProgressionOverride
      : calculatedBlocksProgression;

    return {
      calculatedBlocksLaunch,
      calculatedBlocksProgression,
      blocksLaunch,
      blocksProgression,
      launchOverrideApplied: unresolved && typeof risk.blocksLaunchOverride === 'boolean',
      progressionOverrideApplied: unresolved && typeof risk.blocksProgressionOverride === 'boolean'
    };
  },

  getRiskAssessment(risk) {
    const calculatedSeverity = this.getCalculatedSeverity(risk);
    const finalSeverity = this.calculateFinalSeverity(risk);
    const blockers = this.calculateBlockers(risk, finalSeverity);
    return {
      calculatedSeverity,
      finalSeverity,
      severityOverrideApplied: VALID_SEVERITIES.has(risk && risk.severityOverride),
      ...blockers
    };
  },

  isValidResolution(risk) {
    return (
      risk &&
      risk.status === 'resolved' &&
      risk.ownerStatus === 'confirmed' &&
      typeof risk.resolutionNote === 'string' &&
      risk.resolutionNote.trim().length > 0 &&
      typeof risk.resolvedAt === 'string' &&
      !Number.isNaN(Date.parse(risk.resolvedAt))
    );
  },

  calculateScore(data, config) {
    if (!data || !config) {
      return {
        calculatedScore: 100,
        gateCap: 100,
        gateAdjustment: 0,
        finalScore: 100,
        gateReason: '',
        classification: { label: 'Ready with minor controls', class: 'ready' },
        penaltiesList: [],
        riskAssessments: {}
      };
    }

    let score = config.baseScore || 100;
    const penaltiesList = [];
    const riskAssessments = {};

    if (Array.isArray(data.risks)) {
      data.risks.forEach((risk, index) => {
        if (!risk.evidence || risk.evidence.length === 0) return;

        const assessment = ScoringEngine.getRiskAssessment(risk);
        const riskKey = risk.id || risk.tempId || `risk-${index + 1}`;
        riskAssessments[riskKey] = assessment;

        const severityWeight = config.penalties.severity[assessment.finalSeverity] || 0;
        let appliedWeight = severityWeight;
        let statusLabel = assessment.severityOverrideApplied
          ? `Open · Severity overridden from ${assessment.calculatedSeverity}`
          : 'Open';

        if (risk.status === 'resolved') {
          if (ScoringEngine.isValidResolution(risk)) {
            appliedWeight = 0;
            statusLabel = 'Resolved';
          } else {
            statusLabel = 'Resolved (Incomplete)';
          }
        } else if (risk.status === 'accepted') {
          appliedWeight = severityWeight * config.residualPenaltyMultiplier;
          statusLabel = assessment.severityOverrideApplied
            ? `Accepted (Residual) · Severity overridden from ${assessment.calculatedSeverity}`
            : 'Accepted (Residual)';
        } else if (risk.status === 'mitigating') {
          statusLabel = assessment.severityOverrideApplied
            ? `Mitigating · Severity overridden from ${assessment.calculatedSeverity}`
            : 'Mitigating';
        }

        if (appliedWeight > 0) {
          score -= appliedWeight;
          penaltiesList.push({
            factor: `Risk: ${risk.title}`,
            basePenalty: `-${severityWeight}`,
            status: statusLabel,
            current: `-${appliedWeight}`
          });
        }

        if (!ScoringEngine.isValidResolution(risk) && risk.ownerStatus !== 'confirmed') {
          score -= config.penalties.unconfirmedOwner;
          penaltiesList.push({
            factor: `Missing Owner: ${risk.title}`,
            basePenalty: `-${config.penalties.unconfirmedOwner}`,
            status: 'Unconfirmed',
            current: `-${config.penalties.unconfirmedOwner}`
          });
        }

        if (risk.category === 'success_measurement_gap' && !ScoringEngine.isValidResolution(risk)) {
          score -= config.penalties.undefinedMetric;
          penaltiesList.push({
            factor: `Metric Gap: ${risk.title}`,
            basePenalty: `-${config.penalties.undefinedMetric}`,
            status: risk.status === 'accepted' ? 'Accepted' : 'Open',
            current: `-${config.penalties.undefinedMetric}`
          });
        }

        if (risk.category === 'decision_gap' && !ScoringEngine.isValidResolution(risk)) {
          score -= config.penalties.unresolvedStakeholderConflict;
          penaltiesList.push({
            factor: `Decision Gap: ${risk.title}`,
            basePenalty: `-${config.penalties.unresolvedStakeholderConflict}`,
            status: risk.status === 'accepted' ? 'Accepted' : 'Open',
            current: `-${config.penalties.unresolvedStakeholderConflict}`
          });
        }
      });
    }

    if (Array.isArray(data.dependencies)) {
      const uniqueMissingDependencies = new Map();
      data.dependencies
        .filter(dep => dep.status === 'missing')
        .forEach(dep => uniqueMissingDependencies.set(dep.id || dep.name, dep));

      uniqueMissingDependencies.forEach(dep => {
        score -= config.penalties.missingDependency;
        penaltiesList.push({
          factor: `Dependency Missing: ${dep.name}`,
          basePenalty: `-${config.penalties.missingDependency}`,
          status: 'Missing',
          current: `-${config.penalties.missingDependency}`
        });
      });
    }

    const calculatedScore = Math.max(0, Math.min(100, parseFloat(score.toFixed(1))));
    let gateCap = 100;
    let gateReason = '';

    if (Array.isArray(data.risks)) {
      const unresolvedRisks = data.risks.filter(risk => !ScoringEngine.isValidResolution(risk));

      const launchBlockers = unresolvedRisks.filter(risk => {
        const assessment = ScoringEngine.getRiskAssessment(risk);
        return assessment.blocksLaunch;
      });
      const progressionBlockers = unresolvedRisks.filter(risk => {
        const assessment = ScoringEngine.getRiskAssessment(risk);
        return assessment.blocksProgression;
      });

      if (launchBlockers.length > 0) {
        gateCap = 49;
        gateReason = 'An unresolved launch blocker blocks production launch.';
      } else if (progressionBlockers.length > 0) {
        gateCap = 69;
        gateReason = 'An unresolved progression blocker blocks implementation progress.';
      }
    }

    const finalScore = Math.min(calculatedScore, gateCap);
    const gateAdjustment = parseFloat((calculatedScore - finalScore).toFixed(1));

    let classification = config.classifications
      ? config.classifications[3]
      : { label: 'High implementation risk', class: 'risk' };
    if (config.classifications) {
      for (const candidate of config.classifications) {
        if (finalScore >= candidate.min && finalScore <= candidate.max) {
          classification = candidate;
          break;
        }
      }
    }

    return {
      calculatedScore,
      gateCap,
      gateAdjustment,
      finalScore,
      gateReason,
      classification,
      penaltiesList,
      riskAssessments
    };
  }
};

if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
  module.exports = ScoringEngine;
} else {
  window.ScoringEngine = ScoringEngine;
}
