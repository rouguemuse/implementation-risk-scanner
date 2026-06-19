'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const config = require('../config.json');
const ValidationEngine = require('../lib/validation');
const ScoringEngine = require('../lib/scoring');
const { createGeminiProvider } = require('../lib/gemini-provider');
const { ERROR_TYPES, AppError } = require('../lib/provider-errors');
const { APP_VERSION } = require('../server');
const scenarios = require('./evaluation-scenarios');

function increment(target, key) { target[key] = (target[key] || 0) + 1; }
function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] || 0;
}
function gitCommit() {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); }
  catch (_) { return process.env.GITHUB_SHA || 'unknown'; }
}
function normalizedWords(text) {
  return new Set(String(text).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(word => word.length > 3));
}
function similarity(a, b) {
  const aw = normalizedWords(a); const bw = normalizedWords(b);
  if (!aw.size || !bw.size) return 0;
  let shared = 0; aw.forEach(word => { if (bw.has(word)) shared += 1; });
  return shared / Math.min(aw.size, bw.size);
}
function duplicatePairs(risks) {
  let count = 0;
  for (let i = 0; i < risks.length; i += 1) {
    for (let j = i + 1; j < risks.length; j += 1) {
      if (risks[i].category === risks[j].category && similarity(risks[i].title, risks[j].title) >= 0.6) count += 1;
    }
  }
  return count;
}
function ownerDetected(risks, expectation) {
  if (!expectation) return true;
  if (expectation === 'confirmed') return !risks.some(risk => risk.category === 'missing-ownership');
  return risks.some(risk => risk.category === 'missing-ownership' && risk.ownerStatus !== 'confirmed');
}

