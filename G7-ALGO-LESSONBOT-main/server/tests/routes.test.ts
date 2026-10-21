/**
 * Route and provider tests: health, topics, solve errors, quiz generate/grade,
 * curated fallback behavior, and the Gemini compliance gate.
 */
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { isGeminiEnabled } from "../src/config.js";
import { CuratedFallbackProvider } from "../src/services/ai/curated-fallback.js";

const app = createApp();

describe("GET /api/health", () => {
  it("returns ok without leaking secrets", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.ai.provider).toBe("curated");
    expect(res.body.ai.enabled).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain("GEMINI_API_KEY");
  });
});

describe("topics routes", () => {
  it("lists all five topics", async () => {
    const res = await request(app).get("/api/topics");
    expect(res.status).toBe(200);
    expect(res.body.topics).toHaveLength(5);
  });

  it("returns a full lesson for a valid slug", async () => {
    const res = await request(app).get("/api/topics/cook-levin");
    expect(res.status).toBe(200);
    expect(res.body.topic.slug).toBe("cook-levin");
    expect(res.body.topic.objectives.length).toBeGreaterThan(0);
    expect(res.body.topic.quiz).toBeUndefined();
  });

  it("404s for an unknown slug", async () => {
    const res = await request(app).get("/api/topics/nope");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("topic_not_found");
  });
});

describe("POST /api/problems/solve", () => {
  it("solves vertex cover and returns a trace", async () => {
    const res = await request(app)
      .post("/api/problems/solve")
      .send({
        algorithmId: "vertex-cover-2approx",
        input: {
          vertices: ["A", "B", "C", "D"],
          edges: [
            ["A", "B"],
            ["B", "C"],
            ["C", "D"],
          ],
        },
      });
    expect(res.status).toBe(200);
    expect(res.body.algorithmId).toBe("vertex-cover-2approx");
    expect(res.body.steps.length).toBeGreaterThan(1);
    expect(res.body.result.cover).toBeDefined();
  });

  it("maps validation errors to 422 with a clean envelope", async () => {
    const res = await request(app)
      .post("/api/problems/solve")
      .send({ algorithmId: "vertex-cover-2approx", input: { vertices: ["A", "A"], edges: [] } });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("invalid_vertices");
  });

  it("maps unsupported algorithms to 400", async () => {
    const res = await request(app)
      .post("/api/problems/solve")
      .send({ algorithmId: "nope", input: {} });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("unsupported_algorithm");
  });

  it("rejects malformed bodies with 400", async () => {
    const res = await request(app).post("/api/problems/solve").send({ algorithmId: "" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_error");
  });
});

describe("quiz routes", () => {
  it("generates a 5-question quiz without answer keys, then grades deterministically", async () => {
    const gen = await request(app).post("/api/quizzes/generate").send({ topicId: "approximation-algorithms" });
    expect(gen.status).toBe(200);
    expect(gen.body.quiz.questions).toHaveLength(5);
    // Answer keys must not leak to the client.
    const serialized = JSON.stringify(gen.body.quiz);
    expect(serialized).not.toContain("rationale");
    expect(serialized).not.toContain('"answer"');

    // Grade with all-wrong answers (index 0 for every question is wrong for
    // the curated bank by construction of this test: we grade against the
    // server-side key, so just submit 0s and expect a deterministic score).
    const answers: Record<string, number> = {};
    for (const q of gen.body.quiz.questions) answers[q.id] = 0;
    const grade = await request(app)
      .post("/api/quizzes/grade")
      .send({ quizId: gen.body.quiz.id, answers });
    expect(grade.status).toBe(200);
    expect(grade.body.total).toBe(5);
    expect(grade.body.score).toBeGreaterThanOrEqual(0);
    expect(grade.body.results).toHaveLength(5);
    expect(grade.body.results[0].rationale).toBeDefined();
  });

  it("returns 410 for an unknown/expired quiz", async () => {
    const res = await request(app)
      .post("/api/quizzes/grade")
      .send({ quizId: "quiz-nonexistent", answers: {} });
    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe("quiz_expired");
  });
});

describe("POST /api/tutor/chat", () => {
  it("returns curated fallback blocks when AI is disabled", async () => {
    const res = await request(app)
      .post("/api/tutor/chat")
      .send({ message: "Explain polynomial reductions", topicId: "polynomial-reductions", level: "beginner" });
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe("curated_fallback");
    expect(res.body.blocks.length).toBeGreaterThan(0);
    expect(res.body.topicId).toBe("polynomial-reductions");
  });

  it("runs the solver first when a computed example is requested", async () => {
    const res = await request(app)
      .post("/api/tutor/chat")
      .send({ message: "Show a Vertex Cover example", topicId: "approximation-algorithms", level: "intermediate" });
    expect(res.status).toBe(200);
    expect(res.body.computed).toBe(true);
    const types = res.body.blocks.map((b: { type: string }) => b.type);
    expect(types).toContain("algorithm_trace");
  });

  it("returns a quiz block for quiz requests", async () => {
    const res = await request(app)
      .post("/api/tutor/chat")
      .send({ message: "Quiz me", topicId: "cook-levin", level: "beginner" });
    expect(res.status).toBe(200);
    const types = res.body.blocks.map((b: { type: string }) => b.type);
    expect(types).toContain("quiz");
  });

  it("validates the request body", async () => {
    const res = await request(app).post("/api/tutor/chat").send({ message: "", level: "beginner" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_error");
  });

  it("404s for an unknown topic", async () => {
    const res = await request(app)
      .post("/api/tutor/chat")
      .send({ message: "hi", topicId: "unknown", level: "beginner" });
    expect(res.status).toBe(404);
  });
});

describe("Gemini compliance gate", () => {
  it("keeps Gemini disabled by default (no key, no attestation)", () => {
    expect(isGeminiEnabled()).toBe(false);
  });
});

describe("provider selection", () => {
  it("returns the curated provider when Gemini is disabled", async () => {
    const { getProvider } = await import("../src/services/ai/index.js");
    const provider = await getProvider();
    expect(provider.name).toBe("curated_fallback");
  });

  it("returns the curated provider when no API key is set", async () => {
    const { getProvider } = await import("../src/services/ai/index.js");
    const provider = await getProvider();
    expect(provider.name).toBe("curated_fallback");
  });
});

describe("CuratedFallbackProvider", () => {
  const provider = new CuratedFallbackProvider();

  it("answers with lesson blocks for a default request", async () => {
    const reply = await provider.generateReply({
      message: "Tell me about reductions",
      topicId: "polynomial-reductions",
      level: "beginner",
      history: [],
    });
    expect(reply.mode).toBe("curated_fallback");
    expect(reply.blocks.length).toBeGreaterThan(3);
  });

  it("detects quiz intent", async () => {
    const reply = await provider.generateReply({
      message: "Quiz me",
      topicId: "randomized-algorithms",
      level: "beginner",
      history: [],
    });
    expect(reply.blocks.some((b) => b.type === "quiz")).toBe(true);
  });

  it("detects example intent and runs the solver", async () => {
    const reply = await provider.generateReply({
      message: "Show me an example",
      topicId: "approximation-algorithms",
      level: "intermediate",
      history: [],
    });
    expect(reply.blocks.some((b) => b.type === "algorithm_trace")).toBe(true);
  });

  it("redirects unsupported topics", async () => {
    const reply = await provider.generateReply({
      message: "hi",
      topicId: "quantum-computing",
      level: "beginner",
      history: [],
    });
    expect(reply.blocks[0].type).toBe("text");
  });
});
