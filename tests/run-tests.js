const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

// Force deterministic demo provider for tests
process.env.ANALYSIS_PROVIDER = 'demo';

// Setup paths
const PROJECT_DIR = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(PROJECT_DIR, 'config.json');
const FIXTURES_DIR = path.join(PROJECT_DIR, 'tests', 'fixtures');

// Load configurations
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const ScoringEngine = require('../lib/scoring');
const ValidationEngine = require('../lib/validation');
const { createAppServer } = require('../server');

// Grab deduplicateAndRemap from server module or expose it
const { deduplicateAndRemap } = require('../server');

console.log('=== RUNNING IMPLEMENTATION RISK SCANNER TEST SUITE ===\n');

let failed = false;

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    failed = true;
  } else {
    console.log(`✅ PASS: ${message}`);
  }
}

function assertEquals(actual, expected, message) {
  if (actual !== expected) {
    console.error(`❌ FAIL: ${message} (Expected: ${expected}, Got: ${actual})`);
    failed = true;
  } else {
    console.log(`✅ PASS: ${message}`);
  }
}

// A base payload that perfectly conforms to the schema
const validBasePayload = {
  summary: "This is a valid summary of the implementation readiness report.",
  topBlockers: ["First top blocker"],
  risks: [
    {
      id: "risk-1",
      tempId: "risk-1",
      title: "Valid Risk 1",
      category: "dependency_risk",
      evidence: [
        { excerpt: "Excerpt of evidence", sourceReference: "Source ref 1" }
      ],
      evidenceType: "explicit",
      implementationImpact: "Impact description",
      requiredClarificationOrAction: "Clarification description",
      affectedStakeholders: ["Stakeholder 1"],
      relatedDependencyIds: [],
      conditionCodes: ["launch_dependency_unconfirmed"],
      affectedScope: "core",
      affectedStage: "launch",
      suggestedSeverity: "low",
      accountabilityStatus: "confirmed",
      suggestedBlocksProgression: false,
      suggestedBlocksLaunch: false,
      suggestedBlockerReason: "None",
      confidence: 0.8,
      confidenceReason: "Reasoning description",
      status: "open",
      ownerStatus: "confirmed"
    }
  ],
  stakeholders: [
    {
      name: "Stakeholder 1",
      role: "Role 1",
      goals: ["Goal 1"],
      conflicts: ["Conflict 1"],
      authority: "Authority 1"
    }
  ],
  dependencies: [
    {
      name: "Dependency 1",
      type: "data-dependency",
      description: "Description 1",
      status: "resolved"
    }
  ],
  decisions: [
    {
      id: "dec-1",
      decision: "Decision 1",
      relatedRisks: ["risk-1"],
      suggestedOwner: "Owner 1",
      consequence: "Consequence 1"
    }
  ],
  validationQuestions: [
    {
      category: "workflow",
      question: "Question 1"
    }
  ],
  rolloutRecommendations: [
    {
      phase: "30-day",
      action: "Action 1",
      owner: "Owner 1"
    }
  ]
};

// Helper for schema rejection testing
function testSchemaRejection(modifier, expectedErrorPart) {
  const payload = JSON.parse(JSON.stringify(validBasePayload));
  modifier(payload);
  try {
    ValidationEngine.validateDomainSchema(payload, config);
    assert(false, `Expected schema validator to reject payload: ${expectedErrorPart}`);
  } catch (err) {
    const matches = err.message.toLowerCase().includes(expectedErrorPart.toLowerCase());
    assert(matches, `Expected error containing "${expectedErrorPart}". Got: "${err.message}"`);
  }
}

// ==========================================
// TEST SUITE 1: Domain Schema Validation
// ==========================================
console.log('[Suite 1: Schema Validation Rules]');

// Verify valid fixtures load and validate cleanly
const fixtureFiles = ['sales-marketing-conflict.json', 'ai-support-rollout.json', 'multi-location-operations.json'];
fixtureFiles.forEach(file => {
  const filePath = path.join(FIXTURES_DIR, file);
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const isValid = ValidationEngine.validateDomainSchema(data, config);
    assert(isValid === true, `Fixture '${file}' is valid schema`);
  } catch (err) {
    assert(false, `Fixture '${file}' failed validation: ${err.message}`);
  }
});

