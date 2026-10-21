/**
 * Curated fallback tutor: deterministic, offline, always available.
 *
 * It is NOT a generative model. It never emits text deltas (no fake token
 * streaming) — it returns structured, level-appropriate lesson blocks from the
 * curated topic catalog, runs the deterministic solver when the message asks
 * for a computed example, and never invents numerical results. Responses are
 * surfaced to the student with an explicit "Curated" label by the caller.
 */
import type { ChatBlock, LearningLevel } from "../../../../shared/contract.js";
import { getTopic } from "../../data/topics.js";
import { getQuizQuestions } from "../../data/quiz-bank.js";
import {
  curatedExamples,
  examplesForTopic,
  resolveComputation,
  traceFromResult,
  type CuratedExample,
} from "../algorithms/curated-examples.js";
import { runSolver } from "../algorithms/registry.js";
import { detectTopicId, isTopicId, TOPIC_IDS, type TopicId } from "./topic-detection.js";
import type { TutorContext, TutorProvider, TutorReply, TutorStreamHandlers } from "./types.js";

function lessonIntro(topic: NonNullable<ReturnType<typeof getTopic>>, level: LearningLevel): ChatBlock[] {
  const levelNote: Record<LearningLevel, string> = {
    beginner: "Explained at a beginner level.",
    intermediate: "Explained with some formalism.",
    formal: "Full formal treatment below.",
  };
  return [
    {
      type: "text",
      markdown: `**${topic.title}.** ${topic.description}\n\n_${levelNote[level]} ${topic.summary}_`,
    },
  ];
}

function workedExampleBlock(topic: NonNullable<ReturnType<typeof getTopic>>): ChatBlock {
  return {
    type: "text",
    markdown: `**Worked example: ${topic.workedExample.title}.**\n\n${topic.workedExample.input}\n\n${topic.workedExample.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n\n**Result.** ${topic.workedExample.result}`,
  };
}

function computedExampleBlocks(example: CuratedExample, variant: "primary" | "another"): ChatBlock[] {
  const result = runSolver(example.solverId, example.input);
  const lead =
    variant === "primary"
      ? `**${example.title}.** ${example.narrative.join(" ")}`
      : `**Another example — ${example.title}.** ${example.narrative.join(" ")}`;
  return [
    { type: "text", markdown: lead },
    { type: "algorithm_trace", trace: traceFromResult(result) },
  ];
}

function quizBlock(topicId: string): ChatBlock {
  const questions = getQuizQuestions(topicId);
  return {
    type: "quiz",
    quiz: {
      id: `quiz-${topicId}-${Date.now()}`,
      topicId,
      title: `Practice quiz — ${getTopic(topicId)?.title ?? topicId}`,
      questions: questions.slice(0, 5),
    },
  };
}

export class CuratedFallbackProvider implements TutorProvider {
  readonly name = "curated_fallback";

  /**
   * The sidebar selection is optional context. When the message itself
   * establishes or switches the topic, the message wins. Keyword detection is
   * deliberately narrow to avoid spurious switches — the full set of topics
   * is covered by the shared detector (used by the model-driven path too).
   */
  private detectTopic(context: TutorContext): TopicId {
    const message = context.message;
    const detectedByPlan = isTopicId((context as { planTopicId?: unknown }).planTopicId)
      ? ((context as { planTopicId?: unknown }).planTopicId as TopicId)
      : undefined;
    return detectTopicId(message, context.topicId ?? "polynomial-reductions", detectedByPlan);
  }

  async generateReply(context: TutorContext, _streaming?: TutorStreamHandlers): Promise<TutorReply> {
    const blocks = this.buildReplyBlocks(context);
    return { mode: "curated_fallback", blocks, topicId: this.detectTopic(context) };
  }

