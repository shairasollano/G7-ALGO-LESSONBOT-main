/**
 * Question-generation provider wiring.
 *
 * Quiz generation goes through the SAME enablement gate, the SAME credentials,
 * the SAME endpoint, and the SAME error classification as chat. The browser
 * never generates a question: it asks this server, and this server asks xKiro.
 *
 * When no AI provider is configured or enabled, this returns null. The caller
 * then falls back to the curated bank — and only when that bank can satisfy
 * the requested length without repeating itself.
 *
 * Kept separate from services/ai/index.ts so the dependency stays one-way:
 * quizzes depend on the AI layer, never the reverse.
 */
import { isXKiroEnabled } from "../../config.js";
import { providerStatus, withTimeout } from "../ai/index.js";
import type { QuestionProvider } from "./generator.js";

/**
 * The structured-completion provider for quiz generation, or null when no AI
 * provider is enabled. The provider is chosen by the same `providerStatus()`
 * the health endpoint reports, so what the UI says is running and what
 * actually answers a quiz request can never disagree.
 */
export async function questionProvider(): Promise<QuestionProvider | null> {
  const status = providerStatus();
  if (!status.enabled) return null;

  if (!isXKiroEnabled()) {
    // Gemini is chat-only in this app: it has no structured-completion path
    // here, and inventing one would be a second integration to keep honest.
    // Reporting "no provider" routes to the curated bank, which is the
    // truthful outcome.
    return null;
  }

  const { xKiroJsonCompletion } = await import("../ai/xkiro-provider.js");
  return {
    name: "xkiro",
    complete: ({ system, user, signal }) =>
      // Reuses the chat path's configured timeout, so a quiz request cannot
      // hold a connection open longer than a chat turn is allowed to.
      withTimeout(xKiroJsonCompletion({ system, user }, signal)),
  };
}
