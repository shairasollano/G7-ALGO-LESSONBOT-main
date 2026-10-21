/** Health check — no secrets, no internals. */
import { Router } from "express";
import { providerStatus } from "../services/ai/index.js";

export const healthRouter = Router();

healthRouter.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    ai: providerStatus(),
    time: new Date().toISOString(),
  });
});
