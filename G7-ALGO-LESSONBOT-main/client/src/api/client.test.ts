import { afterEach, describe, expect, it, vi } from "vitest";
import { joinUrl, parseSseChunk, streamChat, friendlyError } from "./client";

describe("joinUrl", () => {
  it("returns the path unchanged when base is empty", () => {
    expect(joinUrl("", "/api/health")).toBe("/api/health");
  });

  it("joins a base and path with a single slash", () => {
    expect(joinUrl("https://api.example.com", "/api/health")).toBe("https://api.example.com/api/health");
  });

  it("avoids duplicated slashes when base ends with a slash", () => {
    expect(joinUrl("https://api.example.com/", "/api/health")).toBe("https://api.example.com/api/health");
  });

  it("avoids duplicated slashes when path starts with a slash", () => {
    expect(joinUrl("https://api.example.com", "api/health")).toBe("https://api.example.com/api/health");
  });

  it("handles multiple trailing slashes on base", () => {
    expect(joinUrl("https://api.example.com///", "/api/health")).toBe("https://api.example.com/api/health");
  });

  it("handles multiple leading slashes on path", () => {
    expect(joinUrl("https://api.example.com", "///api/health")).toBe("https://api.example.com/api/health");
  });

  it("handles both base and path having slashes", () => {
    expect(joinUrl("https://api.example.com/", "api/health")).toBe("https://api.example.com/api/health");
  });
});

describe("parseSseChunk", () => {
  it("parses complete frames", () => {
    const events = parseSseChunk('event: delta\ndata: {"text":"hi"}\n\nevent: done\ndata: {}\n\n');
    expect(events.map((e) => e.event)).toEqual(["delta", "done"]);
  });

  it("ignores incomplete trailing frames", () => {
    const events = parseSseChunk('event: delta\ndata: {"text":"hi"}\n\nevent: (incomplete');
    expect(events.map((e) => e.event)).toEqual(["delta"]);
  });

  it("skips malformed JSON data rather than crashing", () => {
    const events = parseSseChunk("event: delta\ndata: {oops\n\n");
    expect(events).toEqual([]);
  });
});

describe("streamChat", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function sseBody(frames: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    let i = 0;
    return new ReadableStream({
      pull(controller) {
        if (i < frames.length) {
          controller.enqueue(encoder.encode(frames[i++]));
        } else {
          controller.close();
        }
      },
    });
  }

  it("delivers each delta exactly once when frames span chunk boundaries", async () => {
    const ok = new Response(
      sseBody([
        'event: start\ndata: {"requestId":"r1","topicId":"t","level":"beginner","computed":false}\nevent: delta\ndata: {"text":"Hello "}\n\nevent: del',
        'ta\ndata: {"text":"world"}\nevent: meta\ndata: {"mode":"ai","topicId":"t","level":"beginner","computed":false}\n\nevent: done\ndata: {"requestId":"r1"}\n\n',
      ]),
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    );
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(ok)));

    const deltas: string[] = [];
    let metaCount = 0;
    let doneCount = 0;
    await new Promise<void>((resolve) => {
      const cancel = streamChat(
        { message: "hi", topicId: "t", level: "beginner" },
        {
          onDelta: (t) => deltas.push(t),
          onBlock: () => {},
          onMeta: () => {
            metaCount++;
          },
          onDone: () => {
            doneCount++;
            resolve();
          },
          onError: () => {
            resolve();
          },
        },
      );
      void cancel;
    });

    expect(deltas).toEqual(["Hello ", "world"]);
    expect(metaCount).toBe(1);
    expect(doneCount).toBe(1);
  });

  it("surfaces structured blocks with their indexes", async () => {
    const ok = new Response(
      sseBody([
        'event: start\ndata: {"requestId":"r1"}\n\nevent: block\ndata: {"index":0,"block":{"type":"text","markdown":"**A**"}}\n\n',
        'event: block\ndata: {"index":1,"block":{"type":"algorithm_trace","trace":{"algorithmId":"randomized-max-cut"}}}\n\nevent: done\ndata: {}\n\n',
      ]),
      { status: 200 },
    );
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(ok)));

    const blocks: { index: number; type: string }[] = [];
    await new Promise<void>((resolve) => {
      streamChat(
        { message: "hi", topicId: "t", level: "beginner" },
        {
          onDelta: () => {},
          onBlock: (index, block) => blocks.push({ index, type: block.type }),
          onMeta: () => {},
          onDone: () => resolve(),
          onError: () => resolve(),
        },
      );
    });
    expect(blocks).toEqual([
      { index: 0, type: "text" },
      { index: 1, type: "algorithm_trace" },
    ]);
  });

  it("reports stream-level errors through onError", async () => {
    const bad = new Response(
      'event: error\ndata: {"message":"The AI request timed out. Please try again."}\n\n',
      { status: 200 },
    );
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(bad)));
    const errors: string[] = [];
    await new Promise<void>((resolve) => {
      streamChat(
        { message: "hi", topicId: "t", level: "beginner" },
        {
          onDelta: () => {},
          onBlock: () => {},
          onMeta: () => {},
          onDone: () => resolve(),
          onError: (m) => {
            errors.push(m);
            resolve();
          },
        },
      );
    });
    expect(errors).toEqual(["The AI request timed out. Please try again."]);
  });

  it("cancel() stops all callbacks even if more data arrives", async () => {
    let streamController: ReadableStreamDefaultController<Uint8Array>;
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        streamController = controller;
        controller.enqueue(encoder.encode('event: delta\ndata: {"text":"first"}\n\n'));
      },
    });
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(body, { status: 200 }))));

    const deltas: string[] = [];
    let errorCount = 0;
    await new Promise<void>((resolve) => {
      const cancel = streamChat(
        { message: "hi", topicId: "t", level: "beginner" },
        {
          onDelta: (t) => {
            deltas.push(t);
            // After the first delta, cancel: later frames must not surface.
            cancel();
            streamController.enqueue(encoder.encode('event: delta\ndata: {"text":"SECOND"}\n\n'));
            streamController.close();
            window.setTimeout(resolve, 20);
          },
          onBlock: () => {},
          onMeta: () => {},
          onDone: () => {},
          onError: () => {
            errorCount++;
            resolve();
          },
        },
      );
      window.setTimeout(() => resolve(), 100);
    });

    expect(deltas).toEqual(["first"]);
    expect(errorCount).toBe(0);
  });

  it("maps HTTP errors to friendly messages", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("{}", { status: 429 }))));
    const errors: string[] = [];
    await new Promise<void>((resolve) => {
      streamChat(
        { message: "hi", topicId: "t", level: "beginner" },
        {
          onDelta: () => {},
          onBlock: () => {},
          onMeta: () => {},
          onDone: () => resolve(),
          onError: (m) => {
            errors.push(m);
            resolve();
          },
        },
      );
    });
    expect(errors[0]).toBe(friendlyError(new Error("rate_limited")));
  });
});
