/**
 * Assessment generator.
 *
 * Builds a mixed-topic assessment of EXACTLY the requested length (10, 20,
 * 30, 40, or 50 questions). There is no silent shortfall: if the system
 * cannot produce the full count from validated material, it reports an
 * explicit error rather than padding with filler or quietly returning fewer
 * questions than were asked for.
 *
 * Two sources, both validated, never mixed without saying so:
 *
 *   1. The active AI provider (xKiro), called through the SAME backend
 *      abstraction as chat — the browser never generates a question. Every
 *      batch is grounded in the canonical lesson for its topic, and every
 *      question that asserts a computed value is re-checked against the
 *      deterministic solver before it can be published.
 *
 *   2. The curated question bank, used when the provider is unavailable or
 *      fails. It is offered ONLY when it can satisfy the full requested
 *      length without repeating a question, and the result is labelled
 *      "curated" so nobody mistakes it for freshly generated material.
 *
 * `source` is "mixed" whenever both contributed, because calling a
 * half-generated paper "ai" would overstate what the model actually did.
 *
 * Everything here is deterministic given its dependencies. The provider is
 * injected, so tests exercise the real pipeline against a mocked model and
 * never spend a live call.
 */
import { z } from "zod";
import type {
  AssessmentCoverage,
  AssessmentQuestion,
  QuizCount,
  QuizDifficultySetting,
  QuizFormat,
} from "../../../../shared/contract.js";
import { getTopic, listTopicSummaries } from "../../data/topics.js";
import { getQuizQuestions } from "../../data/quiz-bank.js";
import type { StoredAssessmentQuestion } from "./session-store.js";
import { interleave, planDistribution } from "./distribution.js";
import {
  findDuplicatesAgainst,
  validateQuestion,
  type NormalizedQuestion,
  type QuestionRejection,
  type RawGeneratedQuestion,
} from "./validate-questions.js";
import { assertsComputedValue, verifyAgainstSolver } from "./verify-solver.js";

// ---------------------------------------------------------------------------
// Provider abstraction
// ---------------------------------------------------------------------------

/**
 * The one thing the generator needs from the AI layer: a structured JSON
 * completion. Injected so tests run the whole pipeline deterministically.
 */
export interface QuestionProvider {
  readonly name: string;
  complete(params: { system: string; user: string; signal?: AbortSignal }): Promise<string>;
}

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/**
 * Bounded regeneration. A failing batch is retried with the specific
 * rejections fed back to the model, but never more than this many attempts —
 * an unbounded retry loop is how a quiz endpoint becomes a cost incident.
 */
const MAX_BATCH_ATTEMPTS = 3;

/** Questions per provider call. Keeps every response small enough to validate in one pass. */
const BATCH_SIZE = 10;

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

export interface GenerateAssessmentInput {
  count: QuizCount;
  topicId?: string;
  difficulty?: QuizDifficultySetting;
  format?: QuizFormat;
  signal?: AbortSignal;
}

export type GenerateAssessmentOutcome =
  | {
      ok: true;
      questions: StoredAssessmentQuestion[];
      source: "ai" | "curated" | "mixed";
      topicCoverage: AssessmentCoverage[];
      title: string;
      scope: "combined" | "single";
      /** Honest, human-readable notes about what happened (e.g. a provider failure). */
      notes: string[];
    }
  | { ok: false; code: string; message: string };

/**
 * Resolve which topics an assessment covers, straight from the canonical
 * catalog — never a second hardcoded list. An unknown `topicId` is a 404
 * with the real slugs attached, so a stale client link is fixable by reading
 * the error.
 */
export function resolveScope(topicId?: string): { ok: true; topicIds: string[]; scope: "combined" | "single" } | { ok: false; code: string; message: string } {
  const catalog = listTopicSummaries();
  if (topicId === undefined) {
    if (catalog.length === 0) {
      return { ok: false, code: "no_topics", message: "The topic catalog is empty, so no assessment can be built." };
    }
    return { ok: true, topicIds: catalog.map((t) => t.slug), scope: "combined" };
  }
  const topic = getTopic(topicId);
  if (!topic) {
    return {
      ok: false,
      code: "topic_not_found",
      message: `No topic with id "${topicId}". Available: ${catalog.map((t) => t.slug).join(", ")}.`,
    };
  }
  return { ok: true, topicIds: [topicId], scope: "single" };
}

