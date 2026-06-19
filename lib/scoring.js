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

const ScoringEngine = {
  calculateFinalSeverity(risk) {
    const codes = new Set(risk.conditionCodes || []);
    const scope = risk.affectedScope;
    const stage = risk.affectedStage;

    // Rule-based critical checks (must have scope === 'core')
    if (scope === 'core') {
      if (codes.has('required_approval_missing') && stage === 'launch') {
        return 'critical';
      }
      if (codes.has('workflow_owner_missing') && (stage === 'launch' || stage === 'post_launch')) {
        return 'critical';
      }
      if (codes.has('launch_dependency_failed') && stage === 'launch') {
        return 'critical';
      }
      if (codes.has('essential_data_unavailable')) {
        return 'critical';
      }
      if (codes.has('integration_feasibility_unknown')) {
        return 'critical';
      }
      if (codes.has('core_requirements_conflict')) {
        return 'critical';
      }
      if (codes.has('support_model_missing') && stage === 'launch') {
        return 'critical';
      }
    }

    // High severity rules
    if (scope === 'core') {
      return 'high';
    }
    let hasProgressionCode = false;
    for (const c of codes) {
      if (PROGRESSION_BLOCKING_CODES.has(c)) {
        hasProgressionCode = true;
        break;
      }
    }
    if (scope === 'supporting' && hasProgressionCode) {
      return 'high';
    }

    // Medium severity rules
    if (scope === 'supporting') {
      return 'medium';
    }
    const secondaryCodes = [
      'change_communication_missing', 'adoption_measurement_missing',
      'escalation_path_missing', 'monitoring_plan_missing',
      'rollback_plan_missing', 'success_criteria_missing'
    ];
    let hasSecondaryCode = false;
    for (const c of codes) {
      if (secondaryCodes.includes(c)) {
        hasSecondaryCode = true;
        break;
      }
    }
    if (scope === 'peripheral' && (hasProgressionCode || hasSecondaryCode)) {
      return 'medium';
    }

    return 'low';
  },

  calculateBlockers(risk, finalSeverity) {
    const codes = new Set(risk.conditionCodes || []);
    const isBlocked = !this.isValidResolution(risk);

    // blocksLaunch logic (unresolved, critical final severity, and launch-blocking code)
    let hasLaunchBlockingCode = false;
    for (const c of codes) {
      if (LAUNCH_BLOCKING_CODES.has(c)) {
        hasLaunchBlockingCode = true;
        break;
      }
    }
    const blocksLaunch = isBlocked && finalSeverity === 'critical' && hasLaunchBlockingCode;

    // blocksProgression logic (unresolved, and progression-blocking code)
    let hasProgressionBlockingCode = false;
    for (const c of codes) {
      if (PROGRESSION_BLOCKING_CODES.has(c)) {
        hasProgressionBlockingCode = true;
        break;
      }
    }
    const blocksProgression = isBlocked && hasProgressionBlockingCode;

    return { blocksLaunch, blocksProgression };
  },

  isValidResolution(risk) {
    return (
      risk &&
      risk.status === "resolved" &&
      risk.ownerStatus === "confirmed" &&
      typeof risk.resolutionNote === "string" &&
      risk.resolutionNote.trim().length > 0 &&
      typeof risk.resolvedAt === "string" &&
      !Number.isNaN(Date.parse(risk.resolvedAt))
    );
  },

  calculateScore(data, config) {
    if (!data || !config) {
      return { calculatedScore: 100, gateCap: 100, gateAdjustment: 0, finalScore: 100, penaltiesList: [] };
    }

    let score = config.baseScore || 100;
    const penaltiesList = [];

    // Apply penalties based on risks
    if (Array.isArray(data.risks)) {
      data.risks.forEach(risk => {
        if (!risk.evidence || risk.evidence.length === 0) return;

        // Make sure severity/blocker calculations run if not pre-calculated
        const finalSeverity = risk.finalSeverity || ScoringEngine.calculateFinalSeverity(risk);
        const severityWeight = config.penalties.severity[finalSeverity] || 0;
        let appliedWeight = severityWeight;
        let statusLabel = 'Open';

        if (risk.status === 'resolved') {
          if (ScoringEngine.isValidResolution(risk)) {
            appliedWeight = 0;
            statusLabel = 'Resolved';
          } else {
            statusLabel = 'Resolved (Incomplete)';
            appliedWeight = severityWeight;
          }
        } else if (risk.status === 'accepted') {
          appliedWeight = severityWeight * config.residualPenaltyMultiplier;
          statusLabel = 'Accepted (Residual)';
        } else if (risk.status === 'mitigating') {
          statusLabel = 'Mitigating';
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

        // Missing Owner Penalty (Only for unresolved risks)
        if (!ScoringEngine.isValidResolution(risk) && risk.ownerStatus !== 'confirmed') {
          score -= config.penalties.unconfirmedOwner;
          penaltiesList.push({
            factor: `Missing Owner: ${risk.title}`,
            basePenalty: `-${config.penalties.unconfirmedOwner}`,
            status: 'Unconfirmed',
            current: `-${config.penalties.unconfirmedOwner}`
          });
        }

        // Undefined Metric / success_measurement_gap Penalty
        if (risk.category === 'success_measurement_gap' && !ScoringEngine.isValidResolution(risk)) {
          score -= config.penalties.undefinedMetric;
          penaltiesList.push({
            factor: `Metric Gap: ${risk.title}`,
            basePenalty: `-${config.penalties.undefinedMetric}`,
            status: risk.status === 'accepted' ? 'Accepted' : 'Open',
            current: `-${config.penalties.undefinedMetric}`
          });
        }

        // Unresolved Decision / decision_gap Penalty
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

    // Deduplicate and apply missing dependencies penalties
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

    // Blocker Gates Capping Logic
    let gateCap = 100;
    let gateReason = '';

    if (Array.isArray(data.risks)) {
      const unresolvedRisks = data.risks.filter(risk => !ScoringEngine.isValidResolution(risk));
      
      const launchBlockers = unresolvedRisks.filter(risk => {
        const finalSeverity = risk.finalSeverity || ScoringEngine.calculateFinalSeverity(risk);
        const { blocksLaunch } = ScoringEngine.calculateBlockers(risk, finalSeverity);
        return blocksLaunch;
      });

      const progressionBlockers = unresolvedRisks.filter(risk => {
        const finalSeverity = risk.finalSeverity || ScoringEngine.calculateFinalSeverity(risk);
        const { blocksProgression } = ScoringEngine.calculateBlockers(risk, finalSeverity);
        return blocksProgression;
      });

      if (launchBlockers.length > 0) {
        gateCap = 49;
        gateReason = "An unresolved critical blocker blocks production launch.";
      } else if (progressionBlockers.length > 0) {
        gateCap = 69;
        gateReason = "An unresolved progression blocker blocks implementation progress.";
      }
    }

    const finalScore = Math.min(calculatedScore, gateCap);
    const gateAdjustment = parseFloat((calculatedScore - finalScore).toFixed(1));

    let classification = config.classifications ? config.classifications[3] : { label: "High implementation risk", class: "risk" };
    if (config.classifications) {
      for (const c of config.classifications) {
        if (finalScore >= c.min && finalScore <= c.max) {
          classification = c;
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
      penaltiesList
    };
  }
};

if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
  module.exports = ScoringEngine;
} else {
  window.ScoringEngine = ScoringEngine;
}
