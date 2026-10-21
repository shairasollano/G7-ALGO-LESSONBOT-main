/**
 * The API client surface must not change as part of the landing-page work: the
 * chat depends on every one of these. This suite imports the REAL module (no
 * mocks) and asserts the shape is intact.
 *
 * The assessment endpoints are checked against a stubbed `fetch`: the paths,
 * the verbs, and the error mapping a quiz session depends on (a 410 means the
 * session expired, and the message has to say so).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, friendlyError, joinUrl, parseSseChunk, streamChat } from "./client";

describe("api client surface", () => {
  it("still exposes every endpoint the chat uses", () => {
    for (const method of ["health", "topics", "topic", "chat", "solve", "generateQuiz", "gradeQuiz"] as const) {
      expect(typeof api[method], `api.${method}`).toBe("function");
    }
  });

  it("still exposes the assessment endpoints alongside them", () => {
    for (const method of [
      "createAssessment",
      "getAssessment",
      "submitAssessment",
      "getAssessmentAnswerKey",
    ] as const) {
      expect(typeof api[method], `api.${method}`).toBe("function");
    }
  });

  it("still exposes streaming chat and its helpers", () => {
    expect(typeof streamChat).toBe("function");
    expect(typeof parseSseChunk).toBe("function");
    expect(typeof friendlyError).toBe("function");
    expect(typeof joinUrl).toBe("function");
  });

  it("keeps the SSE frame parser behaviour the chat relies on", () => {
    const events = parseSseChunk('event: delta\ndata: {"text":"hi"}\n\nevent: done\ndata: {"actions":["quiz"]}\n\n');
    expect(events).toEqual([
      { event: "delta", data: { text: "hi" } },
      { event: "done", data: { actions: ["quiz"] } },
    ]);
  });

  it("keeps joining API base URLs the same way", () => {
    expect(joinUrl("", "/api/topics")).toBe("/api/topics");
    expect(joinUrl("https://api.example.com/", "/api/topics")).toBe("https://api.example.com/api/topics");
  });
});

// ---------------------------------------------------------------------------
// Assessment endpoints — paths, verbs, and the error mapping a session needs
// ---------------------------------------------------------------------------

interface Call {
  url: string;
  method: string;
  body: string | null;
}

describe("assessment requests", () => {
  const calls: Call[] = [];

  function stubFetch(status: number, body: unknown = {}) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({
          url: String(url),
          method: init?.method ?? "GET",
          body: typeof init?.body === "string" ? init.body : null,
        });
        return new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
  }

  beforeEach(() => {
    calls.length = 0;
    stubFetch(200, {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates an assessment by POST", async () => {
    await api.createAssessment({ count: 10 });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url.endsWith("/api/quizzes/assessment")).toBe(true);
    expect(JSON.parse(calls[0].body ?? "{}")).toEqual({ count: 10 });
  });

  it("sends the requested length through unchanged", async () => {
    await api.createAssessment({ count: 50, topicId: "cook-levin", difficulty: "advanced", format: "true_false" });
    expect(JSON.parse(calls[0].body ?? "{}")).toEqual({
      count: 50,
      topicId: "cook-levin",
      difficulty: "advanced",
      format: "true_false",
    });
  });

  it("reloads a session by GET, without its key", async () => {
    await api.getAssessment("asmt-abc");
    expect(calls[0].method).toBe("GET");
    expect(calls[0].url.endsWith("/api/quizzes/assessment/asmt-abc")).toBe(true);
    expect(calls[0].body).toBeNull();
  });

  it("submits answers by POST, to the session's own submit path", async () => {
    await api.submitAssessment({ assessmentId: "asmt-abc", answers: { q1: 2, q2: null } });
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url.endsWith("/api/quizzes/assessment/asmt-abc/submit")).toBe(true);
    expect(JSON.parse(calls[0].body ?? "{}")).toEqual({
      assessmentId: "asmt-abc",
      answers: { q1: 2, q2: null },
    });
  });

  it("fetches the answer key as its own explicit request", async () => {
    await api.getAssessmentAnswerKey("asmt-abc");
    expect(calls[0].method).toBe("GET");
    expect(calls[0].url.endsWith("/api/quizzes/assessment/asmt-abc/key")).toBe(true);
  });

  it("escapes a session id rather than letting it reshape the path", async () => {
    await api.getAssessment("../etc/passwd");
    expect(calls[0].url).toContain(encodeURIComponent("../etc/passwd"));
  });

  it("maps an expired session to a message that says so", async () => {
    stubFetch(410, { error: { code: "assessment_expired", message: "gone" } });
    await expect(api.getAssessment("asmt-abc")).rejects.toThrow("quiz_expired");
    expect(friendlyError(new Error("quiz_expired"))).toBe(
      "This quiz session has expired. Please generate a new quiz.",
    );
  });

  it("maps a well-formed request the server cannot satisfy", async () => {
    stubFetch(422, { error: { code: "insufficient_content", message: "too long" } });
    await expect(api.createAssessment({ count: 40 })).rejects.toThrow("invalid_input:insufficient_content");
  });

  it("maps an unknown topic to not-found", async () => {
    stubFetch(404, { error: { code: "topic_not_found", message: "nope" } });
    await expect(api.createAssessment({ count: 10, topicId: "astrology" })).rejects.toThrow(
      "not_found:topic_not_found",
    );
  });

  it("maps a rate limit distinctly from a server failure", async () => {
    stubFetch(429, {});
    await expect(api.createAssessment({ count: 10 })).rejects.toThrow("rate_limited");
    expect(friendlyError(new Error("rate_limited"))).toContain("Too many requests");
  });
});
