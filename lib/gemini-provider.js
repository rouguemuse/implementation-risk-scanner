'use strict';

const https = require('https');
const { createAnalysisResponseSchema, SCHEMA_VERSION } = require('./analysis-schema');
const { SYSTEM_INSTRUCTION, buildUserPrompt, PROMPT_TEMPLATE_VERSION } = require('./analysis-prompt');
const { AppError, ERROR_TYPES } = require('./provider-errors');

const RETRYABLE_HTTP_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const TRANSIENT_NETWORK_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENETDOWN', 'ENETUNREACH',
  'ENOTFOUND', 'EPIPE', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'
]);
const MAX_PROVIDER_RESPONSE_BYTES = 5 * 1024 * 1024;

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toPositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseRetryAfter(value) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const dateMs = Date.parse(value);
  if (Number.isNaN(dateMs)) return 0;
  return Math.max(0, dateMs - Date.now());
}

function getRetryDelayMs(attemptNumber, config, retryAfterHeader) {
  const exponent = Math.max(0, attemptNumber - 1);
  const bounded = Math.min(config.maxDelayMs, config.initialDelayMs * Math.pow(config.backoffFactor, exponent));
  const fullJitter = Math.floor(Math.random() * (bounded + 1));
  return Math.max(fullJitter, parseRetryAfter(retryAfterHeader));
}

function sleep(ms, signal) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(new AppError(ERROR_TYPES.REQUEST_ABORTED));
    const timer = setTimeout(() => { cleanup(); resolve(); }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(new AppError(ERROR_TYPES.REQUEST_ABORTED));
    };
    const cleanup = () => { if (signal) signal.removeEventListener('abort', onAbort); };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

function requestJson({ url, headers, body, timeoutMs, signal }) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(new AppError(ERROR_TYPES.REQUEST_ABORTED));
    const payload = JSON.stringify(body);
    const request = https.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...headers }
    });
    let settled = false;
    let timeout;
    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      if (signal) signal.removeEventListener('abort', onAbort);
    };
    const finishReject = error => { if (!settled) { settled = true; cleanup(); reject(error); } };
    const finishResolve = value => { if (!settled) { settled = true; cleanup(); resolve(value); } };
    const onAbort = () => request.destroy(new AppError(ERROR_TYPES.REQUEST_ABORTED));

    timeout = setTimeout(() => {
      const error = new Error('Provider request timed out.');
      error.code = 'ETIMEDOUT';
      request.destroy(error);
    }, timeoutMs);
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    request.on('response', response => {
      const chunks = [];
      let totalBytes = 0;
      response.on('data', chunk => {
        totalBytes += chunk.length;
        if (totalBytes > MAX_PROVIDER_RESPONSE_BYTES) {
          const error = new Error('Provider response exceeded safety limit.');
          error.code = 'ERESPONSETOOLARGE';
          response.destroy(error);
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => finishResolve({
        statusCode: response.statusCode || 0,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8')
      }));
      response.on('error', finishReject);
    });
    request.on('error', finishReject);
    request.write(payload);
    request.end();
  });
}

function extractCandidateText(providerPayload) {
  const blockReason = providerPayload && providerPayload.promptFeedback && providerPayload.promptFeedback.blockReason;
  if (blockReason) throw new AppError(ERROR_TYPES.PROVIDER_SAFETY_BLOCKED, { details: { blockReason: String(blockReason) } });
  const candidate = providerPayload && Array.isArray(providerPayload.candidates) ? providerPayload.candidates[0] : null;
  if (!candidate) throw new AppError(ERROR_TYPES.PROVIDER_EMPTY_RESPONSE);
  const finishReason = String(candidate.finishReason || '').toUpperCase();
  if (['SAFETY', 'BLOCKLIST', 'PROHIBITED_CONTENT'].includes(finishReason)) {
    throw new AppError(ERROR_TYPES.PROVIDER_SAFETY_BLOCKED, { details: { finishReason } });
  }
  const parts = candidate.content && Array.isArray(candidate.content.parts) ? candidate.content.parts : [];
  const text = parts.filter(part => part && typeof part.text === 'string').map(part => part.text).join('').trim();
  if (!text) throw new AppError(ERROR_TYPES.PROVIDER_EMPTY_RESPONSE, { details: { finishReason: finishReason || 'UNKNOWN' } });
  return text;
}

function mapHttpFailure(statusCode, providerPayload) {
  if (statusCode === 401 || statusCode === 403) return new AppError(ERROR_TYPES.PROVIDER_AUTHENTICATION);
  if (statusCode === 429) return new AppError(ERROR_TYPES.PROVIDER_RATE_LIMITED, { retryable: true });
  if (statusCode === 408 || statusCode >= 500) return new AppError(ERROR_TYPES.PROVIDER_UNAVAILABLE, { retryable: true });
  if (statusCode === 400 || statusCode === 404) {
    return new AppError(ERROR_TYPES.PROVIDER_CONFIGURATION, {
      details: { providerCode: providerPayload && providerPayload.error && providerPayload.error.status ? String(providerPayload.error.status) : null }
    });
  }
  return new AppError(ERROR_TYPES.PROVIDER_UNAVAILABLE, { retryable: false, details: { statusCode } });
}

