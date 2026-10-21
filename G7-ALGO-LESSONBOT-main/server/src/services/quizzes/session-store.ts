/**
 * Short-lived in-memory assessment session store.
 *
 * Assessment answer keys, explanations, and the graded result live HERE, on
 * the server, keyed by an unguessable id. The client's normal question
 * payload carries neither keys nor explanations, so a student inspecting the
 * network tab learns nothing they should not.
 *
 * This is per-request working state, not durable storage — no database, no
 * accounts. If the store is cold (server restarted) or the TTL lapsed, the
 * session is gone and the routes say so plainly instead of inventing a score.
 */
import { randomUUID } from "node:crypto";
import type {
  AssessmentAnswerKeyResponse,
  AssessmentCoverage,
  AssessmentMeta,
  AssessmentQuestion,
  AssessmentQuestionResult,
  AssessmentSubmitResponse,
  QuizCount,
  QuizDifficultySetting,
  QuizFormat,
} from "../../../../shared/contract.js";

/** Session lifetime. Long enough to take a 50-question paper, short enough to evict. */
const ASSESSMENT_TTL_MS = 60 * 60 * 1000; // 60 minutes

/** A question as the SERVER holds it: student view plus the answer key. */
export interface StoredAssessmentQuestion extends AssessmentQuestion {
  answer: number;
  explanation: string;
}

export interface AssessmentSession {
  meta: AssessmentMeta;
  /** Full questions including answers — never serialized to the student. */
  questions: StoredAssessmentQuestion[];
  expiresAt: number;
  /** Set once graded; a second submit is refused, not re-graded. */
  submittedAt?: number;
  /** The stored grade, replayed idempotently on a duplicate submit. */
  result?: AssessmentSubmitResponse;
}

const sessions = new Map<string, AssessmentSession>();

// Periodically evict expired sessions (unref'd so tests and shutdown are clean).
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(id);
  }
}, 60_000);
sweeper.unref?.();

/**
 * Unguessable session handle. randomUUID gives 122 random bits, which is far
 * beyond guessing through the API; the id is the only credential the client
 * holds, so it must not be derivable.
 */
export function newAssessmentId(): string {
  return `asmt-${randomUUID()}`;
}

export interface StoreAssessmentInput {
  title: string;
  scope: "combined" | "single";
  count: QuizCount;
  difficulty: QuizDifficultySetting;
  format: QuizFormat;
  source: "ai" | "curated" | "mixed";
  topicCoverage: AssessmentCoverage[];
  questions: StoredAssessmentQuestion[];
  ttlMs?: number;
}

export function storeAssessment(input: StoreAssessmentInput): AssessmentSession {
  const ttl = input.ttlMs ?? ASSESSMENT_TTL_MS;
  const now = Date.now();
  const id = newAssessmentId();
  const meta: AssessmentMeta = {
    id,
    title: input.title,
    scope: input.scope,
    count: input.count,
    difficulty: input.difficulty,
    format: input.format,
    source: input.source,
    topicCoverage: input.topicCoverage,
    createdAt: now,
    expiresAt: now + ttl,
  };
  const session: AssessmentSession = { meta, questions: input.questions, expiresAt: now + ttl };
  sessions.set(id, session);
  return session;
}

/** Live session, or undefined when expired/unknown/restarted. */
export function getAssessmentSession(id: string): AssessmentSession | undefined {
  const session = sessions.get(id);
  if (!session) return undefined;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(id);
    return undefined;
  }
  return session;
}

/** The student-facing view: no answers, no explanations. */
export function studentQuestions(session: AssessmentSession): AssessmentQuestion[] {
  return session.questions.map(({ answer: _a, explanation: _e, ...q }) => q);
}

/**
 * The separate answer-key document. This is an explicit user action, and this
 * app has no authentication: the unguessable session id is the only thing
 * standing between a holder of the link and the key. Callers must present it
 * as exactly that, not as an access-controlled instructor feature.
 */