// Category and Severity checks
testSchemaRejection(p => p.risks[0].category = 'invalid-category', 'invalid category');
testSchemaRejection(p => p.risks[0].suggestedSeverity = 'invalid-severity', 'invalid suggestedSeverity');

// Evidence checks
testSchemaRejection(p => p.risks[0].evidence = [], 'missing supporting evidence');
testSchemaRejection(p => p.risks[0].evidence[0].excerpt = '', 'missing or empty excerpt');
testSchemaRejection(p => p.risks[0].evidence[0].sourceReference = '', 'missing or empty sourceReference');

// Confidence checks
testSchemaRejection(p => p.risks[0].confidence = 1.1, 'must be a number between 0.0 and 1.0');
testSchemaRejection(p => p.risks[0].confidence = -0.1, 'must be a number between 0.0 and 1.0');
testSchemaRejection(p => p.risks[0].confidence = 'high', 'must be a number between 0.0 and 1.0');

// Resolved risk gate validations
testSchemaRejection(p => {
  p.risks[0].status = 'resolved';
  p.risks[0].ownerStatus = 'unconfirmed';
}, 'resolved risk must have a confirmed owner');

testSchemaRejection(p => {
  p.risks[0].status = 'resolved';
  p.risks[0].ownerStatus = 'confirmed';
  p.risks[0].resolutionNote = '';
}, 'resolved risk must have a non-empty resolutionNote');

testSchemaRejection(p => {
  p.risks[0].status = 'resolved';
  p.risks[0].ownerStatus = 'confirmed';
  p.risks[0].resolutionNote = 'Note';
  p.risks[0].resolvedAt = '';
}, 'resolved risk must have a valid non-empty resolvedAt timestamp');

testSchemaRejection(p => {
  p.risks[0].status = 'resolved';
  p.risks[0].ownerStatus = 'confirmed';
  p.risks[0].resolutionNote = 'Note';
  p.risks[0].resolvedAt = 'invalid-date';
}, 'resolved risk must have a valid non-empty resolvedAt timestamp');


// ==========================================
// TEST SUITE 2: Scoring Engine & Blocker Gates
// ==========================================
console.log('\n[Suite 2: Scoring Engine Calculations]');

// Test 2.1: Baseline score is 100
const emptyData = { risks: [], dependencies: [] };
const baselineRes = ScoringEngine.calculateScore(emptyData, config);
assertEquals(baselineRes.finalScore, 100, 'Baseline score is 100');
assertEquals(baselineRes.calculatedScore, 100, 'Baseline calculated score is 100');
assertEquals(baselineRes.gateCap, 100, 'Baseline gate cap is 100');
assertEquals(baselineRes.gateAdjustment, 0, 'Baseline gate adjustment is 0');

// Test 2.2: Accepted low-severity risk penalty is exactly 0.5
const lowAcceptedData = {
  risks: [
    {
      title: "Low Accepted Risk",
      category: "dependency_risk",
      finalSeverity: "low",
      evidence: [{ excerpt: "Excerpt", sourceReference: "Ref" }],
      ownerStatus: "confirmed",
      status: "accepted"
    }
  ],
  dependencies: []
};
const lowAcceptedRes = ScoringEngine.calculateScore(lowAcceptedData, config);
assertEquals(lowAcceptedRes.calculatedScore, 99.5, 'Low accepted risk has exactly 0.5 penalty');
assertEquals(lowAcceptedRes.finalScore, 99.5, 'Low accepted risk final score is exactly 99.5');
assertEquals(lowAcceptedRes.penaltiesList[0].current, '-0.5', 'Penalty details records -0.5');