  private buildReplyBlocks(context: TutorContext): ChatBlock[] {
    const message = context.message.toLowerCase();
    const topicId = this.detectTopic(context);
    const topic = getTopic(topicId);

    if (!topic) {
      return [
          {
            type: "text",
            markdown:
              "I don't have a lesson for that topic yet. Supported topics: **Foundations of Polynomial Reductions**, **Formal Polynomial-Time Reductions**, **The Cook–Levin Theorem**, **Approximation Algorithms**, and **Randomized Algorithms**. Pick one from the topic menu.",
          },
        ];
    }

    const isFollowUp = context.history.length > 0;

    const wantsQuiz = /quiz|test me|practice questions/.test(message);
    const wantsSimply = /more simply|simpler|easier|explain like/.test(message);
    const wantsFormal = /formal proof|formal statement|rigorous|theorem|proof/.test(message);
    const wantsMisconceptions = /misconception|mistake|wrong|confus/.test(message);
    const wantsObjectives = /objective|learning outcomes|goal/.test(message);
    const wantsAnother = /another (example|instance)|second example|different example/.test(message);
    const wantsCompare = /compar|versus|\bvs\b|difference between|contrast/.test(message);
    const computation = resolveComputation(message, context.topicId);

    // Comparison: point-by-point differences between two named supported
    // topics, built only from reviewed topic material (offline mode has no
    // generative comparison, so it stays strictly within the book data).
    if (wantsCompare && isFollowUp) {
      const named = TOPIC_IDS.filter((slug) => slug !== topicId && matchesTopicKeyword(message, slug));
      const a = getTopic(named[0] ?? (topicId === "approximation-algorithms" ? "randomized-algorithms" : "approximation-algorithms"));
      const b = topic;
      if (a && b) {
        return [
          {
            type: "text",
            markdown: `**${a.title} vs ${b.title}.**\n\n**${a.title}:** ${a.analysis}\n\n**${b.title}:** ${b.analysis}\n\n**The core difference.** ${a.title} is covered via ${a.visualization.description}; ${b.title} via ${b.visualization.description}. Their guarantees differ: ask me to *run the ${a.title}* or *run the ${b.title}* demo to see each verified result computed by the deterministic solver.`,
          },
        ];
      }
    }

    // Quiz bypasses everything else.
    if (wantsQuiz) {
      return [
          quizBlock(topicId),
          {
            type: "text",
            markdown:
              "Answer each question and submit — grading is deterministic and happens on the backend, with an explanation for every answer.",
          },
        ];
    }

    // An explicit algorithm request ("run a Max-Cut demo") answers with the
    // verified computation regardless of the lesson context.
    if (computation && computation.explicit) {
      const blocks = computedExampleBlocks(computation.example, wantsAnother ? "another" : "primary");
      blocks.push({
        type: "text",
        markdown: `**Why this fits.** ${topic.intuition}\n\nEvery number in the trace above came from the app's deterministic solver — not generated text. Ask *"why"*, *"more simply"*, or *"quiz me"* for the next step.`,
      });
      return blocks;
    }

    // Follow-up: simpler explanation.
    if (wantsSimply && isFollowUp) {
      const firstStep = topic.workedExample.steps[0];
      const keyTerm = topic.keyTerms[0];
      return [
          { type: "text", markdown: `**In plain language.** ${topic.intuition}` },
          {
            type: "text",
            markdown: [
              firstStep ? `**Concretely.** ${firstStep}` : null,
              keyTerm
                ? `**One term to remember:** ${keyTerm.term} — ${keyTerm.definition}`
                : null,
            ]
              .filter(Boolean)
              .join("\n\n"),
          },
        ];
    }

    // Follow-up: formal statement / proof sketch.
    if (wantsFormal && isFollowUp) {
      return [
          { type: "text", markdown: `**Formal statement.** ${topic.formalStatement}` },
          {
            type: "callout",
            variant: "info",
            title: "Proof sketch",
            markdown: `The proof rests on the formal definition above. Key steps:\n\n1. State the assumptions precisely.\n2. Apply the transformation or algorithm.\n3. Verify the result against the definition.\n\n${topic.analysis}`,
          },
        ];
    }

    // Follow-up: another example from the SAME topic.
    if ((wantsAnother || /give me another/.test(message)) && isFollowUp) {
      const topicExamples = examplesForTopic(topicId);
      const historyText = context.history
        .filter((h) => h.role === "assistant")
        .map((h) => h.content)
        .join("\n");
      const unseen = topicExamples.filter((e) => !historyText.includes(e.title));
      if (topicExamples.length > 1 && unseen.length > 0) {
        // Serve the next UNSEEN example so successive "another" requests
        // genuinely differ — content the student has not seen yet.
        const candidate = unseen[0];
        return [
          ...computedExampleBlocks(candidate, "another"),
          { type: "text", markdown: `**Takeaway.** ${topic.summary}` },
        ];
      }
      if (topicExamples.length > 0 && unseen.length === 0) {
        // Exhausted: do NOT replay the same content again. Say what happened
        // and stop offering the action (availableCuratedActions will omit it).
        return [
          {
            type: "text",
            markdown: `You have now seen every computed example for **${topic.title}** (${topicExamples.length} in total). There is nothing new to show offline — re-open any earlier trace above, or switch angle: ask for the **formal proof**, a **simpler explanation**, a practice **question**, or a **comparison**.`,
          },
        ];
      }
      if (topicExamples.length === 1) {
        // One canonical example and it has not been seen yet: show it.
        return [
          {
            type: "text",
            markdown: `This topic has one canonical computed example: **${topicExamples[0].title}**. I've re-shown it below so you can step through the trace again — try changing the framing question, or ask for the **formal proof** or a **simpler explanation** instead.`,
          },
          ...computedExampleBlocks(topicExamples[0], "primary"),
        ];
      }
      return [
        {
          type: "text",
          markdown: `There isn't a second worked example for **${topic.title}** yet. Alternative angles: ask for the **formal proof**, a **simpler explanation**, common **misconceptions**, or a **quiz**.`,
        },
      ];
    }

    // Lesson replay intents (no history required).
    if (wantsMisconceptions) {
      return [
          {
            type: "callout",
            variant: "warning",
            title: `Common misconceptions — ${topic.title}`,
            markdown: topic.misconceptions
              .map((m) => `- **Myth:** ${m.myth}\n  **Correction:** ${m.correction}`)
              .join("\n"),
          },
        ];
    }

    if (wantsObjectives) {
      return [
          {
            type: "text",
            markdown: `**Learning objectives — ${topic.title}.**\n\n${topic.objectives.map((o) => `- ${o}`).join("\n")}\n\n**Prerequisites.** ${topic.prerequisites.join("; ")}\n\n**Readiness check.** ${topic.readinessQuestions.join(" ")}`,
          },
        ];
    }

    if (/\bwhy\b|reason|rationale|purpose|how does it work/.test(message) && isFollowUp) {
      return [
          { type: "text", markdown: `**Why this matters.** ${topic.analysis}\n\n${topic.intuition}` },
        ];
    }

    // A non-explicit computation request ("give an example", "show a demo")
    // without follow-up history: run the topic's own example.
    if (computation && !computation.explicit && !isFollowUp) {
      return [
          ...lessonIntro(topic, context.level),
          ...computedExampleBlocks(computation.example, "primary"),
        ];
    }

    // Generic "example" wording mid-conversation with no other intent: show
    // the topic's canonical example (exactly once — a fresh trace, not the
    // full lesson replay again).
    if (computation && !computation.explicit && isFollowUp) {
      return computedExampleBlocks(computation.example, "primary");
    }

    // Follow-up questions that don't match a specific intent, and everything
    // uncovered above: give a focused answer from the topic material instead
    // of replaying the entire lesson template every time.
    if (isFollowUp) {
      return [
          { type: "text", markdown: `**Direct answer.** ${topic.summary}` },
          workedExampleBlock(topic),
          ...(topic.references.length > 0
            ? [
                {
                  type: "source_reference" as const,
                  ref: topic.references[0],
                },
              ]
            : []),
        ];
    }

    // First contact, no computation request: compact lesson (intuition,
    // formal statement, worked example, key terms, misconceptions, reference).
    // The notation table is folded into the key-terms table to avoid
    // repetitive boilerplate paragraphs on every turn.
    const blocks: ChatBlock[] = [
      ...lessonIntro(topic, context.level),
      { type: "text", markdown: `**Intuition.** ${topic.intuition}` },
      {
        type: "math",
        latex: topic.formalStatement.includes("≤p") ? "A \\leq_p B" : "\\text{See the formal statement below}",
        displayMode: true,
      },
      { type: "text", markdown: `**Formal statement.** ${topic.formalStatement}` },
      {
        type: "table",
        columns: [
          { key: "term", header: "Term" },
          { key: "definition", header: "Definition" },
        ],
        rows: topic.keyTerms.map((t) => ({ term: t.term, definition: t.definition })),
        caption: "Key terminology",
      },
      workedExampleBlock(topic),
      { type: "text", markdown: `**Analysis.** ${topic.analysis}` },
      {
        type: "callout",
        variant: "warning",
        title: "Common misconceptions",
        markdown: topic.misconceptions
          .map((m) => `- **Myth:** ${m.myth}\n  **Correction:** ${m.correction}`)
          .join("\n"),
      },
    ];
    if (topic.references.length > 0) {
      blocks.push({ type: "source_reference", ref: topic.references[0] });
    }
    return blocks;
  }
}

