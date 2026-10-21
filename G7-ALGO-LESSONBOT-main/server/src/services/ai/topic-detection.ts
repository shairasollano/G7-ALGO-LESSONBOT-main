/**
 * Topic detection shared by every provider path.
 *
 * The sidebar selection is optional context, never a prerequisite: when the
 * student's message clearly names a topic, the message wins. Keyword
 * detection is intentionally narrow (the model-driven orchestrator does the
 * rich intent work; this module only backstops deterministic paths).
 */
import { topics } from "../../data/topics.js";

export const TOPIC_IDS = topics.map((t) => t.slug);
export type TopicId = (typeof TOPIC_IDS)[number];

export function isTopicId(value: unknown): value is TopicId {
  return typeof value === "string" && (TOPIC_IDS as string[]).includes(value);
}

interface TopicSignal {
  re: RegExp;
  slug: string;
}

/**
 * Ordered most-specific first. Each signal requires topic-NAMING wording, so
 * "now compare it with randomized Max-Cut" switches topics while a generic
 * "explain this" keeps the conversation's current topic.
 */
const TOPIC_SIGNALS: TopicSignal[] = [
  // Max-Cut / Monte Carlo / Las Vegas → randomized algorithms.
  { re: /max[- ]?cut/i, slug: "randomized-algorithms" },
  { re: /monte carlo|las vegas|coin[- ]flip algorithm/i, slug: "randomized-algorithms" },
  // Cook–Levin / tableau / NP-completeness of SAT.
  { re: /cook[-\s]?levin|tableau/i, slug: "cook-levin" },
  { re: /np[- ]completeness|sat\b/i, slug: "cook-levin" },
  // Vertex Cover 2-approximation and approximation wording.
  { re: /vertex[: ]?cover|2[- ]approx|approximation algorithm/i, slug: "approximation-algorithms" },
  // Formal reductions: independent set, ≤p mapping wording.
  { re: /independent set|≤\s?p\b|leq_?p|poly[- ]time mapping/i, slug: "formal-reductions" },
  { re: /formal (polynomial[- ]time )?reductions?|reduction definition/i, slug: "formal-reductions" },
  // Generic polynomial-time reductions (least specific).
  { re: /polynomial[- ]time reductions?|reductions? between problems/i, slug: "polynomial-reductions" },
];

/**
 * Determine the effective topic for a message.
 * 1. An explicitly provided topic override (model plan / caller) wins when valid.
 * 2. A topic-naming signal in the message itself wins over the selection.
 * 3. Otherwise the previously selected topic (optional context) is kept.
 */
export function detectTopicId(
  message: string,
  selectedTopicId?: string | null,
  explicitTopicId?: unknown,
): TopicId {
  if (isTopicId(explicitTopicId)) return explicitTopicId;
  for (const signal of TOPIC_SIGNALS) {
    if (signal.re.test(message)) return signal.slug as TopicId;
  }
  return (isTopicId(selectedTopicId) ? selectedTopicId : "polynomial-reductions") as TopicId;
}
