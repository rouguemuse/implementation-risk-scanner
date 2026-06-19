const assert = require('assert');
const path = require('path');
const config = require(path.resolve(__dirname, '..', 'config.json'));
const ScoringEngine = require('../lib/scoring');
const ValidationEngine = require('../lib/validation');

console.log('=== RUNNING PHASE 3 REVIEWER WORKFLOW TESTS ===\n');

function makeRisk(overrides = {}) {
  return {
    id: 'risk-review-1',
    tempId: 'risk-review-1',
    title: 'Reviewer workflow test risk',
    category: 'dependency_risk',
    evidence: [{ excerpt: 'Required dependency remains unavailable.', sourceReference: 'Plan section 2' }],
    evidenceType: 'explicit',
    implementationImpact: 'Launch may fail.',
    requiredClarificationOrAction: 'Confirm the dependency.',
    affectedStakeholders: ['Implementation Lead'],
    relatedDependencyIds: [],
    conditionCodes: ['launch_dependency_failed'],
    affectedScope: 'core',
    affectedStage: 'launch',
    suggestedSeverity: 'low',
    finalSeverity: 'critical',
    accountabilityStatus: 'confirmed',
    suggestedBlocksProgression: false,
    suggestedBlocksLaunch: false,
    suggestedBlockerReason: 'A launch dependency failed.',
    confidence: 0.9,
    confidenceReason: 'Directly stated in the plan.',
    status: 'open',
    ownerStatus: 'confirmed',
    suggestedOwner: 'Implementation Lead',
    ...overrides
  };
}

function makeAnalysis(risk) {
  return {
    summary: 'Reviewer workflow test.',
    topBlockers: ['Dependency failure'],
    risks: [risk],
    stakeholders: [{
      name: 'Implementation Lead',
      role: 'Owner',
      goals: [],
      conflicts: [],
      authority: 'Final implementation authority'
    }],
    dependencies: [],
    decisions: [],
    validationQuestions: [],
    rolloutRecommendations: []
  };
}

{
  const risk = makeRisk({
    finalSeverity: 'low',
    conditionCodes: [],
    affectedScope: 'peripheral',
    affectedStage: 'discovery',
    severityOverride: 'critical'
  });
  const assessment = ScoringEngine.getRiskAssessment(risk);
  const result = ScoringEngine.calculateScore(makeAnalysis(risk), config);
  assert.strictEqual(assessment.calculatedSeverity, 'low');
  assert.strictEqual(assessment.finalSeverity, 'critical');
  assert.strictEqual(assessment.severityOverrideApplied, true);
  assert.strictEqual(result.calculatedScore, 85);
  console.log('✅ severityOverride changes effective severity and penalty');
}

{
  const risk = makeRisk({
    finalSeverity: 'low',
    conditionCodes: [],
    affectedScope: 'peripheral',
    affectedStage: 'discovery',
    blocksLaunchOverride: true
  });
  const result = ScoringEngine.calculateScore(makeAnalysis(risk), config);
  assert.strictEqual(result.gateCap, 49);
  assert.strictEqual(result.finalScore, 49);
  console.log('✅ blocksLaunchOverride=true activates the launch cap');
}

{
  const risk = makeRisk({ blocksLaunchOverride: false });
  const assessment = ScoringEngine.getRiskAssessment(risk);
  const result = ScoringEngine.calculateScore(makeAnalysis(risk), config);
  assert.strictEqual(assessment.calculatedBlocksLaunch, true);
  assert.strictEqual(assessment.blocksLaunch, false);
  assert.strictEqual(result.gateCap, 69);
  console.log('✅ blocksLaunchOverride=false clears the launch cap while progression remains blocked');
}

{
  const risk = makeRisk({
    finalSeverity: 'low',
    conditionCodes: [],
    affectedScope: 'peripheral',
    affectedStage: 'discovery',
    blocksProgressionOverride: true
  });
  const result = ScoringEngine.calculateScore(makeAnalysis(risk), config);
  assert.strictEqual(result.gateCap, 69);
  console.log('✅ blocksProgressionOverride=true activates the progression cap');
}

{
  const risk = makeRisk({
    finalSeverity: 'high',
    conditionCodes: ['launch_dependency_unconfirmed'],
    blocksProgressionOverride: false
  });
  const assessment = ScoringEngine.getRiskAssessment(risk);
  const result = ScoringEngine.calculateScore(makeAnalysis(risk), config);
  assert.strictEqual(assessment.calculatedBlocksProgression, true);
  assert.strictEqual(assessment.blocksProgression, false);
  assert.strictEqual(result.gateCap, 100);
  console.log('✅ blocksProgressionOverride=false clears the progression cap');
}

{
  const risk = makeRisk({
    status: 'resolved',
    resolutionNote: 'Dependency supplied and verified.',
    resolvedAt: new Date().toISOString(),
    blocksLaunchOverride: true,
    blocksProgressionOverride: true
  });
  const assessment = ScoringEngine.getRiskAssessment(risk);
  assert.strictEqual(assessment.blocksLaunch, false);
  assert.strictEqual(assessment.blocksProgression, false);
  console.log('✅ valid resolution clears gates even when stale override fields exist');
}

{
  const valid = makeAnalysis(makeRisk({
    severityOverride: 'high',
    blocksLaunchOverride: false,
    blocksProgressionOverride: true,
    targetDate: '2026-07-15',
    overrideReason: 'Customer approved a controlled pilot.',
    overrideUpdatedAt: new Date().toISOString()
  }));
  assert.strictEqual(ValidationEngine.validateDomainSchema(valid, config), true);

  const invalidSeverity = makeAnalysis(makeRisk({ severityOverride: 'catastrophic' }));
  assert.throws(
    () => ValidationEngine.validateDomainSchema(invalidSeverity, config),
    /severityOverride/
  );

  const invalidBoolean = makeAnalysis(makeRisk({ blocksLaunchOverride: 'false' }));
  assert.throws(
    () => ValidationEngine.validateDomainSchema(invalidBoolean, config),
    /blocksLaunchOverride/
  );
  console.log('✅ reviewer override fields are independently validated');
}

{
  const result = makeAnalysis(makeRisk({ targetDate: '2026-07-15' }));
  const envelope = {
    exportFormat: 'risk-scan-registry',
    exportVersion: 1,
    exportedAt: new Date().toISOString(),
    projectName: 'Test project',
    analysisProfile: 'general',
    sourceText: 'Test source',
    result
  };
  const imported = ValidationEngine.normalizeRegistryImport(envelope, config);
  assert.strictEqual(imported.result.risks[0].targetDate, '2026-07-15');
  assert.strictEqual(imported.metadata.projectName, 'Test project');

  assert.throws(
    () => ValidationEngine.normalizeRegistryImport({ ...envelope, exportVersion: 99 }, config),
    /Unsupported registry export version/
  );
  console.log('✅ registry imports require a supported envelope and valid domain state');
}

console.log('\n🌟 PHASE 3 REVIEWER WORKFLOW TESTS PASSED');
