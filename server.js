'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const ValidationEngine = require('./lib/validation');
const { createGeminiProvider } = require('./lib/gemini-provider');
const { AppError, ERROR_TYPES, normalizeError } = require('./lib/provider-errors');

const PUBLIC_DIR = path.resolve(__dirname, 'public');
const FIXTURES_DIR = path.resolve(__dirname, 'tests', 'fixtures');
const CONFIG_PATH = path.resolve(__dirname, 'config.json');
const APP_VERSION = '0.2.0';
const VALID_FIXTURE_IDS = ['sales-marketing-conflict', 'ai-support-rollout', 'multi-location-operations'];
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml'
};

let appConfig;
try { appConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
catch (error) { console.error('Failed to load config.json:', error.message); process.exit(1); }

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function createRuntime(overrides = {}) {
  const analysisProvider = overrides.analysisProvider || process.env.ANALYSIS_PROVIDER || 'demo';
  const geminiApiKey = overrides.geminiApiKey !== undefined ? overrides.geminiApiKey : (process.env.GEMINI_API_KEY || '');
  const geminiModel = overrides.geminiModel || process.env.GEMINI_MODEL || 'gemini-3.5-flash';
  const overallTimeoutMs = parsePositiveInt(overrides.analysisTimeoutMs || process.env.ANALYSIS_TIMEOUT_MS, 90000);
  const runtime = {
    analysisProvider, geminiApiKey, geminiModel,
    antigravityAgentPath: overrides.antigravityAgentPath || process.env.ANTIGRAVITY_AGENT_PATH || '',
    antigravityBrainPath: overrides.antigravityBrainPath || process.env.ANTIGRAVITY_BRAIN_PATH || '',
    maxFileBytes: parsePositiveInt(overrides.maxFileBytes || process.env.MAX_FILE_BYTES, 5242880),
    maxSourceTextBytes: parsePositiveInt(overrides.maxSourceTextBytes || process.env.MAX_SOURCE_TEXT_BYTES, 750000),
    logger: overrides.logger || console,
    geminiProvider: overrides.geminiProvider || null
  };
  if (analysisProvider === 'gemini' && !runtime.geminiProvider && geminiApiKey) {
    runtime.geminiProvider = createGeminiProvider({
      appConfig, apiKey: geminiApiKey, model: geminiModel,
      maxAttempts: parsePositiveInt(overrides.geminiMaxAttempts || process.env.GEMINI_MAX_ATTEMPTS, 5),
      initialDelayMs: parsePositiveInt(overrides.geminiInitialDelayMs || process.env.GEMINI_INITIAL_DELAY_MS, 1000),
      backoffFactor: Number(overrides.geminiBackoffFactor || process.env.GEMINI_BACKOFF_FACTOR || 2),
      maxDelayMs: parsePositiveInt(overrides.geminiMaxDelayMs || process.env.GEMINI_MAX_DELAY_MS, 30000),
      attemptTimeoutMs: parsePositiveInt(overrides.geminiRequestTimeoutMs || process.env.GEMINI_REQUEST_TIMEOUT_MS, 30000),
      overallTimeoutMs, requestImpl: overrides.geminiRequestImpl, logger: runtime.logger
    });
  }
  return runtime;
}

function writeJson(res, statusCode, payload) {
  if (res.writableEnded || res.destroyed) return;
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function writeError(res, error) {
  const normalized = normalizeError(error);
  writeJson(res, normalized.statusCode, { error: normalized.message, errorType: normalized.type, retryable: normalized.retryable });
}

function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let completed = false;
    req.on('data', chunk => {
      if (completed) return;
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        completed = true;
        reject(new AppError(ERROR_TYPES.INVALID_CLIENT_INPUT, { statusCode: 413, message: 'Request payload exceeds maximum source text bytes limit.' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (completed) return;
      completed = true;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (error) { reject(new AppError(ERROR_TYPES.INVALID_CLIENT_INPUT, { message: 'Invalid JSON request payload.', cause: error })); }
    });
    req.on('aborted', () => {
      if (!completed) { completed = true; reject(new AppError(ERROR_TYPES.REQUEST_ABORTED)); }
    });
    req.on('error', error => {
      if (!completed) { completed = true; reject(error); }
    });
  });
}

function validateAnalyzePayload(payload, runtime) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new AppError(ERROR_TYPES.INVALID_CLIENT_INPUT, { message: 'Request payload must be a JSON object.' });
  }
  if (typeof payload.text !== 'string' || payload.text.trim() === '') {
    throw new AppError(ERROR_TYPES.INVALID_CLIENT_INPUT, { message: 'Request payload must contain document text.' });
  }
  if (Buffer.byteLength(payload.text, 'utf8') > runtime.maxSourceTextBytes) {
    throw new AppError(ERROR_TYPES.INVALID_CLIENT_INPUT, { statusCode: 413, message: 'Document text exceeds the maximum source text size.' });
  }
  return {
    text: payload.text.trim(),
    demoScenarioId: typeof payload.demoScenarioId === 'string' ? payload.demoScenarioId : null,
    analysisProfile: typeof payload.analysisProfile === 'string' ? payload.analysisProfile : 'general',
    projectName: typeof payload.projectName === 'string' ? payload.projectName : 'Untitled implementation'
  };
}

