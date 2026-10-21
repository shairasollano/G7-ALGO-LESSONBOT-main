/**
 * Assessment question validation.
 *
 * A schema-valid question is only STRUCTURALLY valid. This module is the
 * substantive layer: it rejects questions that parse fine but would mislead a
 * student — duplicate items, two plausible correct options, an answer key
 * that contradicts the deterministic solver, a hint that gives the answer
 * away, an explanation that disagrees with the key.
 *
 * Everything here is deterministic and provider-independent. The model's
 * output is never trusted on its own authority: where a question asserts a
 * computed value, the solver is re-run and the answer is checked against it.
 */
import type { AssessmentQuestionKind, QuizDifficulty } from "../../../../shared/contract.js";
import { QUIZ_DIFFICULTIES } from "../../../../shared/contract.js";

/** One question as the model returns it (before normalization). */
export interface RawGeneratedQuestion {
  id?: unknown;
  topicId?: unknown;
  prompt?: unknown;
  kind?: unknown;
  choices?: unknown;
  answer?: unknown;
  hint?: unknown;
  difficulty?: unknown;
  explanation?: unknown;
  /** Optional solver cross-check the model may request. */
  verification?: unknown;
}

/**
 * A solver cross-check. When present, the question's answer MUST agree with
 * `solver(input).result[key]`; the solver wins any disagreement and the
 * question is rejected.
 */
export interface QuestionVerification {
  solver: string;
  input: Record<string, unknown>;
  /** Key into the solver's `result` object that holds the authoritative value. */
  key: string;
  /** Which field of the question the value must equal. */
  appliesTo: "answer" | "prompt";
}

export interface NormalizedQuestion {
  id: string;
  topicId: string;
  prompt: string;
  kind: AssessmentQuestionKind;
  choices: string[] | null;
  answer: number;
  hint: string;
  difficulty: QuizDifficulty;
  explanation: string;
  verification?: QuestionVerification;
}

export interface QuestionRejection {
  /** Stable machine code, for tests and regeneration feedback. */
  code: string;
  message: string;
}

export type QuestionValidation =
  | { ok: true; question: NormalizedQuestion }
  | { ok: false; rejections: QuestionRejection[] };

const MAX_PROMPT = 400;
const MAX_HINT = 220;
const MAX_EXPLANATION = 500;
const MAX_CHOICES = 6;
const MIN_CHOICES = 2;

function reject(code: string, message: string): QuestionValidation {
  return { ok: false, rejections: [{ code, message }] };
}

/**
 * Normalize and validate one generated question.
 *
 * `topicId` is supplied by the caller (the batch requested questions for a
 * specific topic), so a model that reports a different topic is corrected
 * rather than trusted — the assessment's coverage must reflect where a
 * question actually came from.
 */
