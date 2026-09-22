class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.isApiError = true;
  }

  static badRequest(msg) {
    return new ApiError(400, msg);
  }
  static unathorized(msg = "Unauthorized") {
    return new ApiError(401, msg);
  }
  static forbidden(msg = "forbidden") {
    return new ApiError(403, msg);
  }
  static notFound(msg = "Not Found") {
    return new ApiError(404, msg);
  }
  static conflit(msg) {
    return new ApiError(409, msg);
  }
}

module.exports = ApiError;