async function analyzeDemo(input) {
  if (!input.demoScenarioId) {
    throw new AppError(ERROR_TYPES.INVALID_CLIENT_INPUT, { message: 'Custom-document analysis becomes available when a live analysis provider is configured. Select one of the included demo scenarios to use deterministic demo mode.' });
  }
  if (!VALID_FIXTURE_IDS.includes(input.demoScenarioId)) {
    throw new AppError(ERROR_TYPES.INVALID_CLIENT_INPUT, { message: `Unsupported demo fixture ID: '${input.demoScenarioId}'. Available fixtures: ${VALID_FIXTURE_IDS.join(', ')}` });
  }
  try {
    const parsedResult = JSON.parse(await fs.promises.readFile(path.join(FIXTURES_DIR, `${input.demoScenarioId}.json`), 'utf8'));
    ValidationEngine.validateDomainSchema(parsedResult, appConfig);
    return {
      analysis: parsedResult,
      diagnostics: { provider: 'demo', model: 'deterministic-fixture', attemptCount: 1, retryCount: 0, durationMs: 0, normalizationActions: [] }
    };
  } catch (error) {
    throw new AppError(ERROR_TYPES.INTERNAL_ERROR, { message: 'The requested demo scenario could not be loaded.', cause: error });
  }
}

async function analyzeGemini(input, runtime, signal) {
  if (!runtime.geminiApiKey && !runtime.geminiProvider) {
    throw new AppError(ERROR_TYPES.PROVIDER_CONFIGURATION, { message: 'Gemini analysis is enabled but its server credential is not configured.' });
  }
  if (!runtime.geminiProvider || typeof runtime.geminiProvider.analyze !== 'function') {
    throw new AppError(ERROR_TYPES.PROVIDER_CONFIGURATION);
  }
  const result = await runtime.geminiProvider.analyze(input, signal);
  try { ValidationEngine.validateDomainSchema(result.analysis, appConfig); }
  catch (error) { throw new AppError(ERROR_TYPES.DOMAIN_SCHEMA_VALIDATION, { cause: error }); }
  return result;
}

async function handleAnalyze(req, res, runtime) {
  const abortController = new AbortController();
  const abortOnDisconnect = () => { if (!res.writableEnded) abortController.abort(); };
  req.once('aborted', abortOnDisconnect);
  res.once('close', abortOnDisconnect);
  try {
    const input = validateAnalyzePayload(await readJsonBody(req, runtime.maxSourceTextBytes + 8192), runtime);
    let result;
    if (runtime.analysisProvider === 'demo') result = await analyzeDemo(input);
    else if (runtime.analysisProvider === 'gemini') result = await analyzeGemini(input, runtime, abortController.signal);
    else if (runtime.analysisProvider === 'antigravity') {
      throw new AppError(ERROR_TYPES.PROVIDER_CONFIGURATION, { message: 'The Antigravity provider is configured but not implemented.' });
    } else {
      throw new AppError(ERROR_TYPES.PROVIDER_CONFIGURATION, { message: `Unsupported analysis provider '${runtime.analysisProvider}'.` });
    }
    writeJson(res, 200, { analysisId: `${runtime.analysisProvider}-${Date.now()}`, ...result.analysis, providerDiagnostics: result.diagnostics });
  } catch (error) {
    if (error instanceof AppError && error.type === ERROR_TYPES.REQUEST_ABORTED) return;
    runtime.logger.error(JSON.stringify({ event: 'analysis_request_failed', provider: runtime.analysisProvider, errorType: error instanceof AppError ? error.type : ERROR_TYPES.INTERNAL_ERROR }));
    writeError(res, error);
  } finally {
    req.removeListener('aborted', abortOnDisconnect);
    res.removeListener('close', abortOnDisconnect);
  }
}

function serveFile(res, filePath, rootDir) {
  const relative = path.relative(rootDir, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Access Denied');
    return;
  }
  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': CONTENT_TYPES[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  });
}

function handleRequest(req, res, runtime = createRuntime()) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method === 'GET' && req.url === '/api/health') {
    writeJson(res, 200, {
      status: 'healthy', activeProvider: runtime.analysisProvider,
      providerAvailability: {
        demo: true,
        gemini: Boolean(runtime.geminiApiKey || runtime.geminiProvider),
        antigravity: Boolean(runtime.antigravityAgentPath && runtime.antigravityBrainPath)
      },
      model: runtime.analysisProvider === 'gemini' ? runtime.geminiModel : null,
      version: APP_VERSION
    });
    return;
  }
  if (req.method === 'POST' && req.url === '/api/analyze') { handleAnalyze(req, res, runtime); return; }
  const reqUrl = req.url.split('?')[0];
  if (req.method === 'GET' && reqUrl === '/config.json') { serveFile(res, CONFIG_PATH, __dirname); return; }
  if (reqUrl.startsWith('/lib/')) { serveFile(res, path.join(__dirname, reqUrl), __dirname); return; }
  serveFile(res, path.join(PUBLIC_DIR, reqUrl === '/' ? 'index.html' : reqUrl), PUBLIC_DIR);
}

function createAppServer(options = {}) {
  const runtime = createRuntime(options);
  return http.createServer((req, res) => handleRequest(req, res, runtime));
}

if (require.main === module) {
  const port = parsePositiveInt(process.env.PORT, 3050);
  const server = createAppServer();
  server.listen(port, () => {
    console.log(`Implementation Risk Scanner server running on http://localhost:${port}`);
    console.log(`Active Provider: ${process.env.ANALYSIS_PROVIDER || 'demo'}`);
  });
}

module.exports = { APP_VERSION, VALID_FIXTURE_IDS, createRuntime, createAppServer, handleRequest, validateAnalyzePayload, analyzeDemo, analyzeGemini };