// Test 2.3: Penalty list sum matches 100 - calculatedScore
const multiplePenaltiesData = {
  risks: [
    {
      title: "R1",
      category: "dependency_risk",
      finalSeverity: "medium", // Penalty 4
      evidence: [{ excerpt: "E", sourceReference: "R" }],
      ownerStatus: "confirmed",
      status: "open"
    },
    {
      title: "R2",
      category: "success_measurement_gap", // Severity medium (4) + Undefined Metric (5) = 9
      finalSeverity: "medium",
      evidence: [{ excerpt: "E", sourceReference: "R" }],
      ownerStatus: "unconfirmed", // Unconfirmed owner penalty (3)
      status: "open"
    }
  ],
  dependencies: [
    { name: "Dep1", status: "missing" } // Missing dependency (4)
  ]
};
const multPenRes = ScoringEngine.calculateScore(multiplePenaltiesData, config);
let penaltiesSum = 0;
multPenRes.penaltiesList.forEach(p => {
  penaltiesSum += Math.abs(parseFloat(p.current));
});
assertEquals(multPenRes.calculatedScore, 80, 'Calculated score is 80');
assertEquals(penaltiesSum, 20, 'Penalties list absolute sum is 20');
assertEquals(multPenRes.calculatedScore, 100 - penaltiesSum, 'Penalty sum matches 100 - calculatedScore');

// Test 2.4: Blocker Gates - Cap 49 for unresolved critical + unowned
const criticalUnownedData = {
  risks: [
    {
      title: "Critical Unowned Risk",
      category: "decision_gap", // 5 penalty
      finalSeverity: "critical", // Weight 15
      evidence: [{ excerpt: "E", sourceReference: "R" }],
      conditionCodes: ["required_approval_missing"], // launch blocking
      ownerStatus: "unconfirmed", // Unowned (3)
      status: "open"
    }
  ],
  dependencies: []
};
const critUnownedRes = ScoringEngine.calculateScore(criticalUnownedData, config);
// Raw score: 100 - (15 + 3 + 5) = 77
assertEquals(critUnownedRes.calculatedScore, 77, 'Calculated score is 77');
assertEquals(critUnownedRes.gateCap, 49, 'Gate cap is 49 due to unowned critical risk');
assertEquals(critUnownedRes.finalScore, 49, 'Final score is capped at 49');
assertEquals(critUnownedRes.gateAdjustment, 28, 'Gate adjustment is 28 (77 - 49)');

// Test 2.5: Blocker Gates - Cap 49 for unresolved compliance critical
const criticalComplianceData = {
  risks: [
    {
      title: "Critical Compliance Risk",
      category: "decision_gap", // 5 penalty
      finalSeverity: "critical", // Weight 15
      evidence: [{ excerpt: "E", sourceReference: "R" }],
      conditionCodes: ["required_approval_missing"], // launch blocker
      ownerStatus: "confirmed", // Owned
      status: "open"
    }
  ],
  dependencies: []
};
const critComplianceRes = ScoringEngine.calculateScore(criticalComplianceData, config);
// Raw calculated score: 100 - (15 + 5) = 80
assertEquals(critComplianceRes.calculatedScore, 80, 'Calculated score is 80');
assertEquals(critComplianceRes.gateCap, 49, 'Gate cap is 49 due to compliance critical risk');
assertEquals(critComplianceRes.finalScore, 49, 'Final score is capped at 49');

// Test 2.6: Blocker Gates - Cap 69 for other unresolved critical risks (owned, non-compliance)
const criticalOtherData = {
  risks: [
    {
      title: "Critical Stakeholder Conflict",
      category: "timeline_risk", // no extra penalty
      finalSeverity: "critical", // Weight 15
      evidence: [{ excerpt: "E", sourceReference: "R" }],
      conditionCodes: ["customer_milestone_unconfirmed"], // progression blocker only
      ownerStatus: "confirmed", // Owned
      status: "open"
    }
  ],
  dependencies: []
};
const critOtherRes = ScoringEngine.calculateScore(criticalOtherData, config);
// Raw calculated score: 100 - 15 = 85
assertEquals(critOtherRes.calculatedScore, 85, 'Calculated score is 85');
assertEquals(critOtherRes.gateCap, 69, 'Gate cap is 69 due to owned non-compliance critical risk');
assertEquals(critOtherRes.finalScore, 69, 'Final score is capped at 69');