export function validateQuestion(
  raw: RawGeneratedQuestion,
  expectedTopicId: string,
  index: number,
): QuestionValidation {
  const rejections: QuestionRejection[] = [];
  const tag = `question ${index + 1}`;

  const prompt = typeof raw.prompt === "string" ? raw.prompt.trim() : "";
  if (prompt.length < 12) {
    rejections.push({ code: "prompt_too_short", message: `${tag}: prompt is too short to assess anything.` });
  }
  if (prompt.length > MAX_PROMPT) {
    rejections.push({ code: "prompt_too_long", message: `${tag}: prompt exceeds ${MAX_PROMPT} characters.` });
  }

  const kindRaw = raw.kind;
  const kind: AssessmentQuestionKind | null =
    kindRaw === "multiple_choice" || kindRaw === "true_false" || kindRaw === "numerical"
      ? kindRaw
      : null;
  if (!kind) {
    rejections.push({ code: "unknown_kind", message: `${tag}: kind must be multiple_choice, true_false, or numerical.` });
    return { ok: false, rejections };
  }

  const hint = typeof raw.hint === "string" ? raw.hint.trim() : "";
  if (!hint) rejections.push({ code: "hint_missing", message: `${tag}: every question needs a hint.` });
  if (hint.length > MAX_HINT) {
    rejections.push({ code: "hint_too_long", message: `${tag}: hint exceeds ${MAX_HINT} characters.` });
  }

  const explanation = typeof raw.explanation === "string" ? raw.explanation.trim() : "";
  if (!explanation) {
    rejections.push({ code: "explanation_missing", message: `${tag}: every question needs an explanation.` });
  }
  if (explanation.length > MAX_EXPLANATION) {
    rejections.push({ code: "explanation_too_long", message: `${tag}: explanation exceeds ${MAX_EXPLANATION} characters.` });
  }

  const difficultyRaw = raw.difficulty;
  const difficulty: QuizDifficulty | null =
    difficultyRaw === "easy" || difficultyRaw === "medium" || difficultyRaw === "hard"
      ? difficultyRaw
      : null;
  if (!difficulty) {
    rejections.push({ code: "unknown_difficulty", message: `${tag}: difficulty must be easy, medium, or hard.` });
  }

  let choices: string[] | null = null;
  let answer: number | null = null;

  if (kind === "numerical") {
    // A numerical answer is a finite number; NaN/infinity never grade.
    const value = typeof raw.answer === "number" ? raw.answer : Number(raw.answer);
    if (!Number.isFinite(value)) {
      rejections.push({ code: "answer_invalid", message: `${tag}: numerical answer must be a finite number.` });
    } else {
      answer = value;
    }
    if (raw.choices !== undefined && raw.choices !== null) {
      rejections.push({ code: "choices_on_numerical", message: `${tag}: numerical questions must not carry choices.` });
    }
  } else {
    const list = Array.isArray(raw.choices) ? raw.choices : null;
    if (!list || list.length < MIN_CHOICES) {
      rejections.push({ code: "choices_missing", message: `${tag}: needs at least ${MIN_CHOICES} choices.` });
    } else if (list.length > MAX_CHOICES) {
      rejections.push({ code: "too_many_choices", message: `${tag}: at most ${MAX_CHOICES} choices are allowed.` });
    } else if (!list.every((c) => typeof c === "string" && c.trim().length > 0)) {
      rejections.push({ code: "choice_not_string", message: `${tag}: every choice must be a non-empty string.` });
    } else {
      choices = list.map((c) => (c as string).trim());
      // Exactly one correct answer requires DISTINCT options: two identical
      // (or identical-after-normalization) options make the key ambiguous.
      const normalized = choices.map(normalizeText);
      const unique = new Set(normalized);
      if (unique.size !== normalized.length) {
        rejections.push({
          code: "duplicate_choices",
          message: `${tag}: choices must be distinct — duplicates make more than one option correct.`,
        });
      }
      if (kind === "true_false") {
        const canonical = normalized.join("|");
        if (canonical !== "true|false" && canonical !== "false|true") {
          rejections.push({
            code: "true_false_choices",
            message: `${tag}: true/false questions must offer exactly True and False.`,
          });
        }
      }
      const idx = typeof raw.answer === "number" ? raw.answer : Number(raw.answer);
      if (!Number.isInteger(idx) || idx < 0 || idx >= choices.length) {
        rejections.push({
          code: "answer_out_of_range",
          message: `${tag}: answer index must point at one of the ${choices.length} choices.`,
        });
      } else {
        answer = idx;
      }
    }
  }

  // --- Substantive checks that need a resolved answer -----------------------

  if (answer !== null && choices) {
    const correctText = normalizeText(choices[answer]);
    // A hint or explanation that restates the correct option verbatim gives
    // the answer away before the student commits to it.
    if (correctText.length >= 4 && normalizeText(hint).includes(correctText)) {
      rejections.push({
        code: "hint_reveals_answer",
        message: `${tag}: the hint restates the correct choice — it must not reveal the answer.`,
      });
    }
    // The prompt must not contain the correct option either: an answer cue in
    // the stem is a giveaway, not a question.
    if (correctText.length >= 6 && normalizeText(prompt).includes(correctText)) {
      rejections.push({
        code: "prompt_cues_answer",
        message: `${tag}: the prompt contains the text of the correct choice — that cues the answer.`,
      });
    }
  }

  if (answer !== null && explanation) {
    // An explanation that names a different choice than the key contradicts
    // itself; the student cannot tell which is meant to be right.
    if (choices) {
      const wrongNamed = choices.some(
        (c, i) =>
          i !== answer &&
          normalizeText(c).length >= 6 &&
          normalizeText(explanation).includes(normalizeText(c)) &&
          !normalizeText(explanation).includes(normalizeText(choices[answer])),
      );
      if (wrongNamed) {
        rejections.push({
          code: "explanation_contradicts_key",
          message: `${tag}: the explanation discusses a wrong choice without ever naming the correct one.`,
        });
      }
    }
  }

  const verification = parseVerification(raw.verification);
  if (raw.verification !== undefined && raw.verification !== null && !verification) {
    rejections.push({ code: "verification_invalid", message: `${tag}: verification block is malformed.` });
  }

  if (rejections.length > 0) return { ok: false, rejections };

  const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : "";
  return {
    ok: true,
    question: {
      id,
      // The batch requested this topic; the model does not get to reassign it.
      topicId: expectedTopicId,
      prompt,
      kind,
      choices,
      answer: answer as number,
      hint,
      difficulty: difficulty as QuizDifficulty,
      explanation,
      ...(verification ? { verification } : {}),
    },
  };
}

function parseVerification(raw: unknown): QuestionVerification | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  const solver = typeof v.solver === "string" ? v.solver : "";
  const key = typeof v.key === "string" ? v.key : "";
  const appliesTo = v.appliesTo === "prompt" ? "prompt" : "answer";
  const input = v.input && typeof v.input === "object" && !Array.isArray(v.input)
    ? (v.input as Record<string, unknown>)
    : null;
  if (!solver || !key || !input) return null;
  return { solver, input, key, appliesTo };
}

/**
 * Collapse whitespace and case, and strip punctuation, so two items that
 * differ only in casing or spacing read as the same question.
 */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Near-duplicate detection. Two prompts are duplicates when one contains the
 * other (a one-word rephrase), or when their token sets overlap this heavily.
 * Repeated questions with different wording are still repeated questions.
 */
export function isNearDuplicate(a: string, b: string): boolean {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;

  const ta = new Set(na.split(" "));
  const tb = new Set(nb.split(" "));
  const smaller = Math.min(ta.size, tb.size);
  if (smaller === 0) return false;
  let shared = 0;
  for (const token of ta) if (tb.has(token)) shared += 1;
  return shared / smaller >= 0.85;
}

/** Which previously accepted prompts does `prompt` duplicate? */
export function findDuplicatesAgainst(prompt: string, accepted: string[]): string[] {
  return accepted.filter((prior) => isNearDuplicate(prompt, prior));
}

/** Every difficulty label the contract permits (re-exported for the UI). */
export const SUPPORTED_DIFFICULTIES = QUIZ_DIFFICULTIES;
