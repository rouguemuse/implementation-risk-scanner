const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Load .env file programmatically if it exists
const envPath = path.resolve(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const parts = trimmed.split('=');
      if (parts.length >= 2) {
        const key = parts[0].trim();
        const val = parts.slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
        if (process.env[key] === undefined) {
          process.env[key] = val;
        }
      }
    }
  });
}

// Load environment configuration with defaults
const PORT = parseInt(process.env.PORT || '3050', 10);
const ANALYSIS_PROVIDER = process.env.ANALYSIS_PROVIDER || 'demo';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
const ANTIGRAVITY_AGENT_PATH = process.env.ANTIGRAVITY_AGENT_PATH || '';
const ANTIGRAVITY_BRAIN_PATH = process.env.ANTIGRAVITY_BRAIN_PATH || '';
const MAX_SOURCE_TEXT_BYTES = parseInt(process.env.MAX_SOURCE_TEXT_BYTES || '750000', 10);

// Parse GEMINI_TEMPERATURE
const GEMINI_TEMPERATURE_ENV = process.env.GEMINI_TEMPERATURE;
let GEMINI_TEMPERATURE = undefined;
if (GEMINI_TEMPERATURE_ENV !== undefined && GEMINI_TEMPERATURE_ENV !== '') {
  const parsedTemp = parseFloat(GEMINI_TEMPERATURE_ENV);
  if (!isNaN(parsedTemp) && parsedTemp >= 0 && parsedTemp <= 2) {
    GEMINI_TEMPERATURE = parsedTemp;
  }
}

const PUBLIC_DIR = path.resolve(__dirname, 'public');
const FIXTURES_DIR = path.resolve(__dirname, 'tests', 'fixtures');
const CONFIG_PATH = path.resolve(__dirname, 'config.json');

// Load app config
let appConfig = {};
try {
  appConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
} catch (err) {
  console.error('Failed to load config.json:', err.message);
  process.exit(1);
}

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

const ValidationEngine = { SchemaError: Error, DomainError: Error, ...require('./lib/validation') };
const ScoringEngine = require('./lib/scoring');
const { generateAnalysis } = require('./lib/providers/gemini');