// Test 2.7: Blocker Gates - Accepted critical risks remain capped
const criticalAcceptedData = {
  risks: [
    {
      title: "Critical Stakeholder Conflict",
      category: "timeline_risk",
      finalSeverity: "critical", // Weight 15
      evidence: [{ excerpt: "E", sourceReference: "R" }],
      conditionCodes: ["customer_milestone_unconfirmed"],
      ownerStatus: "confirmed", // Owned
      status: "accepted" // Accepted (15 * 0.5 = 7.5)
    }
  ],
  dependencies: []
};
const critAcceptedRes = ScoringEngine.calculateScore(criticalAcceptedData, config);
// Raw score: 100 - 7.5 = 92.5
assertEquals(critAcceptedRes.calculatedScore, 92.5, 'Calculated score is 92.5');
assertEquals(critAcceptedRes.gateCap, 69, 'Gate cap is 69 for accepted critical risk');
assertEquals(critAcceptedRes.finalScore, 69, 'Final score is capped at 69');

// Test 2.8: Correctly resolved critical risks remove the cap
const criticalResolvedData = {
  risks: [
    {
      title: "Critical Resolved Risk",
      category: "timeline_risk",
      finalSeverity: "critical",
      evidence: [{ excerpt: "E", sourceReference: "R" }],
      ownerStatus: "confirmed",
      status: "resolved",
      resolutionNote: "This was successfully resolved.",
      resolvedAt: new Date().toISOString()
    }
  ],
  dependencies: []
};
const critResolvedRes = ScoringEngine.calculateScore(criticalResolvedData, config);
assertEquals(critResolvedRes.calculatedScore, 100, 'Calculated score is 100');
assertEquals(critResolvedRes.gateCap, 100, 'Gate cap is 100 for validly resolved critical risk');
assertEquals(critResolvedRes.finalScore, 100, 'Final score is 100');

// Test 2.9: Invalidly resolved critical risks keep the cap
const criticalInvalidResolvedData = {
  risks: [
    {
      title: "Critical Invalid Resolved Risk",
      category: "timeline_risk",
      finalSeverity: "critical",
      evidence: [{ excerpt: "E", sourceReference: "R" }],
      conditionCodes: ["customer_milestone_unconfirmed"],
      ownerStatus: "confirmed",
      status: "resolved",
      resolutionNote: "", // Missing note
      resolvedAt: new Date().toISOString()
    }
  ],
  dependencies: []
};
const critInvalidResolvedRes = ScoringEngine.calculateScore(criticalInvalidResolvedData, config);
// Raw score: 100 - 15 = 85
assertEquals(critInvalidResolvedRes.calculatedScore, 85, 'Calculated score is 85');
assertEquals(critInvalidResolvedRes.gateCap, 69, 'Gate cap is 69 for invalidly resolved critical risk');
assertEquals(critInvalidResolvedRes.finalScore, 69, 'Final score is capped at 69');

// Test 2.10: Dependency deduplication
const deduplicatedData = {
  risks: [],
  dependencies: [
    { name: "SaaS API Sync", id: "saas-api-id", status: "missing" },
    { name: "SaaS API Sync", id: "saas-api-id", status: "missing" } // repeated by ID
  ]
};
const dedupRes = ScoringEngine.calculateScore(deduplicatedData, config);
assertEquals(dedupRes.calculatedScore, 96, 'Dependency deduplicated score is 96');
assertEquals(dedupRes.penaltiesList.length, 1, 'Only one dependency penalty recorded');


// ==========================================
// TEST SUITE 3: Required Deterministic Rules & Stable IDs
// ==========================================
console.log('\n[Suite 3: Required Deterministic Rules & Stable IDs]');

// Test 3.1: suggestedSeverity cannot change finalSeverity
const suggestedSeverityTestRisk = {
  category: "dependency_risk",
  conditionCodes: [],
  affectedScope: "peripheral",
  affectedStage: "discovery",
  suggestedSeverity: "critical" // suggested is critical
};
const finalSevResult = ScoringEngine.calculateFinalSeverity(suggestedSeverityTestRisk);
assertEquals(finalSevResult, "low", "suggestedSeverity cannot change finalSeverity (should remain low)");

