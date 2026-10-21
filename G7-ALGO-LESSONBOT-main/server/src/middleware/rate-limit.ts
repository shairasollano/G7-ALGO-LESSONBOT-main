/**
 * Small in-memory sliding-window rate limiter for AI routes.
 * Per-IP, fixed window. Adequate for a single-process MVP; a multi-instance
 * deployment would swap this for a shared store (still no database required
 * for the MVP itself).
 */
import type { NextFunction, Request, Response } from "express";

interface Bucket {
  count: number;
  resetAt: number;
}

export function rateLimiter(windowMs: number, maxRequests: number) {
  const buckets = new Map<string, Bucket>();

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = req.ip ?? "unknown";
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > maxRequests) {
      res.status(429).json({
        error: {
          code: "rate_limited",
          message: "Too many requests to the AI tutor. Please wait a moment and try again.",
        },
      });
      return;
    }
    next();
  };
}
