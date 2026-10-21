/**
 * Regression tests for chat intent routing, streaming, and provider selection.
 * Run with: npm --prefix server test
 */
import { describe, expect, it } from "vitest";
import { CuratedFallbackProvider } from "../src/services/ai/curated-fallback.js";
import { isGeminiEnabled } from "../src/config.js";
import { getProvider } from "../src/services/ai/index.js";

describe("starter-chip intent routing", () => {
  const provider = new CuratedFallbackProvider();

  it("routes 'Run a randomized Max-Cut demo' to the Max-Cut solver", async () => {
    const reply = await provider.generateReply({
      message: "Run a randomized Max-Cut demo",
      topicId: "randomized-algorithms",
      level: "beginner",
      history: [],
    });
    expect(reply.blocks.some((b) => b.type === "algorithm_trace")).toBe(true);
    const traceBlock = reply.blocks.find((b) => b.type === "algorithm_trace");
    if (traceBlock?.type === "algorithm_trace") {
      expect(traceBlock.trace.algorithmId).toBe("randomized-max-cut");
    }
  });

  it("routes 'Show a Vertex Cover example' to the Vertex Cover solver", async () => {
    const reply = await provider.generateReply({
      message: "Show a Vertex Cover example",
      topicId: "approximation-algorithms",
      level: "beginner",
      history: [],
    });
    expect(reply.blocks.some((b) => b.type === "algorithm_trace")).toBe(true);
    const traceBlock = reply.blocks.find((b) => b.type === "algorithm_trace");
    if (traceBlock?.type === "algorithm_trace") {
      expect(traceBlock.trace.algorithmId).toBe("vertex-cover-2approx");
    }
  });

  it("routes 'Explain Cook–Levin simply' to the Cook-Levin topic", async () => {
    const reply = await provider.generateReply({
      message: "Explain Cook–Levin simply",
      topicId: "cook-levin",
      level: "beginner",
      history: [],
    });
    expect(reply.blocks.some((b) => b.type === "text")).toBe(true);
    const textBlock = reply.blocks.find((b) => b.type === "text");
    if (textBlock?.type === "text") {
      expect(textBlock.markdown).toContain("Cook");
    }
  });
});

describe("follow-up actions preserve topic context", () => {
  const provider = new CuratedFallbackProvider();

  it("'Explain more simply' provides a simpler explanation, not a full lesson replay", async () => {
    const reply = await provider.generateReply({
      message: "Explain that more simply",
      topicId: "polynomial-reductions",
      level: "beginner",
      history: [
        { role: "user", content: "Explain polynomial reductions" },
        { role: "assistant", content: "Polynomial reductions are..." },
      ],
    });
    // Should have fewer blocks than a full lesson (no key terms, notation tables).
    const hasKeyTerms = reply.blocks.some(
      (b) => b.type === "table" && b.caption === "Key terminology",
    );
    expect(hasKeyTerms).toBe(false);
    // Should contain a simpler explanation.
    expect(reply.blocks[0]?.type).toBe("text");
  });

  it("'Show formal proof' provides a proof sketch, not generic content", async () => {
    const reply = await provider.generateReply({
      message: "Show me the formal proof for the current topic",
      topicId: "approximation-algorithms",
      level: "formal",
      history: [
        { role: "user", content: "Explain approximation algorithms" },
        { role: "assistant", content: "Approximation algorithms..." },
      ],
    });
    const hasCallout = reply.blocks.some((b) => b.type === "callout" && b.title === "Proof sketch");
    expect(hasCallout).toBe(true);
  });

  it("'Give another example' provides a different example", async () => {
    const reply = await provider.generateReply({
      message: "Give me another example for the current topic",
      topicId: "formal-reductions",
      level: "intermediate",
      history: [
        { role: "user", content: "Show me an example" },
        { role: "assistant", content: "Here is an example..." },
      ],
    });
    expect(reply.blocks.some((b) => b.type === "algorithm_trace")).toBe(true);
  });

  it("'Give another example' is honest once every curated example is exhausted", async () => {
    const first = await provider.generateReply({
      message: "Give me another example for the current topic",
      topicId: "formal-reductions",
      level: "intermediate",
      history: [{ role: "assistant", content: "Another example — Independent Set → Vertex Cover on a triangle." }],
    });
    expect(first.blocks.some((b) => b.type === "algorithm_trace")).toBe(true);
    // Second round: BOTH examples were shown; the reply must be exclusively
    // honest text (no repeated trace presented as new content).
    const second = await provider.generateReply({
      message: "Give me another example for the current topic",
      topicId: "formal-reductions",
      level: "intermediate",
      history: [
        { role: "assistant", content: "Independent Set → Vertex Cover on a 4-vertex path" },
        { role: "assistant", content: "Another example — Independent Set → Vertex Cover on a triangle." },
      ],
    });
    expect(second.blocks.some((b) => b.type === "algorithm_trace")).toBe(false);
    const text = second.blocks.map((b) => ("markdown" in b ? b.markdown : "")).join("\n");
    expect(text).toContain("every computed example");
  });
});

