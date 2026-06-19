'use strict';

const ERROR_TYPES = Object.freeze({
  INVALID_CLIENT_INPUT: 'invalid_client_input',
  REQUEST_ABORTED: 'request_aborted',
  PROVIDER_CONFIGURATION: 'provider_configuration_failure',
  PROVIDER_AUTHENTICATION: 'provider_authentication_failure',
  PROVIDER_RATE_LIMITED: 'provider_rate_limited',
  PROVIDER_UNAVAILABLE: 'provider_temporarily_unavailable',
  PROVIDER_TIMEOUT: 'provider_timeout',
  PROVIDER_SAFETY_BLOCKED: 'provider_safety_blocked',
  PROVIDER_EMPTY_RESPONSE: 'provider_empty_response',
  PROVIDER_INVALID_JSON: 'provider_invalid_json',
  DOMAIN_SCHEMA_VALIDATION: 'domain_schema_validation_failure',
  INTERNAL_ERROR: 'internal_error'
});

const DEFAULT_MESSAGES = Object.freeze({
  [ERROR_TYPES.INVALID_CLIENT_INPUT]: 'The analysis request is invalid.',
  [ERROR_TYPES.REQUEST_ABORTED]: 'The analysis request was cancelled.',
  [ERROR_TYPES.PROVIDER_CONFIGURATION]: 'The analysis provider is not configured correctly.',
  [ERROR_TYPES.PROVIDER_AUTHENTICATION]: 'The analysis provider could not authenticate.',
  [ERROR_TYPES.PROVIDER_RATE_LIMITED]: 'The analysis provider is rate limited. Try again later.',
  [ERROR_TYPES.PROVIDER_UNAVAILABLE]: 'The analysis provider is temporarily unavailable.',
  [ERROR_TYPES.PROVIDER_TIMEOUT]: 'The analysis provider did not respond before the deadline.',
  [ERROR_TYPES.PROVIDER_SAFETY_BLOCKED]: 'The analysis provider could not return a usable response for this material.',
  [ERROR_TYPES.PROVIDER_EMPTY_RESPONSE]: 'The analysis provider returned no usable analysis.',
  [ERROR_TYPES.PROVIDER_INVALID_JSON]: 'The analysis provider returned invalid structured output.',
  [ERROR_TYPES.DOMAIN_SCHEMA_VALIDATION]: 'The analysis provider returned output that failed application validation.',
  [ERROR_TYPES.INTERNAL_ERROR]: 'An unexpected server error occurred.'
});

const HTTP_STATUS = Object.freeze({
  [ERROR_TYPES.INVALID_CLIENT_INPUT]: 400,
  [ERROR_TYPES.REQUEST_ABORTED]: 499,
  [ERROR_TYPES.PROVIDER_CONFIGURATION]: 503,
  [ERROR_TYPES.PROVIDER_AUTHENTICATION]: 502,
  [ERROR_TYPES.PROVIDER_RATE_LIMITED]: 429,
  [ERROR_TYPES.PROVIDER_UNAVAILABLE]: 503,
  [ERROR_TYPES.PROVIDER_TIMEOUT]: 504,
  [ERROR_TYPES.PROVIDER_SAFETY_BLOCKED]: 422,
  [ERROR_TYPES.PROVIDER_EMPTY_RESPONSE]: 502,
  [ERROR_TYPES.PROVIDER_INVALID_JSON]: 502,
  [ERROR_TYPES.DOMAIN_SCHEMA_VALIDATION]: 502,
  [ERROR_TYPES.INTERNAL_ERROR]: 500
});

class AppError extends Error {
  constructor(type, options = {}) {
    super(options.message || DEFAULT_MESSAGES[type] || DEFAULT_MESSAGES[ERROR_TYPES.INTERNAL_ERROR]);
    this.name = 'AppError';
    this.type = type || ERROR_TYPES.INTERNAL_ERROR;
    this.statusCode = options.statusCode || HTTP_STATUS[this.type] || 500;
    this.retryable = Boolean(options.retryable);
    this.cause = options.cause;
    this.details = options.details || null;
  }
}

function normalizeError(error) {
  if (error instanceof AppError) return error;
  return new AppError(ERROR_TYPES.INTERNAL_ERROR, { cause: error });
}

module.exports = {
  ERROR_TYPES,
  DEFAULT_MESSAGES,
  HTTP_STATUS,
  AppError,
  normalizeError
};
