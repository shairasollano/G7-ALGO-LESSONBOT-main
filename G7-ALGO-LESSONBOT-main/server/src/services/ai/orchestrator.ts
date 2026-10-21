/**
 * Gemini-driven conversation orchestration.
 *
 * Separation of responsibilities (brief §Core):
 *   A. This module: conversation understanding + planning. The model proposes
 *      intent/topic/tool on every turn; nothing here trusts that proposal
 *      blindly — every plan and every tool argument is re-validated with Zod
 *      against an allowlist before anything runs.
 *   B. Deterministic solvers: ALL computation. A validated plan may point at a
 *      solver; it can never inject executable code or bypass input validation.
 *   C. Explanation: the model composes prose AFTER verified results exist and
 *      is instructing not to contradict them.
 *   D. Frontend rendering stays passive: it receives validated blocks only.
 *
 * The planning call uses the SDK's structured JSON output (responseMimeType +
 * responseSchema) and is validated with Zod. Model-invented graph markup is
 * never rendered: at most the plan selects which curated/solver data to show.
 */
import { z } from "zod";
import type { SolverResult } from "../../../../shared/contract.js";
import { runSolver } from "../algorithms/registry.js";
import { curatedExamples } from "../algorithms/curated-examples.js";
import { ValidationError, validateGraph } from "../algorithms/graph-utils.js";
import { TOPIC_IDS } from "./topic-detection.js";

// ---------------------------------------------------------------------------
// Allowlisted tools — the only non-language actions the model can request.
// Adapted to the existing deterministic solver registry; no arbitrary code.
// ---------------------------------------------------------------------------

export const TUTOR_TOOLS = [
  "run_vertex_cover_approximation",
  "run_randomized_max_cut",
  "run_reduction_example",
  "build_cook_levin_tableau",
  "generate_practice_question",
] as const;
export type TutorTool = (typeof TUTOR_TOOLS)[number];

export const PLANNER_INTENTS = [
  "explanation",
  "proof",
  "example",
  "algorithm_run",
  "visualization",
  "comparison",
  "quiz",
  "clarification",
] as const;
export type PlannerIntent = (typeof PLANNER_INTENTS)[number];

export const PRESENTATIONS = ["text", "graph", "trace", "table", "combo"] as const;
export type Presentation = (typeof PRESENTATIONS)[number];

export interface TutorPlan {
  intent: PlannerIntent;
  topicId: string | null;
  tool: TutorTool | null;
  toolInput: Record<string, unknown> | null;
  presentation: Presentation;
  clarify: string | null;
}

export interface PlanFailure {
  reason: string;
}

/**
 * Schema-shaped contract sent to the model. toolInput stays a free object at
 * the wire level — it is tightly re-validated per tool below, where a catch-all
 * can never hide executable content (values are strings/numbers only).
 */
export const PLAN_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    intent: { type: "string", enum: [...PLANNER_INTENTS] },
    topicId: { type: "string", enum: [...TOPIC_IDS], nullable: true },
    tool: { type: "string", enum: [...TUTOR_TOOLS], nullable: true },
    toolInput: {
      type: "object",
      properties: {
        vertices: { type: "array", items: { type: "string" }, nullable: true },
        edges: {
          type: "array",
          items: { type: "array", items: { type: "string" }, nullable: true },
          nullable: true,
        },
        k: { type: "number", nullable: true },
        seed: { type: "number", nullable: true },
        trials: { type: "number", nullable: true },
        steps: { type: "number", nullable: true },
      },
      nullable: true,
    },
    presentation: { type: "string", enum: [...PRESENTATIONS], nullable: true },
    clarify: { type: "string", nullable: true },
  },
  required: ["intent"],
} as const;

const planSchema = z.object({
  intent: z.enum(PLANNER_INTENTS),
  topicId: z.string().nullable().optional(),
  tool: z.enum(TUTOR_TOOLS).nullable().optional(),
  toolInput: z.record(z.string(), z.unknown()).nullable().optional(),
  presentation: z.enum(PRESENTATIONS).nullable().optional(),
  clarify: z.string().max(400).nullable().optional(),
});

/**
 * OpenAI function-tool wrapper mirroring PLAN_RESPONSE_SCHEMA. The plan shape
 * is identical; only the wire format differs (JSON Schema without the
 * GenAI-specific `nullable` keyword — fields are simply optional).
 */
export const PLAN_TOOL_NAME = "submit_plan";
export const PLAN_TOOL_SCHEMA = {
  type: "function",
  function: {
    name: PLAN_TOOL_NAME,
    description: "Submit the conversation plan as a strict JSON object matching the schema.",
    parameters: {
      type: "object",
      properties: {
        intent: { type: "string", enum: [...PLANNER_INTENTS] },
        topicId: { type: "string", enum: [...TOPIC_IDS] },
        tool: { type: "string", enum: [...TUTOR_TOOLS] },
        toolInput: {
          type: "object",
          properties: {
            vertices: { type: "array", items: { type: "string" } },
            edges: { type: "array", items: { type: "array", items: { type: "string" } } },
            k: { type: "number" },
            seed: { type: "number" },
            trials: { type: "number" },
            steps: { type: "number" },
          },
        },
        presentation: { type: "string", enum: [...PRESENTATIONS] },
        clarify: { type: "string" },
      },
      required: ["intent"],
    },
  },
} as const;

/** Normalize/validate one raw model plan; falsy on rejection. */
export function validatePlan(raw: unknown): TutorPlan | null {
  const parsed = planSchema.safeParse(raw);
  if (!parsed.success) return null;
  const p = parsed.data;
  const topicId =
    p.topicId && (TOPIC_IDS as string[]).includes(p.topicId) ? p.topicId : null;
  return {
    intent: p.intent,
    topicId,
    tool: p.tool ?? null,
    toolInput: p.toolInput && typeof p.toolInput === "object" ? p.toolInput : null,
    presentation: p.presentation ?? "text",
    clarify: p.clarify ?? null,
  };
}

