/**
 * Landing page tests: every supported topic is rendered from the catalog (once
 * each, nothing invented), every call to action has a real destination, topic
 * actions carry their question into the chat, the mobile menu is accessible,
 * and the demonstration shows real computed solver output.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TOPIC_PROMPTS } from "@shared/landing-scenes";
import { Landing } from "./Landing";

const h = vi.hoisted(() => ({
  topics: vi.fn(),
  topic: vi.fn(),
}));

vi.mock("../api/client", () => ({
  api: {
    health: vi.fn(async () => ({ ai: { provider: "curated", enabled: false } })),
    topics: h.topics,
    topic: h.topic,
    chat: vi.fn(),
    solve: vi.fn(),
    generateQuiz: vi.fn(),
    gradeQuiz: vi.fn(),
  },
  streamChat: () => () => {},
}));

// The demonstration reuses the chat's trace block, which draws graphs with
// React Flow. React Flow needs real layout measurement, so it is stubbed here;
// the browser verification covers the real rendering.
vi.mock("@xyflow/react", () => ({
  ReactFlow: () => <div data-testid="react-flow" />,
  Background: () => null,
  Controls: () => null,
  Handle: () => null,
  MiniMap: () => null,
  Position: { Left: "left", Right: "right", Top: "top", Bottom: "bottom" },
}));

/** Mirrors the real catalog (server/src/data/topics.ts). */
const CATALOG = [
  {
    slug: "polynomial-reductions",
    title: "Foundations of Polynomial Reductions",
    description: "What it means to transform one problem into another, and why the transformation is the point.",
  },
  {
    slug: "formal-reductions",
    title: "Formal Polynomial-Time Reductions",
    description: "The formal definition A ≤p B and how reductions establish NP-hardness.",
  },
  {
    slug: "cook-levin",
    title: "The Cook–Levin Theorem",
    description: "Why SAT is NP-complete: encoding an accepting computation as a Boolean formula.",
  },
  {
    slug: "approximation-algorithms",
    title: "Approximation Algorithms",
    description: "Optimization problems, approximation ratios, and the 2-approximation for Vertex Cover.",
  },
  {
    slug: "randomized-algorithms",
    title: "Randomized Algorithms",
    description: "Randomized choices, expected running time, and a seeded randomized Max-Cut demo.",
  },
];

function detailFor(slug: string) {
  const topic = CATALOG.find((entry) => entry.slug === slug)!;
  return {
    topic: {
      ...topic,
      readinessQuestions: [`A readiness question about ${topic.title}?`],
      visualization: { kind: "graph", description: `A diagram of ${topic.title}.` },
    },
  };
}

