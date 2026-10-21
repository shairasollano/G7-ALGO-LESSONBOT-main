/**
 * Assessment runner: overview → attempt → results.
 *
 * Three phases, one component, because the state between them is small and
 * tightly coupled (an answer is only meaningful against the attempt it was
 * given in). What matters about the phase split:
 *
 *   Overview shows what the student is about to take — length, coverage,
 *   difficulty, and where the questions came from — before anything starts.
 *
 *   Attempt keeps every answer in local state as it is given, so navigating
 *   away from a question never loses it, and shows "N of M" plus a navigator
 *   so a long paper is not a blind scroll. Submitting with blanks warns first.
 *
 *   Results come from the SERVER. Nothing here computes a score: the client
 *   sends what the student chose and displays what the server says back,
 *   which is why a tampered client cannot talk itself into a better grade.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AssessmentAnswerKeyResponse,
  AssessmentGenerateResponse,
  AssessmentQuestion,
  AssessmentSubmitResponse,
} from "@shared/contract";
import { friendlyError } from "../../api/client";
import { IconArrowLeft, IconArrowRight, IconCheck, IconQuiz } from "../icons";
import { QuizPrint, type PrintDoc } from "./QuizPrint";

export interface LoadedAssessment {
  assessment: AssessmentGenerateResponse["assessment"];
  questions: AssessmentQuestion[];
  notes?: string[];
}

interface QuizViewProps {
  data: LoadedAssessment;
  /** Called when the student leaves the quiz (back to chat, or a new quiz). */
  onExit: () => void;
  /** Called when the student asks for a fresh quiz (returns to setup). */
  onNewQuiz: () => void;
  submit: (assessmentId: string, answers: Record<string, number | null>) => Promise<AssessmentSubmitResponse>;
  fetchAnswerKey: (assessmentId: string) => Promise<AssessmentAnswerKeyResponse>;
}

type Phase = "overview" | "attempt" | "results";

