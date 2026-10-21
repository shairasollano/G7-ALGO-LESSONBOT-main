/**
 * Zod validation schemas for every API request. All inbound data is validated;
 * nothing reaches the services unvalidated.
 */
import { z } from "zod";
import { LEARNING_LEVELS, QUIZ_COUNTS, QUIZ_DIFFICULTIES, QUIZ_FORMATS } from "../../../shared/contract.js";

export const chatRequestSchema = z.object({
  message: z.string().trim().min(1, "message must not be empty").max(2000, "message is too long (max 2000 characters)"),
  topicId: z.string().max(80).optional(),
  level: z.enum(LEARNING_LEVELS),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(4000),
      }),
    )
    .max(20, "history is too long (max 20 messages)")
    .optional(),
});

export const solveRequestSchema = z.object({
  algorithmId: z.string().min(1).max(80),
  input: z.record(z.string(), z.unknown()),
});

export const quizGenerateRequestSchema = z.object({
  topicId: z.string().max(80).optional(),
  count: z.number().int().min(1).max(10).optional(),
});

export const quizGradeRequestSchema = z.object({
  quizId: z.string().min(1).max(120),
  answers: z.record(z.string(), z.number().int().min(0)),
});

/**
 * Assessment generation. `count` is a CLOSED set: 10, 20, 30, 40, or 50.
 * There is deliberately no "any integer between 1 and 50" — the client picks
 * one of the five supported lengths, and the server refuses anything else
 * rather than quietly rounding to the nearest one it can build.
 */
export const assessmentGenerateRequestSchema = z.object({
  count: z.union([
    z.literal(QUIZ_COUNTS[0]),
    z.literal(QUIZ_COUNTS[1]),
    z.literal(QUIZ_COUNTS[2]),
    z.literal(QUIZ_COUNTS[3]),
    z.literal(QUIZ_COUNTS[4]),
  ]),
  /** Omit for the default combined-all-topics assessment. */
  topicId: z.string().max(80).optional(),
  difficulty: z.enum(QUIZ_DIFFICULTIES).optional(),
  format: z.enum(QUIZ_FORMATS).optional(),
});

/** Unguessable session id (asmt-<uuid>); length-capped as a sanity bound. */
export const assessmentIdSchema = z.string().min(8).max(80);

/**
 * Grading submission. Answer values are bounded: MC/TF are choice indices
 * (0..5), numerical answers are finite and magnitude-capped. `null` means
 * "left blank", which is recorded as unanswered rather than wrong.
 */
export const assessmentSubmitRequestSchema = z.object({
  assessmentId: assessmentIdSchema,
  answers: z
    .record(
      z.string().max(80),
      z.union([z.number().finite().max(1e9).min(-1e9), z.null()]),
    )
    .refine((answers) => Object.keys(answers).length <= 60, {
      message: "more answers than this assessment can hold",
    }),
});

export type ChatRequestInput = z.infer<typeof chatRequestSchema>;
export type SolveRequestInput = z.infer<typeof solveRequestSchema>;
export type QuizGenerateRequestInput = z.infer<typeof quizGenerateRequestSchema>;
export type QuizGradeRequestInput = z.infer<typeof quizGradeRequestSchema>;
export type AssessmentGenerateRequestInput = z.infer<typeof assessmentGenerateRequestSchema>;
export type AssessmentSubmitRequestInput = z.infer<typeof assessmentSubmitRequestSchema>;