export function answerKeyDocument(session: AssessmentSession): AssessmentAnswerKeyResponse {
  const { meta, questions } = session;
  return {
    assessmentId: meta.id,
    title: meta.title,
    count: meta.count,
    topicCoverage: meta.topicCoverage,
    questions: questions.map((q, i) => ({
      id: q.id,
      number: i + 1,
      topicId: q.topicId,
      prompt: q.prompt,
      kind: q.kind,
      choices: q.choices,
      answer: q.answer,
      answerText: answerTextOf(q),
      explanation: q.explanation,
    })),
  };
}

/** Human-readable correct answer, for both the key and the results review. */
export function answerTextOf(q: StoredAssessmentQuestion): string {
  if (q.choices && q.choices[q.answer] !== undefined) return q.choices[q.answer];
  return String(q.answer);
}

/**
 * Grade one submission against the stored key.
 *
 * Server-authoritative: the client sends only what the student chose. Every
 * value is compared here, and nothing the client sends can move a correct
 * answer or a score.
 *
 * A question is correct only on an exact match. Numerical answers accept a
 * small tolerance (floating display rounding), but there is no partial credit
 * policy hidden in the code: a multiple-choice question with one right answer
 * is either right or wrong, and unanswered is reported separately rather than
 * being folded into "incorrect".
 */
export function gradeAssessment(
  session: AssessmentSession,
  answers: Record<string, number | null>,
): AssessmentSubmitResponse {
  const results: AssessmentQuestionResult[] = session.questions.map((q) => {
    const raw = answers[q.id];
    const given = typeof raw === "number" && Number.isFinite(raw) ? raw : null;
    const unanswered = given === null;
    const correct = !unanswered && answersMatch(q, given as number);
    return {
      questionId: q.id,
      topicId: q.topicId,
      prompt: q.prompt,
      kind: q.kind,
      choices: q.choices,
      given,
      answer: q.answer,
      correct,
      unanswered,
      explanation: q.explanation,
    };
  });

  const correctCount = results.filter((r) => r.correct).length;
  const unansweredCount = results.filter((r) => r.unanswered).length;
  const total = results.length;

  // Topic-level performance, keyed off the coverage the assessment declared
  // so the summary always lists every topic the paper touched.
  const byTopic = new Map<string, { title: string; total: number; correct: number }>();
  for (const entry of session.meta.topicCoverage) {
    byTopic.set(entry.topicId, { title: entry.title, total: 0, correct: 0 });
  }
  for (const r of results) {
    const bucket = byTopic.get(r.topicId) ?? { title: r.topicId, total: 0, correct: 0 };
    bucket.total += 1;
    if (r.correct) bucket.correct += 1;
    byTopic.set(r.topicId, bucket);
  }
  const topicBreakdown: (AssessmentCoverage & { correct: number })[] = [...byTopic.entries()].map(
    ([topicId, v]) => ({ topicId, title: v.title, count: v.total, correct: v.correct }),
  );

  return {
    assessmentId: session.meta.id,
    title: session.meta.title,
    score: correctCount,
    total,
    correct: correctCount,
    incorrect: total - correctCount - unansweredCount,
    unanswered: unansweredCount,
    percentage: total === 0 ? 0 : Math.round((correctCount / total) * 1000) / 10,
    topicBreakdown,
    results,
  };
}

const NUMERICAL_TOLERANCE = 1e-6;

function answersMatch(q: StoredAssessmentQuestion, given: number): boolean {
  if (q.kind === "numerical") return Math.abs(given - q.answer) <= NUMERICAL_TOLERANCE;
  return given === q.answer;
}

/**
 * Record a grade exactly once. The first submission is authoritative; a
 * duplicate submit (double-click, retried request, impatient reload) replays
 * the stored result rather than re-grading, so a score can never change by
 * submitting twice.
 */
export function recordGrade(session: AssessmentSession, result: AssessmentSubmitResponse): AssessmentSubmitResponse {
  if (session.result && session.submittedAt) return session.result;
  session.submittedAt = Date.now();
  session.result = result;
  return result;
}

/** Test hook: drop every session (used to assert expiry and restart paths). */
export function clearAssessmentSessions(): void {
  sessions.clear();
}

/** Test hook: force a session's expiry. */
export function expireAssessment(id: string): void {
  const session = sessions.get(id);
  if (session) {
    session.expiresAt = Date.now() - 1;
  }
}
