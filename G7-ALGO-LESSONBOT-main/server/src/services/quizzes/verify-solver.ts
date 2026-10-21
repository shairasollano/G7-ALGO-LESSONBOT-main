/**
 * Solver verification of generated quiz questions.
 *
 * When a question asserts a computed value, the model's number is not
 * evidence. This module re-runs the deterministic solver on the input the
 * question supplies and checks the assertion against the solver's result.
 *
 * Three outcomes, deliberately distinct so failures are diagnosable:
 *   - "verified"   the solver's value matches the assertion;
 *   - "mismatch"   the solver disagrees — the question is wrong and is
 *                  rejected, never softened or auto-corrected;
 *   - "unverifiable" the verification block itself is unusable (unknown
 *                  solver, bad input, missing key) — also a rejection, since
 *                  an unverifiable claim must not be presented as verified.
 *
 * A solver can also refuse (bad input, unsupported algorithm). That is
 * reported as "unverifiable" rather than being swallowed: a question that
 * cannot be checked is not a question this feature will publish.
 */
import { runSolver } from "../algorithms/registry.js";
import type { QuestionVerification } from "./validate-questions.js";

export type SolverCheckOutcome =
  | { status: "verified"; value: number }
  | { status: "mismatch"; value: number; expected: number }
  | { status: "unverifiable"; reason: string };

/** Numbers compared with a tolerance: solver averages are rounded for display. */
const NUMERIC_TOLERANCE = 1e-4;

/**
 * Extract the authoritative number at `verification.key` from the solver's
 * result and compare it with what the question claims.
 */
export function verifyAgainstSolver(verification: QuestionVerification, claimed: number): SolverCheckOutcome {
  let result: Awaited<ReturnType<typeof runSolver>>;
  try {
    result = runSolver(verification.solver, verification.input);
  } catch (err) {
    // A solver that refuses gives us nothing to compare against. Say so
    // plainly instead of letting the claim stand as if it were checked.
    const message = err instanceof Error ? err.message : "solver rejected the input";
    return { status: "unverifiable", reason: `solver refused: ${message}` };
  }

  const raw = result.result?.[verification.key];
  if (raw === undefined || raw === null) {
    return {
      status: "unverifiable",
      reason: `solver result has no numeric field "${verification.key}"`,
    };
  }

  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value)) {
    return {
      status: "unverifiable",
      reason: `solver field "${verification.key}" is not a finite number`,
    };
  }

  const expected = typeof claimed === "number" ? claimed : Number(claimed);
  if (!Number.isFinite(expected)) {
    return { status: "unverifiable", reason: "the question's answer is not a finite number" };
  }

  if (Math.abs(value - expected) <= NUMERIC_TOLERANCE) {
    return { status: "verified", value };
  }
  return { status: "mismatch", value, expected };
}

/**
 * True when a question's assertion is a claim about a computed value and must
 * therefore carry a verification block. Phrased narrowly: it looks for the
 * vocabulary of quantities this app's solvers actually produce, so a purely
 * conceptual question ("what does NP-hard mean?") is never forced into a
 * solver check it cannot have.
 */
const COMPUTED_CLAIM_PATTERNS: RegExp[] = [
  /\bcut (?:size|value)\b/i,
  /\bbest cut\b/i,
  /\bcrossing edges\b/i,
  /\bcover size\b/i,
  /\bsize of (?:the )?(?:vertex )?cover\b/i,
  /\bmatching size\b/i,
  /\btarget parameter\b/i,
  /\bn\s*[−–-]\s*k\b/i,
  /\bnumber of (?:boolean )?(?:variables|clauses)\b/i,
  /\btableau rows\b/i,
  /\btableau columns\b/i,
  /\btape columns\b/i,
  /\bexpected cut\b/i,
];

export function assertsComputedValue(question: {
  prompt: string;
  choices: string[] | null;
  explanation: string;
}): boolean {
  const haystack = `${question.prompt}\n${question.choices?.join("\n") ?? ""}\n${question.explanation}`;
  return COMPUTED_CLAIM_PATTERNS.some((re) => re.test(haystack));
}