// Stable ID generation and cross-finding deduplication logic
function deduplicateAndRemap(risks) {
  const tempIdToPermanentMap = {};
  if (!Array.isArray(risks)) return { mergedList: [], tempIdToPermanentMap };

  // 1. Group by hashInput to deduplicate/merge identical findings
  const hashInputToMergedRiskMap = {};
  const originalTempIdsByHashInput = {};

  risks.forEach(risk => {
    const category = risk.category || '';
    const sortedCodes = [...(risk.conditionCodes || [])].sort().join(',');
    const normalizedEvRefs = (risk.evidence || []).map(e => (e.sourceReference || '').toLowerCase().trim()).sort().join(',');
    const normalizedEvExcerpts = (risk.evidence || []).map(e => (e.excerpt || '').toLowerCase().replace(/\s+/g, '')).sort().join(',');
    const missingElement = risk.missingElement || '';
    const affectedScope = risk.affectedScope || '';
    
    const hashInput = `${category}|${sortedCodes}|${normalizedEvRefs}|${normalizedEvExcerpts}|${missingElement}|${affectedScope}`;
    
    if (!originalTempIdsByHashInput[hashInput]) {
      originalTempIdsByHashInput[hashInput] = [];
    }
    if (risk.tempId) {
      originalTempIdsByHashInput[hashInput].push(risk.tempId);
    }
    if (risk.id && risk.id !== risk.tempId) {
      originalTempIdsByHashInput[hashInput].push(risk.id);
    }

    if (hashInputToMergedRiskMap[hashInput]) {
      const existing = hashInputToMergedRiskMap[hashInput];
      
      // Merge evidence arrays without duplicates
      const existingExcerpts = new Set(existing.evidence.map(e => e.excerpt));
      (risk.evidence || []).forEach(e => {
        if (!existingExcerpts.has(e.excerpt)) {
          existing.evidence.push(e);
        }
      });
      
      // Merge affected stakeholders
      const existingStakeholders = new Set(existing.affectedStakeholders);
      (risk.affectedStakeholders || []).forEach(s => {
        existingStakeholders.add(s);
      });
      existing.affectedStakeholders = Array.from(existingStakeholders);
      
      // Merge related dependency IDs
      const existingDeps = new Set(existing.relatedDependencyIds);
      (risk.relatedDependencyIds || []).forEach(d => {
        existingDeps.add(d);
      });
      existing.relatedDependencyIds = Array.from(existingDeps);
    } else {
      const newRisk = JSON.parse(JSON.stringify(risk));
      hashInputToMergedRiskMap[hashInput] = newRisk;
    }
  });

  // 2. Sort the unique merged risks alphabetically by hashInput to ensure deterministic ID assignment
  const sortedHashInputs = Object.keys(hashInputToMergedRiskMap).sort();
  const mergedList = sortedHashInputs.map(hashInput => hashInputToMergedRiskMap[hashInput]);

  // 3. Assign stable IDs, handling collisions deterministically
  const assignedIds = new Set();
  
  sortedHashInputs.forEach((hashInput, index) => {
    const risk = hashInputToMergedRiskMap[hashInput];
    const shortHash = crypto.createHash('sha256').update(hashInput).digest('hex').slice(0, 8);
    
    let candidateId = `finding-${shortHash}`;
    if (assignedIds.has(candidateId)) {
      let suffix = 1;
      while (assignedIds.has(`finding-${shortHash}-${suffix}`)) {
        suffix++;
      }
      candidateId = `finding-${shortHash}-${suffix}`;
    }
    
    risk.id = candidateId;
    assignedIds.add(candidateId);

    // Map all original tempIds / IDs of risks that got merged here to the new permanent ID
    const origIds = originalTempIdsByHashInput[hashInput] || [];
    origIds.forEach(origId => {
      tempIdToPermanentMap[origId] = candidateId;
    });
  });

  // 4. Rewrite relatedDependencyIds and clean up relationships
  mergedList.forEach(risk => {
    const newDeps = new Set();
    (risk.relatedDependencyIds || []).forEach(d => {
      const mappedId = tempIdToPermanentMap[d];
      if (mappedId && mappedId !== risk.id) { // maps to surviving ID and removes self-references
        newDeps.add(mappedId);
      }
    });
    risk.relatedDependencyIds = Array.from(newDeps);
  });

  return { mergedList, tempIdToPermanentMap };
}

