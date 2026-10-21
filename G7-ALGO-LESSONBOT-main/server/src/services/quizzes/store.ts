/**
 * Short-lived in-memory quiz store. Generated quizzes (with answer keys)
 * live here keyed by quizId with a TTL. This is per-request working state,
 * not durable storage — no database.
 */
import type { ValidatedQuiz } from "../../../../shared/contract.js";

const QUIZ_TTL_MS = 30 * 60 * 1000; // 30 minutes

const quizStore = new Map<string, { quiz: ValidatedQuiz; expiresAt: number }>();

// Periodically evict expired quizzes.
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of quizStore) {
    if (entry.expiresAt <= now) quizStore.delete(id);
  }
}, 60_000).unref();

export function storeQuiz(quiz: ValidatedQuiz): void {
  quizStore.set(quiz.id, { quiz, expiresAt: Date.now() + QUIZ_TTL_MS });
}

export function getQuiz(quizId: string): ValidatedQuiz | undefined {
  const entry = quizStore.get(quizId);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    quizStore.delete(quizId);
    return undefined;
  }
  return entry.quiz;
}
