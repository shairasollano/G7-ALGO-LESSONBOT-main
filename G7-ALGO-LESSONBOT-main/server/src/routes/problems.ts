/** Problem solving route — deterministic solvers only. */
import { Router } from "express";
import { solveRequestSchema } from "../schemas/index.js";
import { runSolver } from "../services/algorithms/registry.js";

export const problemsRouter = Router();

problemsRouter.post("/api/problems/solve", (req, res, next) => {
  try {
    const body = solveRequestSchema.parse(req.body);
    const result = runSolver(body.algorithmId, body.input);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