beforeEach(() => {
  h.topics.mockReset();
  h.topic.mockReset();
  h.topics.mockResolvedValue({ topics: CATALOG });
  h.topic.mockImplementation(async (slug: string) => detailFor(slug));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("landing — topic catalog", () => {
  it("renders every supported topic exactly once", async () => {
    render(<Landing />);
    await waitFor(() => expect(document.querySelectorAll(".lp-topic-card")).toHaveLength(CATALOG.length));

    const cards = [...document.querySelectorAll(".lp-topic-card")];
    const titles = cards.map((card) => card.querySelector(".lp-topic-title")!.textContent);
    expect(titles).toEqual(CATALOG.map((topic) => topic.title));
    // No duplicates.
    expect(new Set(titles).size).toBe(CATALOG.length);
  });

  it("shows the catalog's own description, question and diagram caption", async () => {
    render(<Landing />);
    await waitFor(() => expect(document.querySelectorAll(".lp-topic-card")).toHaveLength(CATALOG.length));

    const cookLevin = [...document.querySelectorAll(".lp-topic-card")].find((card) =>
      card.textContent!.includes("The Cook–Levin Theorem"),
    )!;
    expect(cookLevin.textContent).toContain("Why SAT is NP-complete");
    expect(cookLevin.textContent).toContain("A readiness question about The Cook–Levin Theorem?");
    expect(cookLevin.textContent).toContain("A diagram of The Cook–Levin Theorem.");
  });

  it("features a strict subset near the hero, never a new topic", async () => {
    render(<Landing />);
    await waitFor(() => expect(document.querySelectorAll(".lp-chip").length).toBeGreaterThan(0));

    const chips = [...document.querySelectorAll(".lp-chip")];
    expect(chips.length).toBeLessThan(CATALOG.length);
    const catalogTitles = CATALOG.map((topic) => topic.title);
    for (const chip of chips) {
      expect(catalogTitles).toContain(chip.textContent);
    }
  });

  it("reports an honest, actionable state when the catalog cannot be loaded", async () => {
    h.topics.mockRejectedValue(new Error("network_error"));
    render(<Landing />);

    await waitFor(() => expect(screen.getByText(/could not be loaded/)).toBeTruthy());
    expect(document.querySelectorAll(".lp-topic-card")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open the chat" }).getAttribute("href")).toBe("/chat");

    // Retrying with a working catalog renders the topics.
    h.topics.mockResolvedValue({ topics: CATALOG });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(document.querySelectorAll(".lp-topic-card")).toHaveLength(CATALOG.length));
  });
});

describe("landing — calls to action", () => {
  it("points every primary action at the chat application", async () => {
    render(<Landing />);
    await waitFor(() => expect(document.querySelectorAll(".lp-topic-card").length).toBeGreaterThan(0));

    const primary = screen.getAllByRole("link", { name: "Try the Chat" });
    expect(primary.length).toBeGreaterThanOrEqual(3); // nav, hero, closing
    for (const link of primary) {
      expect(link.getAttribute("href")).toBe("/chat");
    }
  });

  it("points every secondary action at the topics section, which exists", async () => {
    render(<Landing />);
    await waitFor(() => expect(document.querySelectorAll(".lp-topic-card").length).toBeGreaterThan(0));

    const secondary = screen.getAllByRole("link", { name: "Explore the Topics" });
    expect(secondary.length).toBeGreaterThanOrEqual(2); // hero, closing
    for (const link of secondary) {
      expect(link.getAttribute("href")).toBe("#topics");
    }
    expect(document.getElementById("topics")).toBeTruthy();
  });

  it("gives every in-page navigation link a section that exists", async () => {
    render(<Landing />);
    await waitFor(() => expect(document.querySelectorAll(".lp-topic-card").length).toBeGreaterThan(0));

    const anchors = [...document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')];
    expect(anchors.length).toBeGreaterThan(0);
    for (const anchor of anchors) {
      const id = anchor.getAttribute("href")!.slice(1);
      expect(document.getElementById(id), `#${id} must exist`).toBeTruthy();
    }
  });

  it("carries each topic's question and topic into the chat", async () => {
    render(<Landing />);
    await waitFor(() => expect(document.querySelectorAll(".lp-topic-card")).toHaveLength(CATALOG.length));

    for (const topic of CATALOG) {
      const card = [...document.querySelectorAll<HTMLElement>(".lp-topic-card")].find((entry) =>
        entry.textContent!.includes(topic.title),
      )!;
      const action = within(card).getByRole("link", { name: "Ask about this" });
      const href = action.getAttribute("href")!;
      expect(href.startsWith("/chat?")).toBe(true);
      const query = new URLSearchParams(href.slice(href.indexOf("?") + 1));
      expect(query.get("topic")).toBe(topic.slug);
      expect(query.get("ask")).toBe(TOPIC_PROMPTS[topic.slug]);
    }
  });

  it("keeps the footer links real and the identity present", async () => {
    render(<Landing />);
    const footer = document.querySelector(".lp-footer")!;
    expect(within(footer as HTMLElement).getByText("G7 Algo")).toBeTruthy();
    for (const link of [...footer.querySelectorAll("a")]) {
      const href = link.getAttribute("href")!;
      if (href.startsWith("#")) {
        expect(document.getElementById(href.slice(1))).toBeTruthy();
      } else {
        // The brand points home, the chat link points at the chat.
        expect(["/", "/chat"]).toContain(href);
      }
    }
    // No fabricated social proof or contact details anywhere on the page.
    expect(document.body.textContent).not.toMatch(/trusted by|testimonial|@gmail|@example\.com/i);
  });
});

describe("landing — mobile navigation", () => {
  it("opens and closes with correct ARIA state and Escape", () => {
    render(<Landing />);
    const toggle = screen.getByRole("button", { name: "Open navigation menu" });
    const drawer = document.getElementById("lp-nav-drawer")!;

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(drawer.getAttribute("aria-hidden")).toBe("true");

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(drawer.getAttribute("aria-hidden")).toBe("false");
    // Focus moves into the drawer.
    expect(document.activeElement).toBe(within(drawer).getByRole("button", { name: "Close menu" }));

    fireEvent.keyDown(window, { key: "Escape" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(drawer.getAttribute("aria-hidden")).toBe("true");
    // Focus returns to the trigger.
    expect(document.activeElement).toBe(toggle);
  });

  it("closes on the scrim and on a navigation choice", () => {
    render(<Landing />);
    const toggle = screen.getByRole("button", { name: "Open navigation menu" });

    fireEvent.click(toggle);
    fireEvent.click(document.querySelector(".lp-scrim")!);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(toggle);
    const drawer = document.getElementById("lp-nav-drawer")!;
    fireEvent.click(within(drawer).getByRole("link", { name: "How it works" }));
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("landing — interactive demonstration", () => {
  it("shows real computed solver output, not a mock-up", async () => {
    render(<Landing />);
    await waitFor(() => expect(screen.getByText("Vertex Cover 2-approximation")).toBeTruthy());

    const frame = document.querySelector<HTMLElement>(".lp-demo-frame")!;
    // The chat's own trace block: computed result, guarantee, complexity.
    const result = frame.querySelector(".trace-result-value")!;
    expect(result.textContent).toContain("coverSize=4");
    expect(result.textContent).toContain("matchingSize=2");
    expect(frame.querySelector(".trace-guarantee")!.textContent).toContain("2·OPT");
    expect(frame.querySelector(".trace-complexity")!.textContent).toContain("space O(n + m)");
  });

  it("steps the demonstration through the solver's own trace", async () => {
    render(<Landing />);
    await waitFor(() => expect(screen.getByText("Vertex Cover 2-approximation")).toBeTruthy());

    const frame = document.querySelector<HTMLElement>(".lp-demo-frame")!;
    expect(within(frame).getByText("Step 1 of 4")).toBeTruthy();
    fireEvent.click(within(frame).getByRole("button", { name: "Next step" }));
    expect(within(frame).getByText("Step 2 of 4")).toBeTruthy();
    // The graph, the explanation and the metrics all describe the same step.
    expect(frame.querySelector(".trace-step-title")!.textContent).toBe("Pick uncovered edge A–B");
    expect(frame.querySelector(".trace-step-desc")!.textContent).toMatch(/Add A and B to the cover/);
    expect(frame.querySelector(".trace-result-value")!.textContent).toContain("coverSize=4");
    fireEvent.click(within(frame).getByRole("button", { name: "Reset to first step" }));
    expect(within(frame).getByText("Step 1 of 4")).toBeTruthy();
  });

  it("switches to the second demonstration", async () => {
    render(<Landing />);
    await waitFor(() => expect(screen.getByText("Vertex Cover 2-approximation")).toBeTruthy());

    fireEvent.click(screen.getByRole("tab", { name: "Independent Set → Vertex Cover" }));
    const frame = document.querySelector<HTMLElement>(".lp-demo-frame")!;
    expect(frame.querySelector(".trace-result-value")!.textContent).toContain("transformation=f(G, k) = (G, n − k)");
  });

  it("has exactly one h1 and a labelled landmark structure", async () => {
    render(<Landing />);
    await waitFor(() => expect(document.querySelectorAll(".lp-topic-card").length).toBeGreaterThan(0));
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    expect(screen.getByRole("main")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Skip to content" })).toBeTruthy();
  });
});

/**
 * The landing stylesheet, read from disk. `?raw` is not usable here (Vitest
 * stubs CSS imports to an empty string) and jsdom's global `URL` is rejected
 * by `fs`, so the path is resolved from the working directory instead — the
 * suite is only ever run from the client package, with a repo-root fallback.
 */
function readLandingCss(): string {
  const candidates = [
    resolve(process.cwd(), "src/landing/landing.css"),
    resolve(process.cwd(), "client/src/landing/landing.css"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      // Comments stripped, so an assertion can only ever be satisfied (or
      // broken) by a real declaration rather than by the prose explaining it.
      return readFileSync(candidate, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    }
  }
  throw new Error(`landing.css not found; tried:\n  ${candidates.join("\n  ")}`);
}

describe("landing — smooth section navigation", () => {
  const css = readLandingCss();

  it("smooth-scrolls the document shape the app actually renders", async () => {
    // The selector is only meaningful against the real nesting. `#root` is a
    // child of <body>, so `html:has(> #root > .lp)` could never match and every
    // section link jumped instead of scrolling — the guard is both "the rule
    // exists" and "the rule's shape is the one the DOM has".
    const previous = document.getElementById("root");
    previous?.remove();
    const root = document.createElement("div");
    root.id = "root";
    root.innerHTML = '<div class="lp"></div>';
    document.body.appendChild(root);
    try {
      expect(document.body.contains(document.getElementById("root"))).toBe(true);
      expect(document.documentElement.matches("html:has(> body > #root > .lp)")).toBe(true);
      expect(css).toMatch(/html:has\(> body > #root > \.lp\)\s*\{\s*scroll-behavior:\s*smooth/);
      // The never-matching form must not come back.
      expect(css).not.toMatch(/html:has\(> #root/);
    } finally {
      root.remove();
      if (previous) document.body.appendChild(previous);
    }
  });

  it("drops back to an immediate jump under prefers-reduced-motion", () => {
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toMatch(/html:has\(> body > #root > \.lp\)\s*\{\s*scroll-behavior:\s*auto/);
    // And the landing page cannot depend on the chat shell's global override.
    expect(reduced).toMatch(/scroll-behavior:\s*auto/);
  });

  it("offsets every anchor target so headings clear the sticky nav", async () => {
    render(<Landing />);
    await waitFor(() => expect(document.querySelectorAll("a[href^='#']").length).toBeGreaterThan(0));

    // Every fragment link resolves to a real element.
    for (const anchor of [...document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')]) {
      const target = document.getElementById(anchor.hash.slice(1));
      expect(target, anchor.getAttribute("href") ?? undefined).toBeTruthy();
    }

    // ...and the stylesheet gives those targets a scroll margin.
    expect(css).toMatch(/\.lp-section\s*\{[^}]*scroll-margin-top:/);
    expect(css).toMatch(/#lp-main\s*\{\s*scroll-margin-top:/);
  });

  it("makes each section link destination focusable for keyboard users", async () => {
    render(<Landing />);
    await waitFor(() => expect(document.getElementById("how-it-works")).toBeTruthy());

    for (const id of ["topics", "how-it-works", "about"]) {
      const section = document.getElementById(id)!;
      expect(section.tagName).toBe("SECTION");
      expect(section.getAttribute("tabindex")).toBe("-1");
    }
    // The skip link's target too.
    expect(document.getElementById("lp-main")!.getAttribute("tabindex")).toBe("-1");
  });

  it("keeps section links as plain anchors so route navigation stays separate", async () => {
    render(<Landing />);
    await waitFor(() => expect(document.getElementById("how-it-works")).toBeTruthy());

    // In-page links are real fragment hrefs (native handling: hash, history,
    // focus), never upgraded into route navigation. The nav and the drawer
    // both carry the same three links.
    const banner = screen.getByRole("banner") as HTMLElement;
    const drawer = document.getElementById("lp-nav-drawer")!;
    for (const name of ["Topics", "How it works", "What it does"]) {
      const links = [
        ...within(banner).getAllByRole("link", { name }),
        ...within(drawer).getAllByRole("link", { name, hidden: true }),
      ];
      expect(links.length).toBeGreaterThanOrEqual(2); // desktop nav + drawer
      for (const link of links) {
        expect(link.getAttribute("href")).toMatch(/^#[a-z-]+$/);
        expect(document.getElementById(link.getAttribute("href")!.slice(1))).toBeTruthy();
      }
    }
    // The route link is not a fragment link.
    expect(within(banner).getByRole("link", { name: /Try the Chat/ }).getAttribute("href")).toBe("/chat");
  });
});

describe("landing — gutter backdrop", () => {
  const css = readLandingCss();

  it("renders one decorative layer as main's first child, inert to everyone", async () => {
    render(<Landing />);
    const main = screen.getByRole("main");
    const backdrop = main.querySelector(".lp-main-bg");

    expect(backdrop, "the gutter backdrop must render").toBeTruthy();
    expect(main.firstElementChild).toBe(backdrop);
    // Decorative: hidden from assistive tech and containing nothing that can
    // take focus, be clicked, or be read as content.
    expect(backdrop!.getAttribute("aria-hidden")).toBe("true");
    expect(backdrop!.querySelectorAll("a, button, input, select, textarea, [tabindex]")).toHaveLength(0);
    expect(backdrop!.textContent).toBe("");
    // Exactly two network strips — no competing full-page graph system.
    expect(main.querySelectorAll(".lp-main-net")).toHaveLength(2);
    expect(main.querySelectorAll(".lp-main-bg svg")).toHaveLength(2);
  });

  it("stays out of the layout and behind the real content", () => {
    // Positioned, zero-inset, clipped, and transparent to the pointer: the
    // layer can only paint, never size, move, or intercept.
    expect(css).toMatch(/\.lp-main-bg\s*\{[^}]*position:\s*absolute/);
    expect(css).toMatch(/\.lp-main-bg\s*\{[^}]*inset:\s*0/);
    expect(css).toMatch(/\.lp-main-bg\s*\{[^}]*pointer-events:\s*none/);
    expect(css).toMatch(/\.lp-main-bg\s*\{[^}]*overflow:\s*hidden/);
    // Real sections stack above the layer.
    expect(css).toMatch(/\.lp-main > \.lp-section\s*\{[^}]*z-index:\s*1/);
    // ...and the column itself is untouched: same max-width as before.
    expect(css).toMatch(/\.lp-section\s*\{[^}]*max-width:\s*1200px/);
  });

  it("keeps the dot grid and the static network under reduced motion", () => {
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    // The travelling signals are gone, the draw-in and the node pulse are
    // frozen on their finished state...
    expect(reduced).toMatch(/\.lp-main-bg \.lp-signal/);
    expect(reduced).toMatch(/\.lp-main-edge/);
    expect(reduced).toMatch(/\.lp-main-node-hi/);
    // ...while the grid itself is plain background painting, not animation.
    expect(css).toMatch(/\.lp-main-dots\s*\{[^}]*background-image:\s*radial-gradient/);
  });
});