async function main() {
  if ((process.env.ANALYSIS_PROVIDER || 'gemini') !== 'gemini') throw new Error('Evaluation requires ANALYSIS_PROVIDER=gemini.');
  if (!process.env.GEMINI_API_KEY) throw new Error('Evaluation requires a configured Gemini server credential.');

  const provider = createGeminiProvider({
    appConfig: config,
    apiKey: process.env.GEMINI_API_KEY,
    model: process.env.GEMINI_MODEL || 'gemini-3.5-flash',
    maxAttempts: process.env.GEMINI_MAX_ATTEMPTS || 5,
    initialDelayMs: process.env.GEMINI_INITIAL_DELAY_MS || 1000,
    backoffFactor: process.env.GEMINI_BACKOFF_FACTOR || 2,
    maxDelayMs: process.env.GEMINI_MAX_DELAY_MS || 30000,
    attemptTimeoutMs: process.env.GEMINI_REQUEST_TIMEOUT_MS || 30000,
    overallTimeoutMs: process.env.ANALYSIS_TIMEOUT_MS || 90000
  });

  const report = {
    provider: 'gemini', model: provider.model,
    promptTemplateVersion: provider.promptTemplateVersion,
    schemaVersion: provider.schemaVersion,
    applicationVersion: APP_VERSION, applicationCommit: gitCommit(),
    executedAt: new Date().toISOString(), scenarioCount: scenarios.length,
    successfulResponseCount: 0, providerErrorCount: 0, parseFailureCount: 0,
    schemaValidationFailureCount: 0, retryCount: 0,
    latencyMs: {}, findingsByCategory: {}, findingsBySeverity: {},
    expectedCriticalRiskRecall: 0, unsupportedFindingCount: 0,
    falsePositiveCount: 0, missingEvidenceCount: 0, duplicateFindingCount: 0,
    ownerDetectionAccuracy: 0, launchBlockerClassificationAccuracy: 0,
    perScenarioResults: []
  };
  const latencies = [];
  let expectedCritical = 0; let criticalFound = 0;
  let ownerCases = 0; let ownerCorrect = 0;
  let blockerCases = 0; let blockerCorrect = 0;

  for (const scenario of scenarios) {
    const started = Date.now();
    const row = { id: scenario.id, description: scenario.description, status: 'error', latencyMs: 0, errors: [] };
    try {
      const result = await provider.analyze({ text: scenario.text, projectName: scenario.projectName, analysisProfile: 'general' });
      row.latencyMs = result.diagnostics.durationMs;
      latencies.push(row.latencyMs);
      report.retryCount += result.diagnostics.retryCount;
      const analysis = result.analysis;
      try { ValidationEngine.validateDomainSchema(analysis, config); }
      catch (error) {
        report.schemaValidationFailureCount += 1;
        throw new AppError(ERROR_TYPES.DOMAIN_SCHEMA_VALIDATION, { cause: error });
      }
      const score = ScoringEngine.calculateScore(analysis, config);
      row.status = 'success'; row.riskCount = analysis.risks.length;
      row.categories = [...new Set(analysis.risks.map(risk => risk.category))];
      row.severities = [...new Set(analysis.risks.map(risk => risk.severity))];
      row.gateCap = score.gateCap; row.finalScore = score.finalScore;
      row.duplicatePairs = duplicatePairs(analysis.risks);
      report.successfulResponseCount += 1;
      report.duplicateFindingCount += row.duplicatePairs;
      analysis.risks.forEach(risk => {
        increment(report.findingsByCategory, risk.category);
        increment(report.findingsBySeverity, risk.severity);
        if (!risk.evidence || !risk.evidence.length) report.missingEvidenceCount += 1;
      });
      const requiredFound = scenario.expectations.requiredCategories.every(category => row.categories.includes(category));
      if (!requiredFound) row.errors.push('Missing one or more required categories.');
      if (analysis.risks.length < scenario.expectations.minRisks || analysis.risks.length > scenario.expectations.maxRisks) row.errors.push('Risk count outside expected range.');
      if (scenario.expectations.maxDuplicatePairs !== undefined && row.duplicatePairs > scenario.expectations.maxDuplicatePairs) row.errors.push('Duplicate findings exceeded expectation.');
      if (scenario.expectations.expectedGateCapAtMost !== undefined && row.gateCap > scenario.expectations.expectedGateCapAtMost) row.errors.push('Deterministic score gate did not activate as expected.');
      const hasCritical = analysis.risks.some(risk => risk.severity === 'critical' && risk.status !== 'resolved');
      if (scenario.expectations.expectCritical) { expectedCritical += 1; if (hasCritical) criticalFound += 1; }
      if (scenario.expectations.ownerExpectation) { ownerCases += 1; if (ownerDetected(analysis.risks, scenario.expectations.ownerExpectation)) ownerCorrect += 1; }
      blockerCases += 1;
      const launchBlocked = score.gateCap < 100;
      if (launchBlocked === scenario.expectations.expectLaunchBlocker) blockerCorrect += 1;
      if (scenario.id === 'well-formed-plan' && analysis.risks.length > scenario.expectations.maxRisks) {
        report.falsePositiveCount += analysis.risks.length - scenario.expectations.maxRisks;
      }
      report.unsupportedFindingCount += analysis.risks.filter(risk => risk.confidence < 0.5).length;
    } catch (error) {
      row.latencyMs = Date.now() - started;
      const type = error instanceof AppError ? error.type : 'unknown_error';
      row.errors.push(type);
      if (type === ERROR_TYPES.PROVIDER_INVALID_JSON) report.parseFailureCount += 1;
      else if (type !== ERROR_TYPES.DOMAIN_SCHEMA_VALIDATION) report.providerErrorCount += 1;
    }
    report.perScenarioResults.push(row);
    console.log(`${row.status === 'success' ? '✓' : '✗'} ${scenario.id} (${row.latencyMs}ms)`);
  }

  if (latencies.length) {
    report.latencyMs = {
      min: Math.min(...latencies), median: percentile(latencies, 0.5), p95: percentile(latencies, 0.95),
      max: Math.max(...latencies), average: Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length)
    };
  }
  report.expectedCriticalRiskRecall = expectedCritical ? criticalFound / expectedCritical : 1;
  report.ownerDetectionAccuracy = ownerCases ? ownerCorrect / ownerCases : 1;
  report.launchBlockerClassificationAccuracy = blockerCases ? blockerCorrect / blockerCases : 1;

  const reportsDir = path.resolve(__dirname, '..', 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });
  const filename = `evaluation-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const output = path.join(reportsDir, filename);
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(`Evaluation report written to ${output}`);
  if (report.providerErrorCount || report.parseFailureCount || report.schemaValidationFailureCount) process.exitCode = 1;
}

main().catch(error => { console.error(error.message); process.exit(1); });