// Re-exported for the tutor route so both sides share one intent matcher.
export { curatedExamples };

// ---------------------------------------------------------------------------
// Contextual action availability (brief §5): derived server-side from the
// response context so the UI can hide rather than repeat unsupported actions.
// ---------------------------------------------------------------------------

const TOPIC_NAME_HINTS: { re: RegExp; slug: string }[] = [
  { re: /vertex[: ]?cover|2[- ]approx|approximation/i, slug: "approximation-algorithms" },
  { re: /max[- ]?cut|monte carlo|las vegas/i, slug: "randomized-algorithms" },
  { re: /cook[-\s]?levin|tableau/i, slug: "cook-levin" },
  { re: /independent set|≤\s?p\b|leq_?p|formal reduction/i, slug: "formal-reductions" },
  { re: /polynomial[- ]time reductions?/i, slug: "polynomial-reductions" },
];

function matchesTopicKeyword(text: string, slug: string): boolean {
  return TOPIC_NAME_HINTS.some((t) => t.slug === slug && t.re.test(text));
}

/**
 * Actions the curated (offline) tutor can actually honor for the NEXT turn.
 * Contextual availability only — generic intent keywords, not content:
 *   explain_simpler / formal_proof / comparison / practice are always
 *   derivable from topic material; "another example" is available only while
 *   at least one topic example has NOT been shown yet in this conversation.
 */
export function availableCuratedActions(context: Pick<TutorContext, "history">, topicId: string): string[] {
  const actions = ["explain_simpler", "formal_proof", "compare", "generate_practice_question"];
  const historyText = context.history
    .filter((h) => h.role === "assistant")
    .map((h) => h.content.slice(0, 3000))
    .join("\n");
  const unseen = examplesForTopic(topicId).filter((e) => !historyText.includes(e.title));
  if (unseen.length > 0) actions.push("another_example");
  return actions;
}
