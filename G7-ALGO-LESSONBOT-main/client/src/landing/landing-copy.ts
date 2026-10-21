/**
 * Landing-page structure and copy that is not a one-off string in JSX.
 *
 * Nothing here describes a feature the app does not have: every capability
 * listed is present in the repository (see the notes on each entry). Topic
 * copy is NOT duplicated here — the landing page reads the real catalog from
 * the API, so adding a topic to the server catalog adds it to the page.
 */

/** Anchor ids used by the navigation and the section headings. */
export const SECTION_IDS = {
  topics: "topics",
  how: "how-it-works",
  about: "about",
} as const;

/**
 * The curated subset shown next to the hero, so the first screen stays
 * manageable. Slugs are filtered against the real catalog before rendering —
 * a slug that no longer exists is simply not featured, never invented.
 */
export const FEATURED_TOPIC_SLUGS = ["cook-levin", "approximation-algorithms", "randomized-algorithms"] as const;

export interface Stage {
  title: string;
  body: string;
}

/**
 * The four stages of the learning loop. The last line of the section states
 * who does what: solvers compute, the explanation is written around the
 * computed result.
 */
export const HOW_IT_WORKS: Stage[] = [
  {
    title: "Ask in your own words",
    body: "Type a question, a theorem name, or a request for a worked example. No topic needs to be selected first — the server works out which topic your message is about and follows it.",
  },
  {
    title: "Get a worked example or a verified run",
    body: "When a question asks for a computation, the app's deterministic solver runs on a reviewed example and the trace is returned as structured data. Every number in that trace is computed, never generated.",
  },
  {
    title: "Inspect the graph, tableau or trace",
    body: "Results come back as blocks you can read: graph states, tableau grids, step tables, and a step-by-step trace with Prev/Next, so the reasoning is inspectable rather than asserted.",
  },
  {
    title: "Ask follow-ups",
    body: "Continue in the same conversation to go deeper — a simpler explanation, the formal statement, another example on the same topic, or a practice question from the validated bank.",
  },
];

export interface Capability {
  title: string;
  body: string;
}

/**
 * Real capabilities only. Sources in the repository:
 *  - four solvers: server/src/services/algorithms/registry.ts
 *  - three depth levels: LEARNING_LEVELS in shared/contract.ts
 *  - practice bank: server/src/data/quiz-bank.ts (graded server-side)
 *  - browser-local history: client/src/lib/conversations.ts (localStorage)
 *  - curated offline lessons: server/src/services/ai/curated-fallback.ts
 */
export const CAPABILITIES: Capability[] = [
  {
    title: "Four deterministic solvers",
    body: "Independent Set ≤p Vertex Cover, the bounded Cook–Levin tableau encoding, the 2-approximation for Vertex Cover, and seeded randomized Max-Cut. Each returns a full trace with its guarantee and complexity.",
  },
  {
    title: "Graphs, tableaux and step tables",
    body: "Solver output renders as an interactive graph with a state legend, a tableau grid, or a step table — the same blocks the chat uses, with a text description alongside every visual.",
  },
  {
    title: "Three depths of explanation",
    body: "Beginner, intermediate and formal. The formal level states definitions and proofs; the beginner level explains the same idea in plain language.",
  },
  {
    title: "Practice questions that are graded, not guessed",
    body: "Quizzes come from a curated bank with a definite answer key, a rationale and a hint, and are graded on the server rather than by the language model.",
  },
  {
    title: "Your history stays in your browser",
    body: "Conversations are stored in this browser's local storage only. There are no accounts, and nothing is uploaded or synced.",
  },
  {
    title: "Works without an AI provider",
    body: "With no provider configured, curated offline lessons answer instead, and every response is labelled with how it was produced — AI-generated or curated.",
  },
];

/** Headline copy for the closing call to action. */
export const CLOSING = {
  headline: "Your Next Algorithm Starts With a Question.",
  supporting: "Explore a theorem, run an algorithm, or ask why a result works.",
} as const;

/** Secondary navigation in the footer; every entry has a real destination. */
export const FOOTER_LINKS = [
  { label: "Topics", href: `#${SECTION_IDS.topics}` },
  { label: "How it works", href: `#${SECTION_IDS.how}` },
  { label: "What it does", href: `#${SECTION_IDS.about}` },
  { label: "Try the chat", href: "/chat" },
] as const;