// ---------------------------------------------------------------------------
// Prompt construction (grounded in canonical lesson content)
// ---------------------------------------------------------------------------

/**
 * Build the grounding material for one topic from the canonical lesson. The
 * model is given objectives, key terms, the formal statement, the worked
 * example, notation, and misconceptions — so questions check what the lesson
 * actually teaches rather than whatever the model remembers.
 *
 * Bounded per field: a lesson is long, and a prompt that is mostly context
 * leaves no room for the questions themselves.
 */
function groundingFor(topicId: string): string {
  const topic = getTopic(topicId);
  if (!topic) return `Topic slug: ${topicId}`;
  const lines: string[] = [`TOPIC: ${topic.title} (${topic.slug})`, topic.description];
  if (topic.objectives.length) {
    lines.push("LEARNING OBJECTIVES:\n" + topic.objectives.map((o) => `- ${o}`).join("\n"));
  }
  if (topic.keyTerms.length) {
    lines.push(
      "KEY TERMS:\n" +
        topic.keyTerms.map((k) => `- ${k.term}: ${k.definition}`).join("\n"),
    );
  }
  if (topic.formalStatement) lines.push(`FORMAL STATEMENT:\n${topic.formalStatement}`);
  if (topic.notation.length) {
    lines.push(
      "NOTATION:\n" + topic.notation.map((n) => `- ${n.symbol} = ${n.meaning}`).join("\n"),
    );
  }
  if (topic.workedExample) {
    lines.push(
      `WORKED EXAMPLE — ${topic.workedExample.title}\n` +
        `Input: ${topic.workedExample.input}\n` +
        `Result: ${topic.workedExample.result}`,
    );
  }
  if (topic.misconceptions.length) {
    lines.push(
      "COMMON MISCONCEPTIONS (good source of distractors — do not simply restate them as questions):\n" +
        topic.misconceptions.map((m) => `- ${m.myth}`).join("\n"),
    );
  }
  return lines.filter(Boolean).join("\n\n");
}

const JSON_SHAPE = `{
  "questions": [
    {
      "prompt": "string, 12-400 chars",
      "kind": "multiple_choice | true_false | numerical",
      "choices": ["array of 2-6 DISTINCT strings, required for multiple_choice and true_false", "true_false must be exactly True and False"],
      "answer": 0,
      "hint": "string, non-empty, must NOT reveal the answer",
      "difficulty": "easy | medium | hard",
      "explanation": "string, non-empty, must name the correct answer",
      "verification": {
        "solver": "vertex-cover-2approx | randomized-max-cut | reduction-is-to-vc | cook-levin-tableau",
        "input": { "the exact solver input object" },
        "key": "the result field holding the authoritative value",
        "appliesTo": "answer"
      }
    }
  ]
}`;

const SYSTEM_PROMPT = [
  "You write assessment questions for G7 Algo, a course on algorithms and complexity theory.",
  "You output ONLY JSON, matching this shape exactly:",
  JSON_SHAPE,
  "",
  "HARD RULES:",
  "- Each question must be INDEPENDENT: it must be answerable without seeing any other question, and must not reference 'the previous question'.",
  "- Every question must be checkable against the canonical lesson material supplied. Do not invent facts, theorems, or numbers that are not supported by that material or by the solver run described below.",
  "- A question that asserts a COMPUTED value (a cut size, a cover size, a number of variables or clauses, a target parameter, a tableau size) MUST carry a `verification` block naming the deterministic solver that computes it, the input to run, and the result key. The server re-runs that solver and REJECTS the question if its answer disagrees.",
  "- Conceptual questions (definitions, theorem statements, why something is true) do not need `verification`.",
  "- Distractors must be plausible but clearly wrong to someone who understood the lesson. Do not use joke answers.",
  "- The `hint` must help a struggling student think, and must never state or imply the correct answer.",
  "- The `explanation` must say WHY the correct answer is correct, and name it.",
  "- true/false questions must offer exactly True and False, and must be unambiguous.",
  "- Do not repeat or lightly rephrase another question.",
  "",
  "Difficulty mix: mostly medium, with some easy and some hard.",
].join("\n");