function mapNetworkFailure(error) {
  if (error instanceof AppError) return error;
  if (error && error.code === 'ETIMEDOUT') return new AppError(ERROR_TYPES.PROVIDER_TIMEOUT, { retryable: true, cause: error });
  if (error && TRANSIENT_NETWORK_CODES.has(error.code)) return new AppError(ERROR_TYPES.PROVIDER_UNAVAILABLE, { retryable: true, cause: error });
  return new AppError(ERROR_TYPES.PROVIDER_UNAVAILABLE, { cause: error });
}

function parseProviderEnvelope(rawBody) {
  try { return JSON.parse(rawBody); }
  catch (error) { throw new AppError(ERROR_TYPES.PROVIDER_INVALID_JSON, { cause: error }); }
}

function parseStructuredAnalysis(text) {
  try { return JSON.parse(text); }
  catch (error) { throw new AppError(ERROR_TYPES.PROVIDER_INVALID_JSON, { cause: error }); }
}

function createGeminiProvider(options) {
  const appConfig = options.appConfig;
  const apiKey = options.apiKey || '';
  const model = options.model || 'gemini-3.5-flash';
  const requestImpl = options.requestImpl || requestJson;
  const logger = options.logger || console;
  const retryConfig = {
    maxAttempts: toPositiveInt(options.maxAttempts, 5),
    initialDelayMs: toPositiveInt(options.initialDelayMs, 1000),
    backoffFactor: toPositiveNumber(options.backoffFactor, 2),
    maxDelayMs: toPositiveInt(options.maxDelayMs, 30000),
    attemptTimeoutMs: toPositiveInt(options.attemptTimeoutMs, 30000),
    overallTimeoutMs: toPositiveInt(options.overallTimeoutMs, 90000)
  };
  if (!apiKey) throw new AppError(ERROR_TYPES.PROVIDER_CONFIGURATION, { message: 'Gemini analysis is enabled but GEMINI_API_KEY is not configured.' });

  const responseJsonSchema = createAnalysisResponseSchema(appConfig);
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  async function analyze(input, externalSignal) {
    const startedAt = Date.now();
    const deadline = startedAt + retryConfig.overallTimeoutMs;
    let attemptCount = 0;
    let retryCount = 0;
    let lastError = null;
    const requestBody = {
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      contents: [{ role: 'user', parts: [{ text: buildUserPrompt(input) }] }],
      generationConfig: {
        responseMimeType: 'application/json', responseJsonSchema,
        temperature: 0.2, topP: 0.8, candidateCount: 1, maxOutputTokens: 8192
      }
    };

    while (attemptCount < retryConfig.maxAttempts) {
      if (externalSignal && externalSignal.aborted) throw new AppError(ERROR_TYPES.REQUEST_ABORTED);
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) throw new AppError(ERROR_TYPES.PROVIDER_TIMEOUT, { cause: lastError });
      attemptCount += 1;
      try {
        const response = await requestImpl({
          url: endpoint,
          headers: { 'x-goog-api-key': apiKey },
          body: requestBody,
          timeoutMs: Math.min(retryConfig.attemptTimeoutMs, remainingMs),
          signal: externalSignal
        });
        let providerPayload = null;
        try { providerPayload = parseProviderEnvelope(response.body); }
        catch (error) { if (response.statusCode >= 200 && response.statusCode < 300) throw error; }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          const httpError = mapHttpFailure(response.statusCode, providerPayload);
          if (!RETRYABLE_HTTP_STATUSES.has(response.statusCode)) httpError.retryable = false;
          httpError.retryAfter = response.headers && response.headers['retry-after'];
          throw httpError;
        }
        const analysis = parseStructuredAnalysis(extractCandidateText(providerPayload));
        const durationMs = Date.now() - startedAt;
        logger.info(JSON.stringify({ event: 'gemini_analysis_complete', provider: 'gemini', model, attemptCount, retryCount, durationMs, outcome: 'success' }));
        return {
          analysis,
          diagnostics: {
            provider: 'gemini', model, promptTemplateVersion: PROMPT_TEMPLATE_VERSION,
            schemaVersion: SCHEMA_VERSION, attemptCount, retryCount, durationMs,
            normalizationActions: []
          }
        };
      } catch (error) {
        const mapped = error instanceof AppError ? error : mapNetworkFailure(error);
        lastError = mapped;
        if (mapped.type === ERROR_TYPES.REQUEST_ABORTED) throw mapped;
        if (!(mapped.retryable && attemptCount < retryConfig.maxAttempts)) {
          logger.warn(JSON.stringify({ event: 'gemini_analysis_complete', provider: 'gemini', model, attemptCount, retryCount, durationMs: Date.now() - startedAt, outcome: mapped.type }));
          throw mapped;
        }
        retryCount += 1;
        const delayMs = getRetryDelayMs(attemptCount, retryConfig, mapped.retryAfter || null);
        if (Date.now() + delayMs >= deadline) throw new AppError(ERROR_TYPES.PROVIDER_TIMEOUT, { cause: mapped });
        await sleep(delayMs, externalSignal);
      }
    }
    throw lastError || new AppError(ERROR_TYPES.PROVIDER_UNAVAILABLE);
  }

  return { analyze, model, promptTemplateVersion: PROMPT_TEMPLATE_VERSION, schemaVersion: SCHEMA_VERSION, retryConfig };
}

module.exports = {
  RETRYABLE_HTTP_STATUSES,
  TRANSIENT_NETWORK_CODES,
  parseRetryAfter,
  getRetryDelayMs,
  extractCandidateText,
  parseStructuredAnalysis,
  requestJson,
  createGeminiProvider
};