// ---------------------------------------------------------------------------
// Tool input validation — exact per-tool schemas, numeric/string only.
// ---------------------------------------------------------------------------

const vertexId = z.string().min(1).max(16).regex(/^[A-Za-z0-9_]+$/, "vertex id must be alphanumeric");
const graphInput = z.object({
  vertices: z.array(vertexId).min(2).max(24),
  edges: z.array(z.tuple([vertexId, vertexId])).min(1).max(120),
});

const toolInputSchema: Record<TutorTool, z.ZodTypeAny> = {
  "run_vertex_cover_approximation": graphInput,
  "run_randomized_max_cut": graphInput.extend({
    seed: z.number().int().min(0).max(2 ** 31 - 1).nullable().optional(),
    trials: z.number().int().min(1).max(50).nullable().optional(),
  }),
  "run_reduction_example": graphInput.extend({ k: z.number().int().min(0).max(24) }),
  // The tableau machine is a large reviewed structure; the model cannot
  // legitimately reproduce it, so the canonical curated instance is used and
  // only the step count is model-selectable (still bounded).
  "build_cook_levin_tableau": z.object({
    steps: z.number().int().min(1).max(5).nullable().optional(),
  }).passthrough(),
  "generate_practice_question": z.object({}).passthrough(),
};

/** Solver id per tool, matching the deterministic registry. */
const TOOL_SOLVER: Record<TutorTool, string> = {
  "run_vertex_cover_approximation": "vertex-cover-2approx",
  "run_randomized_max_cut": "randomized-max-cut",
  "run_reduction_example": "reduction-is-to-vc",
  "build_cook_levin_tableau": "cook-levin-tableau",
  "generate_practice_question": "",
};

export interface PlanToolExecution {
  computation: SolverResult;
  /** True when model input was rejected and the canonical instance was used. */
  usedCuratedInput: boolean;
  inputWarning?: string;
}

/**
 * Validate the plan's tool arguments and run the deterministic solver.
 * Validate tool args; on invalid model input, substitute the curated example
 * for that solver (never silent invention). Quiz needs no solver.
 */
export function executePlanTool(plan: TutorPlan): PlanToolExecution | undefined {
  if (!plan.tool || plan.tool === "generate_practice_question") return undefined;
  const solverId = TOOL_SOLVER[plan.tool];
  let input: Record<string, unknown> | undefined;
  let usedCuratedInput = false;
  let inputWarning: string | undefined;

  const raw = plan.toolInput ?? {};
  const candidate = sanitizeToolInput(plan.tool, raw);
  const parsed = toolInputSchema[plan.tool].safeParse(candidate);
  if (parsed.success) {
    input = parsed.data as Record<string, unknown>;
    // Graph-shaped inputs additionally pass the shared structural validation.
    const graph = graphInput.safeParse({ vertices: input.vertices, edges: input.edges });
    if (graph.success) {
      try {
        validateGraph(graph.data.vertices, graph.data.edges);
      } catch (err) {
        input = undefined;
        inputWarning = err instanceof ValidationError ? `${err.code}: ${err.message}` : "invalid graph";
      }
    }
  } else {
    input = undefined;
    inputWarning = "model tool arguments failed validation";
  }

  if (input === undefined) {
    // Canonical fallback input: reviewed, deterministic, always valid.
    const example = curatedExamples.find((e) => e.solverId === solverId);
    if (!example) return undefined;
    input =
      plan.tool === "build_cook_levin_tableau" && typeof candidate.steps === "number" && Number.isInteger(candidate.steps) && candidate.steps >= 1 && candidate.steps <= 5
        ? { ...example.input, steps: candidate.steps }
        : example.input;
    usedCuratedInput = true;
  }

  try {
    const computation = runSolver(solverId, input);
    return { computation, usedCuratedInput, inputWarning };
  } catch {
    // Even validated input can break solver-local invariants; use the
    // canonical instance rather than failing the whole turn.
    const example = curatedExamples.find((e) => e.solverId === solverId);
    if (!example) return undefined;
    return { computation: runSolver(solverId, example.input), usedCuratedInput: true, inputWarning: inputWarning ?? "solver rejected processed input" };
  }
}

function sanitizeToolInput(tool: TutorTool, raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (raw.vertices !== undefined) {
    out.vertices = z.array(z.string()).catch([]).parse(raw.vertices);
  }
  if (raw.edges !== undefined) {
    const edges = z.array(z.unknown()).catch([]).parse(raw.edges);
    out.edges = edges
      .map((e) => (Array.isArray(e) && e.length === 2 ? [e[0], e[1]] : null))
      .filter((e): e is [unknown, unknown] => e !== null);
  }
  for (const key of ["k", "seed", "trials", "steps"] as const) {
    if (raw[key] !== undefined) {
      const num = typeof raw[key] === "number" ? raw[key] : Number(raw[key]);
      if (Number.isFinite(num)) out[key] = num;
    }
  }
  if (tool === "generate_practice_question") return {};
  return out;
}

/** Compact, prompt-ready summary of a verified computation. */
export function summarizeComputation(computation: SolverResult): string {
  return JSON.stringify({
    algorithm: computation.algorithmName,
    result: computation.result,
    guarantee: computation.guarantee,
    complexity: computation.complexity,
    ...(computation.seed !== undefined ? { seed: computation.seed } : {}),
    ...(computation.warnings?.length ? { warnings: computation.warnings } : {}),
  });
}
