/**
 * Routing tests: the landing page is the entry point at `/`, the existing chat
 * application is intact at `/chat`, a topic action carries its question into the
 * composer without sending it, browser-local conversation storage still loads,
 * and an unknown topic slug can never poison the chat.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  topics: vi.fn(),
  topic: vi.fn(),
  streamChat: vi.fn(() => () => {}),
  health: vi.fn(async () => ({ ai: { provider: "curated", enabled: false } })),
}));

vi.mock("./api/client", () => ({
  api: {
    health: h.health,
    topics: h.topics,
    topic: h.topic,
    chat: vi.fn(),
    solve: vi.fn(),
    generateQuiz: vi.fn(),
    gradeQuiz: vi.fn(),
  },
  streamChat: h.streamChat,
}));

vi.mock("@xyflow/react", () => ({
  ReactFlow: () => <div data-testid="react-flow" />,
  Background: () => null,
  Controls: () => null,
  MiniMap: () => null,
  Position: { Left: "left", Right: "right", Top: "top", Bottom: "bottom" },
}));

import Root from "./Root";

/** The key `lib/conversations.ts` writes to (STORAGE_KEY in that module). */
const STORAGE_KEY_FOR_TESTS = "g7algo:conversations:v1";

const CATALOG = [
  { slug: "polynomial-reductions", title: "Foundations of Polynomial Reductions", description: "Reductions." },
  { slug: "formal-reductions", title: "Formal Polynomial-Time Reductions", description: "Formal." },
  { slug: "cook-levin", title: "The Cook–Levin Theorem", description: "SAT is NP-complete." },
  { slug: "approximation-algorithms", title: "Approximation Algorithms", description: "Ratios." },
  { slug: "randomized-algorithms", title: "Randomized Algorithms", description: "Random choices." },
];

function goTo(path: string) {
  window.history.pushState({}, "", path);
}

/**
 * In-memory Storage. This Node build exposes a global `localStorage` that is
 * unusable without a CLI flag, which would otherwise shadow jsdom's, so the
 * tests install their own and the app's storage guard is exercised for real.
 */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => {
      map.delete(key);
    },
    setItem: (key: string, value: string) => {
      map.set(key, String(value));
    },
  } as Storage;
}

beforeAll(() => {
  // jsdom does not implement scrolling; the chat's auto-scroll effect calls it.
  Element.prototype.scrollTo = () => {};
  window.scrollTo = () => {};
});

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    value: memoryStorage(),
    configurable: true,
    writable: true,
  });
  h.topics.mockReset();
  h.topic.mockReset();
  h.streamChat.mockClear();
  h.topics.mockResolvedValue({ topics: CATALOG });
  h.topic.mockImplementation(async (slug: string) => ({
    topic: {
      ...CATALOG.find((entry) => entry.slug === slug),
      readinessQuestions: ["Why?"],
      visualization: { kind: "graph", description: "A diagram." },
    },
  }));
  window.localStorage.clear();
  goTo("/");
});

afterEach(() => {
  window.localStorage.clear();
});

describe("routing", () => {
  it("serves the landing page at /", async () => {
    render(<Root />);
    expect(screen.getByRole("heading", { level: 1, name: "Understand Algorithms. See Why They Work." })).toBeTruthy();
    // The chat shell is not mounted on this route.
    expect(screen.queryByLabelText("Message input")).toBeNull();
  });

  it("serves the real chat application at /chat", async () => {
    goTo("/chat");
    render(<Root />);
    // The existing composer and sidebar are mounted, unmodified.
    expect(screen.getByLabelText("Message input")).toBeTruthy();
    expect(screen.getByLabelText("Send message")).toBeTruthy();
    expect(screen.getByRole("button", { name: "New chat" })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Conversation navigation" })).toBeTruthy();
    // Still using the same API client for the catalog.
    await waitFor(() => expect(h.topics).toHaveBeenCalled());
  });

  it("treats an unknown path as the landing page rather than a blank screen", () => {
    goTo("/some/deep/link");
    render(<Root />);
    expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
  });

  it("renders the chat directly on a refresh of /chat?ask=...", () => {
    goTo("/chat?ask=Run%20a%20Max-Cut%20demo&topic=randomized-algorithms");
    render(<Root />);
    const input = screen.getByLabelText("Message input") as HTMLTextAreaElement;
    expect(input.value).toBe("Run a Max-Cut demo");
    // The seed is a draft only: nothing was sent.
    expect(h.streamChat).not.toHaveBeenCalled();
  });
});

describe("topic actions into the chat", () => {
  it("opens the chat with the topic's question prefilled and its topic selected", async () => {
    render(<Root />);
    await waitFor(() => expect(document.querySelectorAll(".lp-topic-card")).toHaveLength(CATALOG.length));

    const card = [...document.querySelectorAll<HTMLElement>(".lp-topic-card")].find((entry) =>
      entry.textContent!.includes("The Cook–Levin Theorem"),
    )!;
    fireEvent.click(within(card).getByRole("link", { name: "Ask about this" }));

    // Real navigation happened.
    expect(window.location.pathname).toBe("/chat");
    expect(new URLSearchParams(window.location.search).get("topic")).toBe("cook-levin");

    const input = screen.getByLabelText("Message input") as HTMLTextAreaElement;
    expect(input.value).toBe("Explain the Cook–Levin theorem and how the tableau encoding works");
    // Prefilled, not auto-sent.
    expect(h.streamChat).not.toHaveBeenCalled();
  });

  it("still allows a blank conversation", async () => {
    goTo("/chat");
    render(<Root />);
    const input = screen.getByLabelText("Message input") as HTMLTextAreaElement;
    expect(input.value).toBe("");
    expect(screen.getByRole("button", { name: "New chat" })).toBeTruthy();
  });

  it("ignores a topic slug that is not in the catalog", async () => {
    goTo("/chat?topic=not-a-real-topic");
    render(<Root />);
    await waitFor(() => expect(h.topics).toHaveBeenCalled());
    // The chat still works; the bogus slug was never applied.
    const sidebar = screen.getByRole("complementary", { name: "Conversation navigation" });
    expect(within(sidebar).getByRole("button", { name: "Foundations of Polynomial Reductions" })).toBeTruthy();
    expect(document.body.textContent).not.toContain("not-a-real-topic");
  });
});

describe("existing chat state is preserved", () => {
  it("restores browser-local conversations on the chat route", async () => {
    window.localStorage.setItem(
      STORAGE_KEY_FOR_TESTS,
      JSON.stringify([
        {
          id: "c-test-1",
          title: "Max-Cut questions",
          topicId: "randomized-algorithms",
          level: "beginner",
          messages: [{ id: "m1", role: "user", text: "Explain the expected cut value" }],
          updatedAt: Date.now(),
        },
      ]),
    );
    goTo("/chat");
    render(<Root />);
    const sidebar = screen.getByRole("complementary", { name: "Conversation navigation" });
    expect(within(sidebar).getByText("Max-Cut questions")).toBeTruthy();
  });

  it("keeps the landing route free of chat state", async () => {
    window.localStorage.setItem(
      STORAGE_KEY_FOR_TESTS,
      JSON.stringify([
        {
          id: "c-test-2",
          title: "Hidden on landing",
          topicId: "cook-levin",
          level: "formal",
          messages: [{ id: "m1", role: "user", text: "hi" }],
          updatedAt: Date.now(),
        },
      ]),
    );
    render(<Root />);
    expect(document.body.textContent).not.toContain("Hidden on landing");
  });
});