describe("streaming contract", () => {
  it("streaming uses the explicit event protocol: start, meta, blocks, done", async () => {
    const { createApp } = await import("../src/app.js");
    const app = createApp();
    const server = app.listen(0);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;

    try {
      const res = await fetch(`http://localhost:${port}/api/tutor/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Explain polynomial reductions", topicId: "polynomial-reductions", level: "beginner" }),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/event-stream");

      const text = await res.text();
      const eventTypes = (text.match(/event: (\S+)/g) ?? []).map((e) => e.replace("event: ", ""));
      // Protocol: start and done bracket the response; meta tells the truth
      // about the producing mode; structured blocks carry the lesson.
      expect(eventTypes[0]).toBe("start");
      expect(eventTypes).toContain("meta");
      const blockEvents = eventTypes.filter((e) => e === "block").length;
      expect(blockEvents).toBeGreaterThan(1);
      expect(eventTypes[eventTypes.length - 1]).toBe("done");
      // The done event carries only completion metadata, never the answer
      // text: request id, the effective topic, and available follow-up
      // actions — but no `text` payload.
      const doneFrame = text.match(/event: done\ndata: ([^\n]+)/);
      if (doneFrame) {
        const doneData = JSON.parse(doneFrame[1]);
        expect(Object.keys(doneData).map((k) => ["requestId", "effectiveTopicId", "actions"].includes(k) || k === "usage").every(Boolean)).toBe(true);
        expect(Object.keys(doneData)).not.toContain("text");
      }
      // The curated provider never fakes token streaming.
      expect(eventTypes).not.toContain("delta");
      const metaFrame = text.match(/event: meta\ndata: ([^\n]+)/);
      expect(metaFrame).toBeTruthy();
      expect(JSON.parse((metaFrame as RegExpMatchArray)[1]).mode).toBe("curated_fallback");
    } finally {
      server.close();
    }
  });
});

describe("reported-defect regressions", () => {
  it("a Max-Cut request typed under the default topic routes to the Max-Cut solver, not the topic's own example", async () => {
    const { createApp } = await import("../src/app.js");
    const app = createApp();
    const server = app.listen(0);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;

    try {
      const res = await fetch(`http://localhost:${port}/api/tutor/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "Run a randomized Max-Cut demo",
          topicId: "polynomial-reductions",
          level: "beginner",
        }),
      });
      const body = (await res.json()) as {
        blocks: { type: string; trace?: { algorithmId: string } }[];
      };
      const trace = body.blocks.find((b) => b.type === "algorithm_trace");
      expect(trace).toBeTruthy();
      expect(trace?.trace?.algorithmId).toBe("randomized-max-cut");
      const allText = JSON.stringify(body.blocks);
      expect(allText.toLowerCase()).not.toContain("tableau");
      expect(allText.toLowerCase()).not.toContain("clause");
    } finally {
      server.close();
    }
  });

  it("a plain explanation request does not prepend any solver trace", async () => {
    const { createApp } = await import("../src/app.js");
    const app = createApp();
    const server = app.listen(0);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;

    try {
      const res = await fetch(`http://localhost:${port}/api/tutor/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "Explain polynomial reductions",
          topicId: "polynomial-reductions",
          level: "beginner",
        }),
      });
      const body = (await res.json()) as {
        blocks: { type: string }[];
        computed: boolean;
      };
      expect(body.blocks.some((b) => b.type === "algorithm_trace")).toBe(false);
      expect(body.computed).toBe(false);
    } finally {
      server.close();
    }
  });
});

describe("no duplicate paragraphs", () => {
  const provider = new CuratedFallbackProvider();

  it("successive general follow-ups do not replay the full lesson template", async () => {
    const first = await provider.generateReply({
      message: "Explain Cook–Levin simply",
      topicId: "cook-levin",
      level: "beginner",
      history: [],
    });
    const follow = await provider.generateReply({
      message: "What does that mean for NP-completeness?",
      topicId: "cook-levin",
      level: "beginner",
      history: [
        { role: "user", content: "Explain Cook–Levin simply" },
        {
          role: "assistant",
          content: first.blocks.map((b) => (b.type === "text" ? b.markdown : "")).join("\n"),
        },
      ],
    });
    // A full lesson replay contains the key-terms table and misconceptions
    // callout — follow-ups must give a focused answer instead.
    expect(follow.blocks.some((b) => b.type === "table")).toBe(false);
    expect(follow.blocks.some((b) => b.type === "callout")).toBe(false);
  });
});

describe("provider selection and fallback", () => {
  it("Gemini remains disabled by default", () => {
    expect(isGeminiEnabled()).toBe(false);
  });

  it("returns the curated provider when Gemini is disabled", async () => {
    const provider = await getProvider();
    expect(provider.name).toBe("curated_fallback");
  });

  it("curated fallback works without any API key", async () => {
    const provider = new CuratedFallbackProvider();
    const reply = await provider.generateReply({
      message: "Explain polynomial reductions",
      topicId: "polynomial-reductions",
      level: "beginner",
      history: [],
    });
    expect(reply.mode).toBe("curated_fallback");
    expect(reply.blocks.length).toBeGreaterThan(0);
  });
});
