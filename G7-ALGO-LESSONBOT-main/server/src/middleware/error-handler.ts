/**
 * Centralized error handling: consistent error envelopes, no stack traces or
 * secrets in production, mapped HTTP statuses.
 */
import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { ValidationError } from "../services/algorithms/graph-utils.js";

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    error: {
      code: "not_found",
      message: `No route matches ${req.method} ${req.path}.`,
    },
  });
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "validation_error",
        message: "The request failed validation.",
        details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
    });
    return;
  }
  if (err instanceof ValidationError) {
    const status = err.code === "unsupported_algorithm" ? 400 : 422;
    res.status(status).json({
      error: {
        code: err.code,
        message: err.message,
      },
    });
    return;
  }
  if (err instanceof SyntaxError && "body" in err) {
    res.status(400).json({
      error: { code: "invalid_json", message: "The request body is not valid JSON." },
    });
    return;
  }
  // Never leak internals (stack traces, provider errors) to the client.
  // eslint-disable-next-line no-console
  console.error(`[error] ${req.method} ${req.path}:`, err instanceof Error ? err.message : err);
  res.status(500).json({
    error: {
      code: "internal_error",
      message: "Something went wrong on the server. Please try again.",
    },
  });
}
