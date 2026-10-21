/**
 * Response-mode labeling: the badge and the fallback note must reflect the
 * mode the server supplies via SSE metadata — an AI reply is labeled
 * AI-generated, and a fallback after a failed AI request says why instead of
 * silently implying the AI is offline.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatThread } from "./ChatThread";
import type { Message } from "../../App";

function assistantMsg(partial: Partial<Message>): Message {
  return { id: "a1", role: "assistant", ...partial } as Message;
}

const threadProps = {
  streamingActive: false,
  onAction: () => {},
  onRegenerate: () => {},
};

describe("ChatThread response-mode labeling", () => {
  it("labels an AI-generated response from the SSE-supplied mode", () => {
    render(<ChatThread messages={[assistantMsg({ mode: "ai", text: "Hello" })]} {...threadProps} />);
    expect(screen.getByText("AI-generated")).toBeTruthy();
    expect(screen.queryByText(/AI request failed/)).toBeNull();
  });

  it("labels a curated fallback response as curated", () => {
    render(
      <ChatThread messages={[assistantMsg({ mode: "curated_fallback", text: "Lesson" })]} {...threadProps} />,
    );
    expect(screen.getByText("Curated lesson (offline)")).toBeTruthy();
    expect(screen.queryByText("AI-generated")).toBeNull();
  });

  it("shows the sanitized fallback reason when the AI provider failed", () => {
    render(
      <ChatThread
        messages={[
          assistantMsg({
            mode: "curated_fallback",
            text: "Lesson",
            fallbackReason: "AI rate limit reached",
          }),
        ]}
        {...threadProps}
      />,
    );
    expect(screen.getByText(/AI request failed: AI rate limit reached/)).toBeTruthy();
    expect(screen.getByText("Curated lesson (offline)")).toBeTruthy();
  });

  it("does not show a fallback note for a normal curated response", () => {
    render(
      <ChatThread messages={[assistantMsg({ mode: "curated_fallback", text: "Lesson" })]} {...threadProps} />,
    );
    expect(screen.queryByText(/AI request failed/)).toBeNull();
  });
});