// Test 3.2: suggestedBlocksLaunch cannot activate blocksLaunch
const suggestedBlocksLaunchRisk = {
  category: "dependency_risk",
  conditionCodes: [],
  affectedScope: "peripheral",
  affectedStage: "discovery",
  suggestedSeverity: "critical",
  suggestedBlocksLaunch: true,
  status: "open"
};
const calculatedBlockerRes1 = ScoringEngine.calculateBlockers(suggestedBlocksLaunchRisk, "low");
assertEquals(calculatedBlockerRes1.blocksLaunch, false, "suggestedBlocksLaunch cannot activate blocksLaunch");

// Test 3.3: suggestedBlocksProgression cannot activate blocksProgression
const suggestedBlocksProgressionRisk = {
  category: "dependency_risk",
  conditionCodes: [],
  affectedScope: "peripheral",
  affectedStage: "discovery",
  suggestedSeverity: "critical",
  suggestedBlocksProgression: true,
  status: "open"
};
const calculatedBlockerRes2 = ScoringEngine.calculateBlockers(suggestedBlocksProgressionRisk, "low");
assertEquals(calculatedBlockerRes2.blocksProgression, false, "suggestedBlocksProgression cannot activate blocksProgression");

// Test 3.4: A peripheral issue during launch is not automatically critical
const peripheralLaunchRisk = {
  category: "decision_gap",
  conditionCodes: ["required_approval_missing"],
  affectedScope: "peripheral",
  affectedStage: "launch"
};
const peripheralLaunchSeverity = ScoringEngine.calculateFinalSeverity(peripheralLaunchRisk);
assert(peripheralLaunchSeverity !== "critical", "A peripheral issue during launch is not automatically critical");

// Test 3.5: A core mandatory launch dependency can become critical
const coreLaunchDependencyRisk = {
  category: "dependency_risk",
  conditionCodes: ["launch_dependency_failed"],
  affectedScope: "core",
  affectedStage: "launch"
};
const coreLaunchSeverity = ScoringEngine.calculateFinalSeverity(coreLaunchDependencyRisk);
assertEquals(coreLaunchSeverity, "critical", "A core mandatory launch dependency can become critical");

// Test 3.6: Finding IDs remain stable when Gemini changes finding order
const findingA = {
  tempId: "temp-a",
  category: "dependency_risk",
  conditionCodes: ["launch_dependency_failed"],
  evidence: [{ excerpt: "exp a", sourceReference: "ref a" }],
  affectedScope: "core",
  affectedStage: "launch"
};
const findingB = {
  tempId: "temp-b",
  category: "decision_gap",
  conditionCodes: ["required_approval_missing"],
  evidence: [{ excerpt: "exp b", sourceReference: "ref b" }],
  affectedScope: "core",
  affectedStage: "launch"
};

const run1 = deduplicateAndRemap([findingA, findingB]);
const run2 = deduplicateAndRemap([findingB, findingA]);

const idA1 = run1.mergedList.find(r => r.evidence[0].excerpt === "exp a").id;
const idA2 = run2.mergedList.find(r => r.evidence[0].excerpt === "exp a").id;
const idB1 = run1.mergedList.find(r => r.evidence[0].excerpt === "exp b").id;
const idB2 = run2.mergedList.find(r => r.evidence[0].excerpt === "exp b").id;

assertEquals(idA1, idA2, "Finding A's ID remains stable when output order changes");
assertEquals(idB1, idB2, "Finding B's ID remains stable when output order changes");

// Test 3.7: Finding IDs remain stable when an unrelated finding is added
const findingC = {
  tempId: "temp-c",
  category: "timeline_risk",
  conditionCodes: ["customer_milestone_unconfirmed"],
  evidence: [{ excerpt: "exp c", sourceReference: "ref c" }],
  affectedScope: "supporting",
  affectedStage: "discovery"
};

const run3 = deduplicateAndRemap([findingA]);
const run4 = deduplicateAndRemap([findingA, findingC]);

const idA3 = run3.mergedList[0].id;
const idA4 = run4.mergedList.find(r => r.evidence[0].excerpt === "exp a").id;
assertEquals(idA3, idA4, "Finding A's ID remains stable when unrelated finding C is added");