/**
 * Ask the model for one batch of questions, with the already-accepted prompts
 * listed so it can avoid repeating them.
 */
function batchUserPrompt(params: {
  topicId: string;
  quota: number;
  acceptedPrompts: string[];
  format: QuizFormat;
  /** Rejections from the previous attempt, fed back so the retry fixes them. */
  feedback?: string;
}): string {
  const parts = [
    groundingFor(params.topicId),
    "",
    `Write exactly ${params.quota} questions for the topic above.`,
    `Format: ${
      params.format === "mixed"
        ? "a mix of multiple_choice and true_false (and numerical only when the question asserts a value the solver can verify)."
        : params.format === "multiple_choice"
          ? "multiple_choice only."
          : "true_false only."
    }`,
  ];
  if (params.feedback) {
    parts.push("", params.feedback);
  }
  if (params.acceptedPrompts.length) {
    parts.push(
      "",
      "These questions already exist in this assessment. Do NOT repeat or lightly rephrase any of them:",
      ...params.acceptedPrompts.map((p, i) => `${i + 1}. ${p}`),
    );
  }
  parts.push("", "Output only the JSON object.");
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Parsing + substantive validation of one batch
// ---------------------------------------------------------------------------

const batchSchema = z.object({
  questions: z.array(z.unknown()).min(1).max(BATCH_SIZE * 2),
});

interface BatchResult {
  accepted: NormalizedQuestion[];
  rejections: QuestionRejection[];
}

/**
 * Parse a model batch and run every check: JSON shape, per-question
 * validation, duplicate detection against what is already accepted, and the
 * solver re-run for any computed claim.
 *
 * Note the ordering: duplicates are judged against the accepted prompts so
 * far, and a question that fails the solver check is dropped BEFORE it can be
 * compared, so a rejected near-duplicate does not block its own corrected
 * retry.
 */
function parseBatch(
  raw: string,
  topicId: string,
  acceptedPrompts: string[],
): { ok: true; batch: BatchResult } | { ok: false; rejections: QuestionRejection[] } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, rejections: [{ code: "invalid_json", message: "The provider response was not valid JSON." }] };
  }

  const parsed = batchSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      rejections: [{ code: "invalid_shape", message: 'The provider response must be {"questions": [...]}.' }],
    };
  }

  const accepted: NormalizedQuestion[] = [];
  const rejections: QuestionRejection[] = [];

  for (const [index, candidate] of parsed.data.questions.entries()) {
    const result = validateQuestion(candidate as RawGeneratedQuestion, topicId, index);
    if (!result.ok) {
      rejections.push(...result.rejections);
      continue;
    }

    const q = result.question;
    // The server owns ids, always. A model-supplied id is discarded rather
    // than trusted: a duplicate id would make two questions share one answer
    // slot (silently misgrading the paper), and a forged id could collide
    // with a curated fallback item. Unique per accepted question, and unique
    // across topics because the topic id is part of it.
    q.id = `${topicId}-${accepted.length}-${Math.random().toString(36).slice(2, 8)}`;

    // Solver authority: re-run and compare. A mismatch rejects the question —
    // we never "correct" the model's number to the solver's, because if the
    // number is wrong the surrounding wording is probably wrong too.
    if (q.verification) {
      const check = verifyAgainstSolver(q.verification, q.answer);
      if (check.status === "mismatch") {
        rejections.push({
          code: "solver_mismatch",
          message:
            `question ${index + 1}: the solver computes ${check.value} but the question says ${check.expected}.`,
        });
        continue;
      }
      if (check.status === "unverifiable") {
        rejections.push({
          code: "solver_unverifiable",
          message: `question ${index + 1}: ${check.reason}.`,
        });
        continue;
      }
    } else if (assertsComputedValue(q)) {
      // A computed claim with no way to check it. Publishing it would mean
      // presenting a model guess as a verified fact.
      rejections.push({
        code: "computed_unverified",
        message:
          `question ${index + 1}: asserts a computed value but carries no verification block, so it cannot be checked against a solver.`,
      });
      continue;
    }

    const duplicates = findDuplicatesAgainst(q.prompt, [...acceptedPrompts, ...accepted.map((a) => a.prompt)]);
    if (duplicates.length > 0) {
      rejections.push({
        code: "duplicate",
        message: `question ${index + 1}: duplicates an existing question ("${q.prompt.slice(0, 60)}...").`,
      });
      continue;
    }

    accepted.push(q);
  }

  return { ok: true, batch: { accepted, rejections } };
}