export function QuizView({ data, onExit, onNewQuiz, submit, fetchAnswerKey }: QuizViewProps) {
  const [phase, setPhase] = useState<Phase>("overview");
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number | null>>({});
  const [result, setResult] = useState<AssessmentSubmitResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [printDoc, setPrintDoc] = useState<PrintDoc | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const questionRef = useRef<HTMLDivElement>(null);

  const { assessment, questions } = data;
  const total = questions.length;

  // Move focus to the phase heading whenever the phase changes, so a screen
  // reader announces where the student now is instead of leaving them at the
  // button they just pressed.
  useEffect(() => {
    headingRef.current?.focus();
  }, [phase]);

  const answered = useMemo(() => questions.filter((q) => answers[q.id] != null).length, [answers, questions]);
  const unanswered = total - answered;

  const choose = useCallback(
    (question: AssessmentQuestion, value: number | null) => {
      setAnswers((prev) => ({ ...prev, [question.id]: value }));
    },
    [],
  );

  const doSubmit = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await submit(
        assessment.id,
        // Every question is sent, blanks included as null, so the server can
        // distinguish "left blank" from "not part of this assessment".
        Object.fromEntries(questions.map((q) => [q.id, answers[q.id] ?? null])),
      );
      setResult(res);
      setPhase("results");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSubmitting(false);
    }
  }, [answers, assessment.id, questions, submit, submitting]);

  const requestSubmit = useCallback(() => {
    if (unanswered > 0) {
      setConfirmLeave(true);
      return;
    }
    void doSubmit();
  }, [doSubmit, unanswered]);

  const printPaper = useCallback(() => {
    setPrintDoc({
      kind: "student",
      assessment,
      questions,
      answers,
    });
  }, [answers, assessment, questions]);

  const printKey = useCallback(async () => {
    setError(null);
    try {
      const key = await fetchAnswerKey(assessment.id);
      setPrintDoc({ kind: "key", assessment, key });
    } catch (err) {
      setError(friendlyError(err));
    }
  }, [assessment, fetchAnswerKey]);

  // After the print container has rendered with the right content, hand off to
  // the browser's own print dialog and clear it again. `afterprint` is the
  // reliable signal that the dialog closed (whether printed, previewed, or
  // cancelled), so nothing is left hidden in the DOM afterwards.
  useEffect(() => {
    if (!printDoc) return;
    const clear = () => setPrintDoc(null);
    window.addEventListener("afterprint", clear);
    const id = window.setTimeout(() => window.print(), 50);
    return () => {
      window.removeEventListener("afterprint", clear);
      window.clearTimeout(id);
    };
  }, [printDoc]);

  const question = questions[current];

  return (
    <div className="qa-view">
      <header className="qa-view-head">
        <button type="button" className="btn btn-secondary" onClick={onExit}>
          <IconArrowLeft />
          Back to chat
        </button>
        <span className="qa-view-title">{assessment.title}</span>
        <button type="button" className="btn btn-secondary" onClick={onNewQuiz}>
          <IconQuiz />
          New quiz
        </button>
      </header>

      <div className="qa-view-body">
        {phase === "overview" && (
          <section className="qa-panel" aria-labelledby="qa-overview-title">
            <h1 id="qa-overview-title" className="qa-panel-title" tabIndex={-1} ref={headingRef}>
              {assessment.title}
            </h1>

            <dl className="qa-facts">
              <div>
                <dt>Questions</dt>
                <dd>{assessment.count}</dd>
              </div>
              <div>
                <dt>Difficulty</dt>
                <dd>{labelFor(assessment.difficulty)}</dd>
              </div>
              <div>
                <dt>Format</dt>
                <dd>{labelFor(assessment.format)}</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>
                  <SourceBadge source={assessment.source} />
                </dd>
              </div>
            </dl>

            <div className="qa-coverage">
              <h2 className="qa-subhead">Coverage</h2>
              <ul className="qa-coverage-list">
                {assessment.topicCoverage.map((entry) => (
                  <li key={entry.topicId} className="qa-coverage-item">
                    <span className="qa-coverage-title">{entry.title}</span>
                    <span className="qa-coverage-count">{entry.count}</span>
                  </li>
                ))}
              </ul>
            </div>

            {data.notes && data.notes.length > 0 && (
              <p className="qa-notes" role="note">
                {data.notes.join(" ")}
              </p>
            )}

            <div className="qa-instructions">
              <h2 className="qa-subhead">Before you start</h2>
              <ul>
                <li>You can move between questions freely — your answers are kept as you go.</li>
                <li>Nothing is graded until you submit, and you can review every answer afterwards.</li>
                <li>The answer key is never shown during the attempt.</li>
                <li>
                  This session lasts an hour. If it expires before you submit, you will need to start a new quiz.
                </li>
              </ul>
            </div>

            <button type="button" className="btn btn-primary qa-start" onClick={() => setPhase("attempt")}>
              Start quiz
            </button>
          </section>
        )}

        {phase === "attempt" && question && (
          <section className="qa-panel" aria-labelledby="qa-question-title">
            <div className="qa-progress-row">
              <p className="qa-progress-label" aria-live="polite">
                Question {current + 1} of {total}
              </p>
              <p className="qa-progress-answered">
                {answered} answered{unanswered > 0 ? ` · ${unanswered} remaining` : ""}
              </p>
            </div>
            <div
              className="qa-progress"
              role="progressbar"
              aria-valuenow={answered}
              aria-valuemin={0}
              aria-valuemax={total}
              aria-label="Questions answered"
            >
              <span className="qa-progress-fill" style={{ width: `${(answered / total) * 100}%` }} />
            </div>

            <nav className="qa-navigator" aria-label="Jump to a question">
              {questions.map((q, i) => {
                const state = answers[q.id] != null ? "answered" : i === current ? "current" : "blank";
                return (
                  <button
                    key={q.id}
                    type="button"
                    className={`qa-nav-dot qa-nav-${state}`}
                    aria-label={`Question ${i + 1}${state === "answered" ? ", answered" : ", not answered"}`}
                    aria-current={i === current ? "true" : undefined}
                    onClick={() => setCurrent(i)}
                  >
                    {i + 1}
                  </button>
                );
              })}
            </nav>

            <div className="qa-question" key={question.id} ref={questionRef}>
              <div className="qa-question-meta">
                <span className="qa-topic-tag">
                  {assessment.topicCoverage.find((t) => t.topicId === question.topicId)?.title ?? question.topicId}
                </span>
                <span className="qa-difficulty-tag">{labelFor(question.difficulty)}</span>
              </div>
              <h1 id="qa-question-title" className="qa-question-prompt" tabIndex={-1} ref={headingRef}>
                {question.prompt}
              </h1>

              <AnswerPicker question={question} value={answers[question.id] ?? null} onChoose={choose} />
              <HintReveal hint={question.hint} />
            </div>

            {error && (
              <p className="qa-error" role="alert">
                {error}
              </p>
            )}

            <div className="qa-question-foot">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setCurrent((c) => Math.max(0, c - 1))}
                disabled={current === 0}
              >
                <IconArrowLeft />
                Previous
              </button>

              {current < total - 1 ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setCurrent((c) => Math.min(total - 1, c + 1))}
                >
                  Next
                  <IconArrowRight />
                </button>
              ) : (
                <button type="button" className="btn btn-primary" onClick={requestSubmit} disabled={submitting}>
                  {submitting ? "Submitting…" : "Submit quiz"}
                </button>
              )}
            </div>

            {current === total - 1 && unanswered > 0 && (
              <p className="qa-unanswered-note">
                {unanswered} question{unanswered === 1 ? " is" : "s are"} still unanswered. Submitting anyway will
                count {unanswered === 1 ? "it" : "them"} as wrong.
              </p>
            )}

            {confirmLeave && (
              <div className="qa-confirm" role="alertdialog" aria-labelledby="qa-confirm-title">
                <p id="qa-confirm-title">
                  You have {unanswered} unanswered question{unanswered === 1 ? "" : "s"}. Submit anyway?
                </p>
                <div className="qa-confirm-actions">
                  <button type="button" className="btn btn-secondary" onClick={() => setConfirmLeave(false)}>
                    Go back and answer
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      setConfirmLeave(false);
                      void doSubmit();
                    }}
                    disabled={submitting}
                  >
                    Submit anyway
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {phase === "results" && result && (
          <section className="qa-panel" aria-labelledby="qa-results-title">
            <h1 id="qa-results-title" className="qa-panel-title" tabIndex={-1} ref={headingRef}>
              {result.title}
            </h1>

            <div className="qa-score">
              <span className="qa-score-value">{result.percentage}%</span>
              <span className="qa-score-detail">
                {result.correct} of {result.total} correct
              </span>
            </div>

            <ul className="qa-score-breakdown">
              <li className="qa-break-correct">
                <IconCheck />
                {result.correct} correct
              </li>
              <li className="qa-break-incorrect">{result.incorrect} incorrect</li>
              <li className="qa-break-unanswered">{result.unanswered} unanswered</li>
            </ul>

            {result.alreadySubmitted && (
              <p className="qa-notes" role="note">
                This quiz was already submitted — showing the original score.
              </p>
            )}

            <div className="qa-topic-results">
              <h2 className="qa-subhead">By topic</h2>
              <ul className="qa-coverage-list">
                {result.topicBreakdown.map((entry) => (
                  <li key={entry.topicId} className="qa-coverage-item">
                    <span className="qa-coverage-title">{entry.title}</span>
                    <span className="qa-coverage-count">
                      {entry.correct}/{entry.count}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="qa-review">
              <h2 className="qa-subhead">Review every question</h2>
              <ol className="qa-review-list">
                {result.results.map((r, i) => (
                  <li key={r.questionId} className={`qa-review-item ${r.correct ? "qa-review-correct" : "qa-review-wrong"}`}>
                    <p className="qa-review-head">
                      <span className="qa-review-num">{i + 1}.</span>
                      <span className={`qa-review-status ${r.correct ? "qa-review-correct" : "qa-review-wrong"}`}>
                        {r.correct ? "Correct" : r.unanswered ? "Unanswered" : "Incorrect"}
                      </span>
                    </p>
                    <p className="qa-review-prompt">{r.prompt}</p>
                    <dl className="qa-review-answers">
                      <div>
                        <dt>Your answer</dt>
                        <dd>{r.given == null ? "— (blank)" : displayAnswer(r.given, r.choices)}</dd>
                      </div>
                      <div>
                        <dt>Correct answer</dt>
                        <dd>{displayAnswer(r.answer, r.choices)}</dd>
                      </div>
                    </dl>
                    <p className="qa-review-explanation">{r.explanation}</p>
                  </li>
                ))}
              </ol>
            </div>

            {error && (
              <p className="qa-error" role="alert">
                {error}
              </p>
            )}

            <div className="qa-results-actions">
              <button type="button" className="btn btn-secondary" onClick={printPaper}>
                Print question paper
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => void printKey()}>
                Print answer key
              </button>
              <button type="button" className="btn btn-primary" onClick={onNewQuiz}>
                New quiz
              </button>
            </div>
            <p className="qa-print-note">
              Printing uses your browser's own print dialog. The answer key is a separate document, and anyone
              holding this quiz's link can open it — there are no accounts in this app.
            </p>
          </section>
        )}
      </div>

      {printDoc && <QuizPrint doc={printDoc} />}
    </div>
  );
}

