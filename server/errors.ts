import type { ContentfulStatusCode } from "hono/utils/http-status";

export type ApiErrorCode =
  | "BAD_REQUEST"
  | "INVALID_QUERY"
  | "NOT_FOUND"
  | "UPSTREAM_ERROR"
  | "INTERNAL_ERROR";

export type ErrorDetails = Record<string, unknown>;

export type ErrorEnvelope = {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: ErrorDetails;
  };
  requestId: string | null;
};

export class ApiError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: ApiErrorCode;
  readonly details?: ErrorDetails;

  constructor(
    status: ContentfulStatusCode,
    code: ApiErrorCode,
    message: string,
    details?: ErrorDetails,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function badRequest(
  message: string,
  details?: ErrorDetails,
  code: ApiErrorCode = "BAD_REQUEST"
): ApiError {
  return new ApiError(400, code, message, details);
}

export function notFound(message: string, details?: ErrorDetails): ApiError {
  return new ApiError(404, "NOT_FOUND", message, details);
}

export function upstreamError(message: string, details?: ErrorDetails): ApiError {
  return new ApiError(502, "UPSTREAM_ERROR", message, details);
}

export function internalError(message = "An unexpected internal error occurred"): ApiError {
  return new ApiError(500, "INTERNAL_ERROR", message);
}

export function formatErrorEnvelope(err: ApiError, requestId: string | null): ErrorEnvelope {
  const error: ErrorEnvelope["error"] = {
    code: err.code,
    message: err.message,
  };
  if (err.details !== undefined) {
    error.details = err.details;
  }
  return { error, requestId };
}
