class ApiError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(code, message, details) {
    return new ApiError(400, code, message, details);
  }

  static unauthorized(code = 'UNAUTHORIZED', message = 'Unauthorized') {
    return new ApiError(401, code, message);
  }

  static forbidden(code = 'FORBIDDEN', message = 'Forbidden') {
    return new ApiError(403, code, message);
  }

  static notFound(code = 'NOT_FOUND', message = 'Not found') {
    return new ApiError(404, code, message);
  }

  static conflict(code, message) {
    return new ApiError(409, code, message);
  }

  static tooMany(code = 'TOO_MANY', message = 'Too many requests') {
    return new ApiError(429, code, message);
  }

  static internal(code = 'INTERNAL', message = 'Internal server error') {
    return new ApiError(500, code, message);
  }

  static notImplemented(code = 'NOT_IMPLEMENTED', message = 'Not implemented') {
    return new ApiError(501, code, message);
  }

  static unavailable(code = 'UNAVAILABLE', message = 'Service temporarily unavailable') {
    return new ApiError(503, code, message);
  }
}

module.exports = { ApiError };