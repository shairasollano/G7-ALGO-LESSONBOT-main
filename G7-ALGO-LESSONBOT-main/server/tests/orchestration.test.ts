/**
 * Orchestration tests: plan validation, allowlisted tool execution with
 * per-tool argument validation, topic detection, curated action
 * availability, and the planless-degrade path.
 *
 * No network here: Gemini behavior is covered by mocked tests in
 * streaming.test.ts and live verification in the Phase 8 run.
 */
import { describe, expect, it } from "vitest";
import {
  executePlanTool,
  validatePlan,
  TUTOR_TOOLS,
} from "../src/services/ai/orchestrator.js";
import { detectTopicId, isTopicId } from "../src/services/ai/topic-detection.js";
import { availableCuratedActions } from "../src/services/ai/curated-fallback.js";

const GRAPH = {
  vertices: ["A", "B", "C", "D"],
  edges: [
    ["A", "B"],
    ["B", "C"],
    ["C", "D"],
  ],
};

describe("plan validation", () => {
  it("accepts a valid full plan", () => {
    const plan = validatePlan({
      intent: "algorithm_run",
      topicId: "randomized-algorithms",
      tool: "run_randomized_max_cut",
      toolInput: { vertices: ["A", "B"], edges: [["A", "B"]] },
      presentation: "combo",
      clarify: null,
    });
    expect(plan).not.toBeNull();
    expect(plan?.tool).toBe("run_randomized_max_cut");
  });

  it("rejects unknown intents and tools (model cannot invent actions)", () => {
    expect(validatePlan({ intent: "hack_server" })).toBeNull();
    expect(
      validatePlan({ intent: "algorithm_run", tool: "run_arbitrary_code" }),
    ).toBeNull();
    expect(validatePlan({ intent: "algorithm_run", tool: "eval" })).toBeNull();
  });

  it("maps out-of-list topic ids to null instead of trusting them", () => {
    const plan = validatePlan({ intent: "explanation", topicId: "../private/data" });
    expect(plan).not.toBeNull();
    expect(plan?.topicId).toBeNull();
  });

  it("rejects non-object plans outright", () => {
    expect(validatePlan("run everything")).toBeNull();
    expect(validatePlan(null)).toBeNull();
  });
});

describe("tool execution", () => {
  it("runs the Max-Cut solver with valid model-provided input", () => {
    const plan = validatePlan({
      intent: "algorithm_run",
      tool: "run_randomized_max_cut",
      toolInput: { ...GRAPH, seed: 42, trials: 5 },
    })!;
    const executed = executePlanTool(plan);
    expect(executed).toBeDefined();
    expect(executed?.computation.algorithmId).toBe("randomized-max-cut");
    expect(executed?.usedCuratedInput).toBe(false);
  });

  it("trips to the canonical instance when model input is invalid", () => {
    const plan = validatePlan({
      intent: "algorithm_run",
      tool: "run_vertex_cover_approximation",
      toolInput: { vertices: ["A"], edges: [["A", "not-in-list"]] },
    })!;
    const executed = executePlanTool(plan);
    expect(executed).toBeDefined();
    // The solver output must come from the canonical reviewed instance.
    expect(executed?.usedCuratedInput).toBe(true);
    expect(executed?.inputWarning).toBeTruthy();
  });

  it("rejects executable-looking toolInput payloads (strings/numbers only)", () => {
    const plan = validatePlan({
      intent: "algorithm_run",
      tool: "run_reduction_example",
      toolInput: { ...GRAPH, k: 1, exec: "process.exit(0)" },
    })!;
    const executed = executePlanTool(plan);
    expect(executed).toBeDefined();
    expect(executed?.usedCuratedInput).toBe(false);
  });

  it("the tableau tool only accepts a bounded step count", () => {
    const plan = validatePlan({
      intent: "algorithm_run",
      tool: "build_cook_levin_tableau",
      toolInput: { steps: 3 },
    })!;
    const executed = executePlanTool(plan);
    expect(executed?.computation.algorithmId).toBe("cook-levin-tableau");
  });

  it("treats out-of-range steps as a canonical-instance request", () => {
    const plan = validatePlan({
      intent: "algorithm_run",
      tool: "build_cook_levin_tableau",
      toolInput: { steps: 99 },
    })!;
    const executed = executePlanTool(plan);
    expect(executed).toBeDefined();
    expect(executed?.usedCuratedInput).toBe(true);
  });

  it("generates no computation for the practice-question tool", () => {
    const plan = validatePlan({ intent: "quiz", tool: "generate_practice_question" })!;
    expect(executePlanTool(plan)).toBeUndefined();
  });

  it("exposes exactly the documented allowlist", () => {
    expect([...TUTOR_TOOLS].sort()).toEqual([
      "build_cook_levin_tableau",
      "generate_practice_question",
      "run_randomized_max_cut",
      "run_reduction_example",
      "run_vertex_cover_approximation",
    ]);
  });
});

describe("topic detection without the sidebar", () => {
  it("switches topics when the message names one", () => {
    expect(detectTopicId("Now run a randomized Max-Cut demo", "cook-levin")).toBe("randomized-algorithms");
    expect(detectTopicId("explain vertex cover approximation", "cook-levin")).toBe("approximation-algorithms");
    expect(detectTopicId("what about monte carlo methods", "formal-reductions")).toBe("randomized-algorithms");
    expect(detectTopicId("explain the Cook-Levin theorem", "approximation-algorithms")).toBe("cook-levin");
    expect(detectTopicId("show an independent set reduction", "cook-levin")).toBe("formal-reductions");
    expect(detectTopicId("explain polynomial-time reductions", null)).toBe("polynomial-reductions");
  });

  it("keeps the conversation topic for non-committing follow-ups", () => {
    expect(detectTopicId("why did you pick those vertices?", "approximation-algorithms")).toBe("approximation-algorithms");
    expect(detectTopicId("explain step 3 more slowly", "randomized-algorithms")).toBe("randomized-algorithms");
  });

  it("honors an explicit plan topic over keywords and selection", () => {
    expect(detectTopicId("explain reductions", "cook-levin", "formal-reductions")).toBe("formal-reductions");
  });

  it("treats invalid explicit ids as absent", () => {
    expect(detectTopicId("explain reductions", "cook-levin", "javascript:alert(1)")).toBe("cook-levin");
    expect(isTopicId("cook-levin")).toBe(true);
    expect(isTopicId("not-a-topic")).toBe(false);
  });
});

describe("curated action availability", () => {
  it("omits another_example when every topic example is already shown", () => {
    const seen = [
      { role: "assistant" as const, content: "Another example — Randomized Max-Cut with a fixed seed." },
    ];
    const actions = availableCuratedActions({ history: seen }, "randomized-algorithms");
    expect(actions).not.toContain("another_example");
    expect(actions).toContain("formal_proof");
  });

  it("offers another_example while an unseen example remains", () => {
    const actions = availableCuratedActions({ history: [] }, "formal-reductions");
    expect(actions).toContain("another_example");
  });

  it("never offers another_example for a topic without curated examples", () => {
    const actions = availableCuratedActions({ history: [] }, "polynomial-reductions");
    expect(actions).not.toContain("another_example");
    expect(actions).toContain("explain_simpler");
    expect(actions).toContain("compare");
  });
});
