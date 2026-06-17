const ScoringEngine = {
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

    // 1. Severity & Owner & Specific Gaps Penalties
    if (Array.isArray(data.risks)) {
      data.risks.forEach(risk => {
        // Finding must have evidence to be scored
        if (!risk.evidence || risk.evidence.length === 0) return;

        const severityWeight = config.penalties.severity[risk.severity] || 0;
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
          // Retain residual penalty - no rounding to keep low severity accepted penalty at 0.5
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

        // 2. Missing Confirmed Owner Penalty (Only for unresolved risks or invalid-resolved risks)
        if (!ScoringEngine.isValidResolution(risk) && risk.ownerStatus !== 'confirmed') {
          score -= config.penalties.unconfirmedOwner;
          penaltiesList.push({
            factor: `Missing Owner: ${risk.title}`,
            basePenalty: `-${config.penalties.unconfirmedOwner}`,
            status: 'Unconfirmed',
            current: `-${config.penalties.unconfirmedOwner}`
          });
        }

        // 3. Undefined Metric Penalty
        if (risk.category === 'undefined-metrics' && !ScoringEngine.isValidResolution(risk)) {
          score -= config.penalties.undefinedMetric;
          penaltiesList.push({
            factor: `Metric Gap: ${risk.title}`,
            basePenalty: `-${config.penalties.undefinedMetric}`,
            status: risk.status === 'accepted' ? 'Accepted' : 'Open',
            current: `-${config.penalties.undefinedMetric}`
          });
        }

        // 4. Unresolved Stakeholder Conflict Penalty
        if (risk.category === 'stakeholder-conflict' && !ScoringEngine.isValidResolution(risk)) {
          score -= config.penalties.unresolvedStakeholderConflict;
          penaltiesList.push({
            factor: `Conflict: ${risk.title}`,
            basePenalty: `-${config.penalties.unresolvedStakeholderConflict}`,
            status: risk.status === 'accepted' ? 'Accepted' : 'Open',
            current: `-${config.penalties.unresolvedStakeholderConflict}`
          });
        }
      });
    }

    // 5. Missing Dependency Penalty (Deduplicated by ID or Name)
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

    // Calculated score before readiness gates
    const calculatedScore = Math.max(0, Math.min(100, parseFloat(score.toFixed(1))));

    // 6. Blocker Gates (Capping logic applies to any unresolved critical risk)
    let gateCap = 100;
    let gateReason = '';

    if (Array.isArray(data.risks)) {
      const unresolvedCritical = data.risks.filter(
        risk => risk.severity === 'critical' && !ScoringEngine.isValidResolution(risk)
      );

      const criticalWithoutOwner = unresolvedCritical.some(
        risk => risk.ownerStatus !== 'confirmed'
      );

      const criticalComplianceBlocker = unresolvedCritical.some(
        risk => risk.category === 'compliance-risk'
      );

      if (criticalWithoutOwner || criticalComplianceBlocker) {
        gateCap = 49;
        gateReason = "An unresolved critical blocker lacks ownership or involves compliance.";
      } else if (unresolvedCritical.length > 0) {
        gateCap = 69;
        gateReason = "At least one critical implementation risk remains unresolved.";
      }
    }

    const finalScore = Math.min(calculatedScore, gateCap);
    const gateAdjustment = parseFloat((calculatedScore - finalScore).toFixed(1));

    // Determine Classification based on Final Score
    let classification = config.classifications ? config.classifications[3] : { label: "High implementation risk", class: "risk" }; // Default
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