/**
 * The picker. Multiple choice and true/false are radiogroups; a numerical
 * answer is a labelled number input, because a radiogroup of "every possible
 * integer" is not a control.
 */
function AnswerPicker({
  question,
  value,
  onChoose,
}: {
  question: AssessmentQuestion;
  value: number | null;
  onChoose: (question: AssessmentQuestion, value: number | null) => void;
}) {
  if (question.choices) {
    const letter = (i: number) => String.fromCharCode(65 + i);
    return (
      <fieldset className="qa-choices">
        <legend className="sr-only">Choose one answer</legend>
        {question.choices.map((choice, i) => (
          <label key={`${question.id}-${i}`} className={`qa-choice ${value === i ? "qa-choice-active" : ""}`}>
            <input
              type="radio"
              name={`answer-${question.id}`}
              checked={value === i}
              onChange={() => onChoose(question, i)}
            />
            <span className="qa-choice-letter" aria-hidden="true">
              {letter(i)}
            </span>
            <span className="qa-choice-text">{choice}</span>
          </label>
        ))}
      </fieldset>
    );
  }

  return (
    <div className="qa-numerical">
      <label htmlFor={`num-${question.id}`} className="qa-numerical-label">
        Your answer
      </label>
      <input
        id={`num-${question.id}`}
        type="number"
        step="any"
        className="qa-numerical-input"
        value={value === null ? "" : String(value)}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") {
            onChoose(question, null);
            return;
          }
          const parsed = Number(raw);
          onChoose(question, Number.isFinite(parsed) ? parsed : null);
        }}
      />
    </div>
  );
}

/** Hint is opt-in: revealing it should cost a deliberate click. */
function HintReveal({ hint }: { hint: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="qa-hint">
      <button type="button" className="btn btn-small" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? "Hide hint" : "Show hint"}
      </button>
      {open && <p className="qa-hint-text">{hint}</p>}
    </div>
  );
}

/** Source of the questions, stated plainly so a curated paper is not mistaken for a fresh one. */
function SourceBadge({ source }: { source: "ai" | "curated" | "mixed" }) {
  if (source === "curated") return <span className="qa-source qa-source-curated">Curated question bank</span>;
  if (source === "mixed") return <span className="qa-source qa-source-mixed">AI-generated and curated</span>;
  return <span className="qa-source qa-source-ai">AI-generated from the lesson catalog</span>;
}

function displayAnswer(value: number, choices: string[] | null): string {
  if (choices && choices[value] !== undefined) {
    return `${String.fromCharCode(65 + value)}. ${choices[value]}`;
  }
  return String(value);
}

function labelFor(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