// HTTP Request Handler
const handleRequest = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Endpoint: GET /api/health
  if (req.method === 'GET' && req.url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'healthy',
      activeProvider: ANALYSIS_PROVIDER,
      providerAvailability: {
        demo: true,
        gemini: !!GEMINI_API_KEY,
        antigravity: !!(ANTIGRAVITY_AGENT_PATH && ANTIGRAVITY_BRAIN_PATH)
      },
      version: '0.1.0'
    }));
    return;
  }

  // Endpoint: POST /api/analyze
  if (req.method === 'POST' && req.url === '/api/analyze') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > MAX_SOURCE_TEXT_BYTES) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Request payload exceeds maximum source text bytes limit.' }));
        req.destroy();
      }
    });

    req.on('end', async () => {
      const startTime = Date.now();
      let attemptCount = 0;
      let finalOutcome = 'success';
      let statusCategory = '2xx';
      let errorBody = null;

      try {
        const payload = JSON.parse(body);
        const demoId = payload.demoScenarioId;
        const docText = payload.text || '';

        // Local input check before provider call
        if (!docText || docText.trim() === '') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid-input' }));
          return;
        }

        if (ANALYSIS_PROVIDER === 'demo') {
          if (!demoId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
              error: 'Custom-document analysis becomes available when a live analysis provider is configured. Select one of the included demo scenarios to use deterministic demo mode.' 
            }));
            return;
          }

          const validFixtureIds = ['sales-marketing-conflict', 'ai-support-rollout', 'multi-location-operations'];
          if (!validFixtureIds.includes(demoId)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
              error: `Unsupported demo fixture ID: '${demoId}'. Available fixtures: ${validFixtureIds.join(', ')}` 
            }));
            return;
          }

          const fixturePath = path.join(FIXTURES_DIR, `${demoId}.json`);
          fs.readFile(fixturePath, 'utf8', (err, fileData) => {
            if (err) {
              console.error('Fixture read error:', err.message);
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Failed to read the requested demo scenario.' }));
              return;
            }

            try {
              const parsedResult = JSON.parse(fileData);
              ValidationEngine.validateDomainSchema(parsedResult, appConfig);
              
              // Run stable ID mapping & deduplication on loaded fixtures
              const { mergedList, tempIdToPermanentMap } = deduplicateAndRemap(parsedResult.risks);
              parsedResult.risks = mergedList;
              
              parsedResult.risks.forEach(risk => {
                risk.ownerStatus = risk.ownerStatus || 'unconfirmed';
                risk.status = risk.status || 'open';
                risk.resolutionNote = risk.resolutionNote || '';
                risk.resolvedAt = risk.resolvedAt || '';
                risk.finalSeverity = ScoringEngine.calculateFinalSeverity(risk);
                const { blocksLaunch, blocksProgression } = ScoringEngine.calculateBlockers(risk, risk.finalSeverity);
                risk.blocksLaunch = blocksLaunch;
                risk.blocksProgression = blocksProgression;
              });

              if (Array.isArray(parsedResult.decisions)) {
                parsedResult.decisions.forEach(dec => {
                  const newRelated = new Set();
                  (dec.relatedRisks || []).forEach(r => {
                    const mappedId = tempIdToPermanentMap[r];
                    if (mappedId) {
                      newRelated.add(mappedId);
                    }
                  });
                  dec.relatedRisks = Array.from(newRelated);
                });
              }

              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                analysisId: `demo-${demoId}-${Date.now()}`,
                ...parsedResult
              }));
            } catch (validationErr) {
              console.error('Domain Validation Failed on Fixture:', validationErr.message);
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: `Internal Fixture Validator Failure: ${validationErr.message}` }));
            }
          });
        } else if (ANALYSIS_PROVIDER === 'gemini') {
          if (!GEMINI_API_KEY) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'auth-failed' }));
            return;
          }

          const systemInstruction = `You are an implementation-risk and operational-readiness analyst.

Analyze the submitted implementation material as an execution plan, not as a writing sample.

Your job is to determine what could prevent the implementation from being delivered, adopted, supported, or declared successful.

Identify risks involving ownership, requirements, timelines, dependencies, handoffs, stakeholder alignment, adoption, training, data, integrations, launch readiness, support, escalation, measurement, and unresolved decisions.

Rules:
* Ground every finding in evidence from the submitted material.
* Include a concise evidence excerpt or precise reference for every finding.
* Do not invent owners, dates, commitments, requirements, dependencies, or stakeholder intentions.
* Distinguish explicitly stated facts from reasonable inferences.
* When information is missing, classify the risk as a missing control, missing decision, missing owner, missing requirement, or missing evidence rather than pretending the information exists.
* Do not treat the mere mention of an activity as proof that it is adequately planned.
* An owner is only confirmed when an accountable person or clearly accountable role is assigned.
* A group such as “the team,” “operations,” or “stakeholders” is not a sufficient owner unless the submitted material clearly establishes accountability.
* A requirement is not implementation-ready when it lacks measurable acceptance criteria, scope boundaries, necessary inputs, or a method of validation.
* A date is not evidence of a viable timeline when dependencies, effort, approvals, or sequencing are absent.
* Flag adoption risk when the plan changes behavior or workflow without addressing communication, training, incentives, resistance, reinforcement, or usage measurement.
* Flag operational-readiness risk when launch is planned without support ownership, escalation paths, monitoring, documentation, rollback or contingency procedures, or post-launch responsibility.
* Flag unresolved critical issues when an unanswered decision could block launch, create material rework, affect compliance or security, prevent data availability, or leave a critical workflow without an owner.
* Do not inflate the number or severity of findings.
* Consolidate duplicate findings.
* Prefer a smaller number of specific, defensible findings over a large number of generic observations.
* If a plan is well-formed with specific individual owners, quantitative acceptance criteria, confirmed compliance, and tested rollback procedures, do not generate findings for minor omissions; return an empty or near-empty risks array.
* For compliance, data privacy ownership, or audits that are unresolved when launch is imminent or rollout is scheduled, classify them under category 'decision_gap' with code 'required_approval_missing' or category 'missing_owner' with code 'workflow_owner_missing', and always set affectedStage to 'launch' since they directly block the imminent release.
* Return only JSON conforming to the supplied response schema.
* Do not calculate or modify the final readiness score. Return the evidence and classifications required by the deterministic scoring layer.

Category and Condition Code Compatibility:
You must strictly match conditionCodes to the finding's category according to this map:
- category: 'missing_owner'        => allowed conditionCodes: ['workflow_owner_missing', 'post_launch_owner_missing']
- category: 'handoff_risk'          => allowed conditionCodes: ['workflow_owner_missing', 'post_launch_owner_missing']
- category: 'unclear_requirement'   => allowed conditionCodes: ['core_requirements_conflict', 'acceptance_criteria_missing']
- category: 'timeline_risk'         => allowed conditionCodes: ['implementation_sequence_invalid', 'customer_milestone_unconfirmed']
- category: 'dependency_risk'       => allowed conditionCodes: ['launch_dependency_unconfirmed', 'launch_dependency_failed', 'essential_data_unavailable', 'integration_feasibility_unknown']
- category: 'adoption_risk'         => allowed conditionCodes: ['training_plan_missing', 'change_communication_missing', 'adoption_measurement_missing']
- category: 'operational_readiness_gap' => allowed conditionCodes: ['support_model_missing', 'escalation_path_missing', 'monitoring_plan_missing', 'rollback_plan_missing']
- category: 'success_measurement_gap' => allowed conditionCodes: ['success_criteria_missing', 'adoption_measurement_missing']
- category: 'decision_gap'          => allowed conditionCodes: ['required_approval_missing']

Additional Constraints:
* The condition codes 'launch_dependency_failed' and 'launch_dependency_unconfirmed' are contradictory and cannot be used together in the same finding.
* If a finding's accountabilityStatus is 'confirmed', you cannot use 'workflow_owner_missing' or 'post_launch_owner_missing' in its conditionCodes.`;

          let rawResponseText;
          try {
            const executionResult = await generateAnalysis(req, GEMINI_API_KEY, GEMINI_MODEL, systemInstruction, docText, GEMINI_TEMPERATURE);
            attemptCount = executionResult.attempts;
            rawResponseText = executionResult.text;
          } catch (providerErr) {
            finalOutcome = 'failed';
            statusCategory = providerErr.code || 'provider-error';
            errorBody = providerErr.message;
            
            if (providerErr.code === 'aborted') {
              if (!res.headersSent) {
                res.writeHead(499, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'aborted' }));
              }
              return;
            }
            
            const errCodeToStatus = {
              'provider-request-invalid': 400,
              'provider-configuration-error': 500,
              'auth-failed': 500,
              'rate-limited': 429,
              'timeout': 504,
              'safety-blocked': 502,
              'invalid-json': 502,
              'unavailable': 503
            };
            
            const statusVal = errCodeToStatus[providerErr.code] || 503;
            res.writeHead(statusVal, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: providerErr.code || 'unavailable' }));
            return;
          }

          let parsedResult;
          try {
            parsedResult = JSON.parse(rawResponseText);
          } catch (parseErr) {
            finalOutcome = 'failed';
            statusCategory = 'invalid-model-json';
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'invalid-json' }));
            return;
          }

          // Validate output JSON using ValidationEngine
          try {
            ValidationEngine.validateDomainSchema(parsedResult, appConfig);
          } catch (validationErr) {
            finalOutcome = 'failed';
            statusCategory = validationErr.code || 'schema-invalid';
            console.error('Validation failure on Gemini response:', validationErr.message);
            
            // Differentiate JSON Schema failures and Domain Rule failures
            const errorType = (validationErr.code === 'domain-invalid') ? 'domain-invalid' : 'schema-invalid';
            res.writeHead(422, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: errorType }));
            return;
          }

          // Perform stable ID hashing, cross-finding deduplication, and relationship mapping
          const { mergedList, tempIdToPermanentMap } = deduplicateAndRemap(parsedResult.risks);
          parsedResult.risks = mergedList;

          // Initialize application-managed fields and calculate final severity/blockers
          parsedResult.risks.forEach(risk => {
            risk.ownerStatus = "unconfirmed";
            risk.status = "open";
            risk.resolutionNote = "";
            risk.resolvedAt = "";
            risk.finalSeverity = ScoringEngine.calculateFinalSeverity(risk);
            const { blocksLaunch, blocksProgression } = ScoringEngine.calculateBlockers(risk, risk.finalSeverity);
            risk.blocksLaunch = blocksLaunch;
            risk.blocksProgression = blocksProgression;
          });

          // Remap decisions' relatedRisks
          if (Array.isArray(parsedResult.decisions)) {
            parsedResult.decisions.forEach(dec => {
              const newRelated = new Set();
              (dec.relatedRisks || []).forEach(r => {
                const mappedId = tempIdToPermanentMap[r];
                if (mappedId) {
                  newRelated.add(mappedId);
                }
              });
              dec.relatedRisks = Array.from(newRelated);
            });
          }

          // Return sanitized response
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            analysisId: `gemini-${GEMINI_MODEL}-${Date.now()}`,
            ...parsedResult
          }));
        } else {
          res.writeHead(501, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Provider '${ANALYSIS_PROVIDER}' is not supported.` }));
        }
      } catch (globalErr) {
        finalOutcome = 'failed';
        statusCategory = 'unhandled-error';
        console.error('Unhandled server error:', globalErr);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'unavailable' }));
        }
      } finally {
        const duration = Date.now() - startTime;
        console.log(`[Diagnostic] Provider: ${ANALYSIS_PROVIDER}, Model: ${GEMINI_MODEL}, Outcome: ${finalOutcome}, Category: ${statusCategory}, Attempts: ${attemptCount}, Duration: ${duration}ms${errorBody ? `, Error: ${errorBody}` : ''}`);
      }
    });
    return;
  }

  // Serve static files from the public folder
  let reqUrl = req.url.split('?')[0];
  
  if (reqUrl.startsWith('/lib/')) {
    let filePath = path.join(__dirname, reqUrl);
    const relative = path.relative(__dirname, filePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Access Denied');
      return;
    }
    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': CONTENT_TYPES[ext] || 'text/plain' });
      fs.createReadStream(filePath).pipe(res);
    });
    return;
  }

  let filePath = path.join(PUBLIC_DIR, reqUrl === '/' ? 'index.html' : reqUrl);
  const relative = path.relative(PUBLIC_DIR, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Access Denied');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': CONTENT_TYPES[ext] || 'text/plain' });
    fs.createReadStream(filePath).pipe(res);
  });
};

function createAppServer() {
  const server = http.createServer(handleRequest);
  server.requestTimeout = 120000;
  server.headersTimeout = 120000;
  server.keepAliveTimeout = 120000;
  return server;
}

if (require.main === module) {
  const server = createAppServer();
  server.listen(PORT, () => {
    console.log(`Implementation Risk Scanner server running on http://localhost:${PORT}`);
    console.log(`Active Provider: ${ANALYSIS_PROVIDER}`);
  });
}

module.exports = { createAppServer, handleRequest, deduplicateAndRemap };