/** Rejection feedback shown to the model on the next attempt. */
function feedbackFor(rejections: QuestionRejection[]): string {
  const byCode = new Map<string, number>();
  for (const r of rejections) byCode.set(r.code, (byCode.get(r.code) ?? 0) + 1);
  const summary = [...byCode.entries()].map(([code, n]) => `${code} (${n})`).join(", ");
  return [
    `Your last attempt was rejected. Problems found: ${summary || "unknown"}.`,
    "Fix every one of these and return the full corrected batch:",
    ...rejections.slice(0, 12).map((r) => `- ${r.message}`),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/**
 * Generate one assessment. The returned questions are already validated,
 * solver-checked, de-duplicated, interleaved, and numbered by position; the
 * caller stores them and never has to re-check.
 */
export async function generateAssessment(
  input: GenerateAssessmentInput,
  provider: QuestionProvider | null,
): Promise<GenerateAssessmentOutcome> {
  const scope = resolveScope(input.topicId);
  if (!scope.ok) return scope;

  const notes: string[] = [];
  const { topicIds, scope: scopeKind } = scope;
  const format = input.format ?? "mixed";
  const plan = planDistribution(input.count, topicIds, offsetForRotation());

  const byTopic = new Map<string, StoredAssessmentQuestion[]>();
  let producedByAi = 0;
  let producedCurated = 0;

  /**
   * Every prompt already accepted for THIS assessment, across every topic.
   * De-duplication is global rather than per-topic: a student must not see
   * the same question twice just because it surfaced under two headings.
   */
  const taken: string[] = [];

  for (const quota of plan.quotas) {
    const group: StoredAssessmentQuestion[] = [];

    if (provider) {
      const accepted: NormalizedQuestion[] = [];
      let lastRejections: QuestionRejection[] = [];

      // Ask for a BOUNDED batch, never the whole quota: the batch schema caps
      // what it will accept, so requesting 40 in one shot would be rejected as
      // malformed and no question at all would land. Filling a long paper takes
      // several bounded passes instead.
      //
      // The attempt ceiling scales with the quota for the same reason — a fixed
      // three attempts could never reach 40 — but it is always finite, so a
      // provider that answers with garbage still terminates after a small,
      // predictable number of calls.
      const maxAttempts = Math.max(
        MAX_BATCH_ATTEMPTS,
        Math.ceil(quota.count / BATCH_SIZE) + 1,
      );

      for (let attempt = 0; attempt < maxAttempts && accepted.length < quota.count; attempt++) {
        const want = Math.min(quota.count - accepted.length, BATCH_SIZE);
        try {
          const raw = await provider.complete({
            system: SYSTEM_PROMPT,
            user: batchUserPrompt({
              topicId: quota.topicId,
              quota: want,
              acceptedPrompts: taken,
              format,
              // A retry that re-sends the identical prompt gets the identical
              // rejection. Feed the specific failures back so the second
              // attempt can actually fix them.
              ...(attempt > 0 && lastRejections.length > 0 ? { feedback: feedbackFor(lastRejections) } : {}),
            }),
            signal: input.signal,
          });
          const parsed = parseBatch(raw, quota.topicId, taken);
          if (!parsed.ok) {
            lastRejections = parsed.rejections;
            continue;
          }
          for (const q of parsed.batch.accepted) {
            if (accepted.length >= quota.count) break;
            accepted.push(q);
            taken.push(q.prompt);
          }
          if (parsed.batch.rejections.length) lastRejections = parsed.batch.rejections;
        } catch (err) {
          // A provider failure (timeout, cooldown, blocked content) is not
          // retried here: the caller decides whether to fall back. Bounded
          // retry of a hard provider error is how you turn one failure into
          // a rate-limit spiral.
          lastRejections = [
            {
              code: "provider_error",
              message: err instanceof Error ? err.message.slice(0, 200) : "the provider failed",
            },
          ];
          break;
        }
      }

      if (accepted.length < quota.count) {
        notes.push(
          `The AI provider produced ${accepted.length} of ${quota.count} questions for this topic` +
            (lastRejections.length ? ` (${lastRejections[0].message})` : "") +
            ".",
        );
      }

      for (const q of accepted) {
        group.push({
          id: q.id,
          topicId: q.topicId,
          prompt: q.prompt,
          kind: q.kind,
          choices: q.choices,
          hint: q.hint,
          difficulty: q.difficulty,
          answer: q.answer,
          explanation: q.explanation,
        });
      }
      producedByAi += group.length;
    }

    // Top up from the curated bank when the provider fell short. The bank is
    // validated material, not filler — but it is counted separately so the
    // final label stays honest.
    if (group.length < quota.count) {
      const shortfall = quota.count - group.length;
      // Respect the requested format exactly. The bank holds no true/false
      // items, so a true/false paper cannot be topped up at all — silently
      // substituting multiple-choice questions would misrepresent the paper.
      const pool = getQuizQuestions(quota.topicId).filter((q) =>
        format === "mixed" ? true : q.kind === format,
      );
      const existing = new Set(group.map((g) => g.prompt));
      const usable = pool.filter((q) => !existing.has(q.prompt));
      if (usable.length >= shortfall) {
        for (let i = 0; i < shortfall; i++) {
          const q = usable[i];
          group.push({
            id: `${q.id}-${i}`,
            topicId: quota.topicId,
            prompt: q.prompt,
            kind: q.kind,
            choices: q.choices ?? null,
            hint: q.hint,
            difficulty: q.difficulty,
            answer: q.answer,
            explanation: q.rationale,
          });
          // Banked questions join the global de-duplication set, so a later
          // topic is never asked to write a question the bank already has.
          taken.push(q.prompt);
        }
        producedCurated += shortfall;
        if (provider) {
          notes.push(`Filled ${shortfall} question(s) for this topic from the curated bank.`);
        }
      }
    }

    if (group.length < quota.count) {
      return {
        ok: false,
        code: "insufficient_content",
        message:
          `Could not build a ${input.count}-question assessment: the topic "${quota.topicId}" yielded only ` +
          `${group.length} of the ${quota.count} questions required, and the validated question bank cannot ` +
          `make up the difference without repeating itself. Try a shorter length, or a single topic.`,
      };
    }

    byTopic.set(quota.topicId, group);
  }

  // Mixed order: interleave topics so a combined paper is not five blocks.
  const ordered = interleave([...byTopic.values()]);

  if (ordered.length !== input.count) {
    return {
      ok: false,
      code: "count_mismatch",
      message:
        `Internal error: assembled ${ordered.length} questions for a requested ${input.count}. ` +
        `No assessment was created.`,
    };
  }

  const topicCoverage: AssessmentCoverage[] = plan.quotas.map((quota) => ({
    topicId: quota.topicId,
    title: getTopic(quota.topicId)?.title ?? quota.topicId,
    count: quota.count,
  }));

  const source: "ai" | "curated" | "mixed" =
    producedByAi > 0 && producedCurated > 0 ? "mixed" : producedCurated > 0 ? "curated" : "ai";

  return {
    ok: true,
    questions: ordered,
    source,
    topicCoverage,
    title: titleFor(scopeKind, topicIds, input.count),
    scope: scopeKind,
    notes,
  };
}

/** Rotation offset so short assessments cover different topics across runs. */
function offsetForRotation(): number {
  return Math.floor(Date.now() / 60_000) % 97;
}

function titleFor(scope: "combined" | "single", topicIds: string[], count: QuizCount): string {
  if (scope === "combined") return `Combined Quiz — All Topics (${count} questions)`;
  const title = getTopic(topicIds[0])?.title ?? topicIds[0];
  return `${title} — ${count} questions`;
}

export { MAX_BATCH_ATTEMPTS, BATCH_SIZE, SYSTEM_PROMPT, groundingFor, batchUserPrompt, parseBatch };
export type { NormalizedQuestion };
