/**
 * Duplicate-submission guard: a rapid double submission (double-click, or a
 * chip click followed by Enter within one render frame) must produce exactly
 * one streamChat request and one user message. The guard is the synchronous
 * inFlightRef in App.send — the streamingId state read lags a render.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  streamChatMock: vi.fn((_body?: unknown, _callbacks?: unknown) => () => {}),
  healthMock: vi.fn(async () => ({ ai: { provider: "curated", enabled: false } })),
  topicsMock: vi.fn(async () => ({ topics: [] })),
}));

vi.mock("./api/client", () => ({
  api: {
    health: h.healthMock,
    topics: h.topicsMock,
    chat: vi.fn(),
    solve: vi.fn(),
    generateQuiz: vi.fn(),
    gradeQuiz: vi.fn(),
  },
  streamChat: (body: unknown, callbacks: unknown) => {
    h.streamChatMock(body, callbacks);
    return () => {};
  },
}));

import App from "./App";

beforeAll(() => {
  // jsdom does not implement scrolling; App's auto-scroll effect calls it.
  Element.prototype.scrollTo = () => {};
});

describe("App duplicate-submission guard", () => {
  beforeEach(() => {
    h.streamChatMock.mockClear();
    h.healthMock.mockClear();
    h.topicsMock.mockClear();
  });

  it("creates exactly one request and one message from a double submission", () => {
    render(<App />);
    const input = screen.getByLabelText("Message input");
    const send = screen.getByLabelText("Send message");

    fireEvent.change(input, { target: { value: "Hello" } });
    // Two native clicks in one synchronous act block: React cannot re-render
    // the button into the stop button between them, so the guard must fire.
    act(() => {
      send.click();
      send.click();
    });

    expect(h.streamChatMock).toHaveBeenCalledTimes(1);
    // One user pill (the header legitimately shows the conversation title).
    expect(document.querySelectorAll(".message-pill")).toHaveLength(1);
  });

  it("creates exactly one request from a rapid Enter double-submit", () => {
    render(<App />);
    const input = screen.getByLabelText("Message input");

    fireEvent.change(input, { target: { value: "Hi" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(h.streamChatMock).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll(".message-pill")).toHaveLength(1);
  });
});