// Test 3.8: Merged findings correctly remap temporary dependency references
const findingD1 = {
  tempId: "temp-d1",
  category: "dependency_risk",
  conditionCodes: ["launch_dependency_failed"],
  evidence: [{ excerpt: "exp d", sourceReference: "ref d" }],
  affectedScope: "core",
  affectedStage: "launch"
};
const findingD2 = {
  tempId: "temp-d2",
  category: "dependency_risk",
  conditionCodes: ["launch_dependency_failed"],
  evidence: [{ excerpt: "exp d", sourceReference: "ref d" }], // identical to d1, will be merged
  affectedScope: "core",
  affectedStage: "launch"
};
const findingE = {
  tempId: "temp-e",
  category: "decision_gap",
  conditionCodes: ["required_approval_missing"],
  evidence: [{ excerpt: "exp e", sourceReference: "ref e" }],
  affectedScope: "core",
  affectedStage: "launch",
  relatedDependencyIds: ["temp-d2"] // references tempId of merged finding D2
};

const mergeRun = deduplicateAndRemap([findingD1, findingD2, findingE]);
const pIdD = mergeRun.tempIdToPermanentMap["temp-d1"];
const pIdE = mergeRun.tempIdToPermanentMap["temp-e"];
const resolvedE = mergeRun.mergedList.find(r => r.id === pIdE);

assertEquals(resolvedE.relatedDependencyIds.length, 1, "Finding E has exactly 1 related dependency");
assertEquals(resolvedE.relatedDependencyIds[0], pIdD, "Merged reference temp-d2 remapped to permanent ID of surviving finding D1");

// Test 3.9: Self-references and dangling dependency references are removed
const selfRefRisk = {
  tempId: "temp-self",
  category: "dependency_risk",
  conditionCodes: ["launch_dependency_failed"],
  evidence: [{ excerpt: "self", sourceReference: "ref" }],
  affectedScope: "core",
  affectedStage: "launch",
  relatedDependencyIds: ["temp-self", "dangling-temp-id"]
};
const cleanRun = deduplicateAndRemap([selfRefRisk]);
const resolvedSelf = cleanRun.mergedList[0];
assertEquals(resolvedSelf.relatedDependencyIds.length, 0, "Self-references and dangling dependency references are successfully removed");

// Test 3.10: Provider schema errors and domain-validation errors return different codes
let caughtSchemaError = false;
let caughtDomainError = false;

try {
  const badSchema = JSON.parse(JSON.stringify(validBasePayload));
  badSchema.risks[0].suggestedSeverity = "extremely-critical"; // Schema violation
  ValidationEngine.validateDomainSchema(badSchema, config);
} catch (err) {
  if (err.code === "schema-invalid") {
    caughtSchemaError = true;
  }
}

try {
  const badDomain = JSON.parse(JSON.stringify(validBasePayload));
  badDomain.risks[0].category = "timeline_risk";
  badDomain.risks[0].conditionCodes = ["workflow_owner_missing"]; // Incompatible code -> Domain validation error
  ValidationEngine.validateDomainSchema(badDomain, config);
} catch (err) {
  if (err.code === "domain-invalid") {
    caughtDomainError = true;
  }
}

assert(caughtSchemaError, "Schema violation throws schema-invalid error code");
assert(caughtDomainError, "Incompatible category-code domain rule violation throws domain-invalid error code");


// ==========================================
// TEST SUITE 4: HTTP API Integration Tests
// ==========================================
console.log('\n[Suite 4: Server HTTP API Integration]');

// Helper to make HTTP request
function makeRequest(port, method, path, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port: port,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };
    
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data
        });
      });
    });
    
    req.on('error', (err) => {
      reject(err);
    });
    
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

