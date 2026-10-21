/**
 * Quiz routes.
 *
 * Generate: builds a question set only from the curated, validated question
 * bank (or a validated provider response — the curated bank is always the
 * fallback). Grade: deterministic backend grading of MC and numerical
 * questions; returns per-question results with rationales.
 *
 * Generated quizzes (with their answer keys) live in a short-lived
 * in-memory store keyed by quizId, with a TTL. This is per-request working
 * state, not durable storage — no database. If the store is cold (e.g.
 * server restarted between generate and grade), grading fails gracefully
 * with a clear error.
 */
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { quizGenerateRequestSchema, quizGradeRequestSchema } from "../schemas/index.js";
import { getQuizQuestions } from "../data/quiz-bank.js";
import { getTopic } from "../data/topics.js";
import type { QuizQuestion, ValidatedQuiz } from "../../../shared/contract.js";
import { getQuiz, storeQuiz } from "../services/quizzes/store.js";

export const quizzesRouter = Router();

quizzesRouter.post("/api/quizzes/generate", (req, res, next) => {
  try {
    const body = quizGenerateRequestSchema.parse(req.body);
    const topicId = body.topicId ?? "polynomial-reductions";
    const topic = getTopic(topicId);
    if (!topic) {
      res.status(404).json({
        error: { code: "topic_not_found", message: `No topic with id "${topicId}".` },
      });
      return;
    }
    const pool = getQuizQuestions(topicId);
    const count = Math.min(body.count ?? 5, pool.length);
    // Deterministic-ish selection: shuffle with a simple LCG seeded by time,
    // then take the first `count`. Questions keep their curated answer keys.
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    const questions: QuizQuestion[] = shuffled.slice(0, count);
    const quiz: ValidatedQuiz = {
      id: `quiz-${randomUUID()}`,
      topicId,
      title: `Practice quiz — ${topic.title}`,
      questions,
    };
    storeQuiz(quiz);
    // The quiz block sent to the client intentionally OMITS answer keys,
    // rationales, and hints — grading happens on the backend.
    res.json({
      quiz: {
        id: quiz.id,
        topicId: quiz.topicId,
        title: quiz.title,
        questions: questions.map(({ answer: _a, rationale: _r, hint: _h, ...q }) => q),
      },
    });
  } catch (err) {
    next(err);
  }
});

