/**
 * Solver registry: maps supported algorithm IDs to their deterministic
 * implementations. All solvers validate input and return full traces.
 */
import type { SolverResult } from "../../../../shared/contract.js";
import { solveReduction } from "./reduction-solver.js";
import { solveVertexCover } from "./vertex-cover-solver.js";
import { solveCookLevin } from "./cook-levin-solver.js";
import { solveMaxCut } from "./max-cut-solver.js";

export interface SolverInfo {
  id: string;
  name: string;
  topicId: string;
  description: string;
  inputSchema: Record<string, string>;
}

export const solvers: Record<string, { info: SolverInfo; solve: (input: unknown) => SolverResult }> = {
  "reduction-is-to-vc": {
    info: {
      id: "reduction-is-to-vc",
      name: "Independent Set ≤p Vertex Cover",
      topicId: "formal-reductions",
      description: "Applies f(G, k) = (G, n − k) and verifies the complement duality on the given graph.",
      inputSchema: { vertices: "string[]", edges: "[string, string][]", k: "integer 0..n" },
    },
    solve: solveReduction,
  },
  "vertex-cover-2approx": {
    info: {
      id: "vertex-cover-2approx",
      name: "2-Approximation Vertex Cover",
      topicId: "approximation-algorithms",
      description: "Repeatedly covers an uncovered edge with both endpoints; traces each step and the matching guarantee.",
      inputSchema: { vertices: "string[]", edges: "[string, string][]" },
    },
    solve: solveVertexCover,
  },
  "cook-levin-tableau": {
    info: {
      id: "cook-levin-tableau",
      name: "Cook–Levin Tableau Encoding (bounded)",
      topicId: "cook-levin",
      description: "Builds the genuine CNF encoding (variables + clauses) for one fixed tiny machine and step bound. Bounded illustration, not a general translator.",
      inputSchema: { machine: "CookLevinMachine", input: "string (1–4 symbols)", steps: "integer 1–5" },
    },
    solve: solveCookLevin,
  },
  "randomized-max-cut": {
    info: {
      id: "randomized-max-cut",
      name: "Randomized Max-Cut (seeded)",
      topicId: "randomized-algorithms",
      description: "Seeded coin-flip trials; records each assignment, cut edges, running statistics, and the theoretical expectation.",
      inputSchema: { vertices: "string[]", edges: "[string, string][]", seed: "integer 0..2^32-1", trials: "integer 1–50" },
    },
    solve: solveMaxCut,
  },
};

export function listSolvers(): SolverInfo[] {
  return Object.values(solvers).map((s) => s.info);
}

export function runSolver(algorithmId: string, input: unknown): SolverResult {
  const solver = solvers[algorithmId];
  if (!solver) {
    const { ValidationError } = require_ValidationError();
    throw new ValidationError(
      "unsupported_algorithm",
      `Unsupported algorithm "${algorithmId}". Supported: ${Object.keys(solvers).join(", ")}.`,
    );
  }
  return solver.solve(input);
}

// Local indirection to keep the import graph acyclic and explicit.
import { ValidationError } from "./graph-utils.js";
function require_ValidationError() {
  return { ValidationError };
}