// Start server on temporary port 0 (OS picks a random available port)
const server = createAppServer();
server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  console.log(`Temporary test server listening on 127.0.0.1:${port}`);
  
  try {
    // Test 4.1: GET /api/health
    const healthRes = await makeRequest(port, 'GET', '/api/health');
    assertEquals(healthRes.statusCode, 200, 'GET /api/health status is 200');
    const healthData = JSON.parse(healthRes.body);
    assertEquals(healthData.activeProvider, 'demo', 'Health check reports active provider as "demo"');
    assert(healthData.status === 'healthy', 'Health check reports status is "healthy"');

    // Test 4.2: POST /api/analyze - Valid Demo Scenario
    const validPayload = {
      demoScenarioId: "sales-marketing-conflict",
      analysisProfile: "general",
      text: "Marketing expects automatic lead qualification based on web activity. However, Sales requires manual approval for every lead...",
      projectName: "Test Project"
    };
    const analyzeRes = await makeRequest(port, 'POST', '/api/analyze', {}, validPayload);
    assertEquals(analyzeRes.statusCode, 200, 'POST /api/analyze with valid scenario status is 200');
    const analyzeData = JSON.parse(analyzeRes.body);
    assert(analyzeData.summary !== undefined, 'Response contains summary field');
    assert(Array.isArray(analyzeData.risks), 'Response contains risks array');
    
    // Test 4.3: POST /api/analyze - Custom text analysis rejection in demo mode
    const customPayload = {
      demoScenarioId: null, // Custom text
      analysisProfile: "general",
      text: "This is some custom text that should not match fixtures.",
      projectName: "Test Project"
    };
    const customRes = await makeRequest(port, 'POST', '/api/analyze', {}, customPayload);
    assertEquals(customRes.statusCode, 400, 'POST /api/analyze with custom text status is 400');
    const customErr = JSON.parse(customRes.body);
    assert(customErr.error.includes('Custom-document analysis becomes available'), 'Returns custom text rejection error message');

    // Test 4.4: POST /api/analyze - Unrecognized demo scenario ID
    const invalidScenarioPayload = {
      demoScenarioId: "unknown-scenario-id",
      analysisProfile: "general",
      text: "Some text...",
      projectName: "Test Project"
    };
    const invScenRes = await makeRequest(port, 'POST', '/api/analyze', {}, invalidScenarioPayload);
    assertEquals(invScenRes.statusCode, 400, 'POST /api/analyze with unknown scenario ID status is 400');
    const invScenErr = JSON.parse(invScenRes.body);
    assert(invScenErr.error.includes('Unsupported demo fixture ID'), 'Returns unsupported fixture error message');

    // Test 4.5: POST /api/analyze - Empty text
    const emptyPayload = {
      demoScenarioId: "sales-marketing-conflict",
      analysisProfile: "general",
      text: "",
      projectName: "Test Project"
    };
    const emptyTextRes = await makeRequest(port, 'POST', '/api/analyze', {}, emptyPayload);
    assertEquals(emptyTextRes.statusCode, 400, 'POST /api/analyze with empty text status is 400');

    // Test 4.6: POST /api/analyze - Payload too large
    const largeText = "a".repeat(800000); // MAX_SOURCE_TEXT_BYTES is 750000
    const largePayload = {
      demoScenarioId: "sales-marketing-conflict",
      analysisProfile: "general",
      text: largeText,
      projectName: "Test Project"
    };
    try {
      const largeRes = await makeRequest(port, 'POST', '/api/analyze', {}, largePayload);
      assertEquals(largeRes.statusCode, 413, 'POST /api/analyze with too large payload status is 413');
      const largeErr = JSON.parse(largeRes.body);
      assert(largeErr.error.includes('exceeds maximum source text bytes limit'), 'Returns payload too large error message');
    } catch (err) {
      assert(err.code === 'ECONNRESET' || err.message.includes('socket hang up') || err.message.includes('reset'), `Enforced connection termination for oversized payload: ${err.code || err.message}`);
    }

  } catch (err) {
    console.error('Integration tests failed with error:', err);
    failed = true;
  } finally {
    console.log('Closing temporary test server...');
    server.close(() => {
      console.log('Test server closed.');
      if (failed) {
        console.error('\n❌ SOME TESTS FAILED.');
        process.exit(1);
      } else {
        console.log('\n🌟 ALL TESTS PASSED SUCCESSFULLY!');
        process.exit(0);
      }
    });
  }
});