quizzesRouter.post("/api/quizzes/grade", (req, res, next) => {
  try {
    const body = quizGradeRequestSchema.parse(req.body);
    const quiz = getQuiz(body.quizId);
    if (!quiz) {
      res.status(410).json({
        error: {
          code: "quiz_expired",
          message: "This quiz session has expired (or the server restarted). Please generate a new quiz.",
        },
      });
      return;
    }
    const results = quiz.questions.map((q) => {
      const given = body.answers[q.id] ?? null;
      const correct = given !== null && given === q.answer;
      return {
        questionId: q.id,
        correct,
        given,
        answer: q.answer,
        rationale: q.rationale,
        hint: q.hint,
      };
    });
    const score = results.filter((r) => r.correct).length;
    res.json({
      quizId: body.quizId,
      score,
      total: results.length,
      results,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Assessments (mixed-topic quizzes, 10–50 questions)
//
// Distinct from the practice-quiz routes above: an assessment is a fixed
// length, may span every topic at once, is taken in a session with a TTL, and
// is graded server-authoritatively. The answer key never leaves the server in
// a question payload — it is revealed only by grading (after submission) or by
// the explicit answer-key action.
// ---------------------------------------------------------------------------

import {
  assessmentGenerateRequestSchema,
  assessmentSubmitRequestSchema,
} from "../schemas/index.js";
import { rateLimiter } from "../middleware/rate-limit.js";
import { config } from "../config.js";
import { generateAssessment } from "../services/quizzes/generator.js";
import { questionProvider } from "../services/quizzes/question-provider.js";
import {
  answerKeyDocument,
  answerTextOf,
  getAssessmentSession,
  gradeAssessment,
  recordGrade,
  storeAssessment,
  studentQuestions,
} from "../services/quizzes/session-store.js";

/** Assessment generation costs real provider calls; bound it like chat. */
const assessLimiter = rateLimiter(config.ai.rateLimit.windowMs, config.ai.rateLimit.maxRequests);

/**
 * POST /api/quizzes/assessment — build an assessment of exactly the requested
 * length. Returns the overview plus KEYLESS questions: no answers, no
 * explanations. Grading happens here, later, against the stored key.
 */
quizzesRouter.post("/api/quizzes/assessment", assessLimiter, async (req, res, next) => {
  try {
    const body = assessmentGenerateRequestSchema.parse(req.body);
    const provider = await questionProvider();
    const outcome = await generateAssessment(
      {
        count: body.count,
        ...(body.topicId !== undefined ? { topicId: body.topicId } : {}),
        ...(body.difficulty !== undefined ? { difficulty: body.difficulty } : {}),
        ...(body.format !== undefined ? { format: body.format } : {}),
      },
      provider,
    );

    if (!outcome.ok) {
      // Honest failure, with a status that says WHICH kind:
      //   404 — the request named a topic that does not exist (a stale link,
      //         or a typo; the message lists the real slugs).
      //   422 — the request was well-formed but the content could not be
      //         produced at the requested length.
      // "retryable" distinguishes a transient provider failure (worth trying
      // again) from a bank that is simply too small (never worth trying).
      const status = outcome.code === "topic_not_found" ? 404 : 422;
      res.status(status).json({
        error: {
          code: outcome.code,
          message: outcome.message,
          details: {
            requestedCount: body.count,
            providerAvailable: provider !== null,
            retryable: provider !== null && outcome.code !== "insufficient_content",
          },
        },
      });
      return;
    }

    const session = storeAssessment({
      title: outcome.title,
      scope: outcome.scope,
      count: body.count,
      difficulty: body.difficulty ?? "mixed",
      format: body.format ?? "mixed",
      source: outcome.source,
      topicCoverage: outcome.topicCoverage,
      questions: outcome.questions,
    });

    res.json({
      assessment: session.meta,
      questions: studentQuestions(session),
      // Surfacing what actually happened, so the UI never implies a fresh
      // model generation when the curated bank answered instead.
      notes: outcome.notes,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/quizzes/assessment/:id — reload an active session's keyless
 * questions. Used by a refresh mid-attempt; 410 once the TTL lapses.
 */
quizzesRouter.get("/api/quizzes/assessment/:id", (req, res) => {
  const session = getAssessmentSession(req.params.id);
  if (!session) {
    res.status(410).json({
      error: {
        code: "assessment_expired",
        message:
          "This assessment session has expired or is no longer available. Please start a new quiz.",
      },
    });
    return;
  }
  res.json({
    assessment: session.meta,
    questions: studentQuestions(session),
    alreadySubmitted: session.submittedAt !== undefined,
    ...(session.result ? { result: session.result } : {}),
  });
});

/**
 * POST /api/quizzes/assessment/:id/submit — server-authoritative grading.
 *
 * The client sends only what the student chose. Every comparison happens here,
 * against the stored key. A second submission replays the FIRST stored result
 * rather than re-grading, so a double-click or a retried request can never
 * change a score.
 */
quizzesRouter.post("/api/quizzes/assessment/:id/submit", (req, res, next) => {
  try {
    // The id in the path is authoritative; a mismatched body id is a client
    // bug (or a confused deputy attempt), not something to grade against.
    if (req.params.id !== req.body?.assessmentId) {
      res.status(400).json({
        error: {
          code: "id_mismatch",
          message: "The assessment id in the path does not match the request body.",
        },
      });
      return;
    }
    const body = assessmentSubmitRequestSchema.parse(req.body);
    const session = getAssessmentSession(body.assessmentId);
    if (!session) {
      res.status(410).json({
        error: {
          code: "assessment_expired",
          message:
            "This assessment session has expired before it could be graded. Please start a new quiz.",
        },
      });
      return;
    }

    if (session.result && session.submittedAt) {
      // Duplicate submission: return the stored grade, unchanged.
      res.json({ ...session.result, alreadySubmitted: true });
      return;
    }

    const result = recordGrade(session, gradeAssessment(session, body.answers));
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/quizzes/assessment/:id/key — the separate answer-key document.
 *
 * This app has no authentication, and this endpoint does not pretend to have
 * any: the unguessable session id (randomUUID, 122 random bits) is the only
 * thing guarding it. It is a deliberate instructor action — print the key —
 * and the UI must present it as exactly that, not as access-controlled.
 */
quizzesRouter.get("/api/quizzes/assessment/:id/key", (req, res) => {
  const session = getAssessmentSession(req.params.id);
  if (!session) {
    res.status(410).json({
      error: {
        code: "assessment_expired",
        message: "This assessment session has expired. The answer key is no longer available.",
      },
    });
    return;
  }
  const key = answerKeyDocument(session);
  res.json({
    ...key,
    // Answer text is included in the key, but the helper stays the single
    // source of truth for how a choice index becomes a readable answer.
    answerTexts: session.questions.map((q) => answerTextOf(q)),
  });
});
