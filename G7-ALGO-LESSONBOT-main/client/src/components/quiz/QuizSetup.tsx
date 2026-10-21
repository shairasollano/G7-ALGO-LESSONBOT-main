/**
 * Assessment setup dialog.
 *
 * Picked here, in one place: length (10/20/30/40/50 — nothing else is
 * offered, because nothing else is supported), scope (the default combines
 * every topic in the catalog; a single topic is opt-in), difficulty, and
 * format.
 *
 * The topic list comes from the catalog the server reports. There is no
 * second hardcoded list here, so adding a lesson makes it appear in this
 * dialog without touching this file.
 */
import { useEffect, useRef, useState } from "react";
import type { QuizCount, QuizDifficultySetting, QuizFormat, TopicSummary } from "@shared/contract";
import { QUIZ_COUNTS, QUIZ_DIFFICULTIES, QUIZ_FORMATS } from "@shared/contract";
import { IconClose } from "../icons";

export interface QuizSetupValue {
  count: QuizCount;
  /** Undefined means the default: every topic, combined. */
  topicId?: string;
  difficulty: QuizDifficultySetting;
  format: QuizFormat;
}

interface QuizSetupProps {
  topics: TopicSummary[];
  onGenerate: (value: QuizSetupValue) => void;
  onClose: () => void;
  /** True while the request is in flight; controls the button and focus. */
  busy: boolean;
  /** Server-reported failure from the last attempt, if any. */
  error: string | null;
}

const COUNT_HINTS: Record<QuizCount, string> = {
  10: "Quick check",
  20: "Standard review",
  30: "Full practice test",
  40: "Extended assessment",
  50: "Comprehensive exam",
};

const DIFFICULTY_HINTS: Record<QuizDifficultySetting, string> = {
  mixed: "A spread of easy, medium, and hard",
  beginner: "Mostly foundational checks",
  intermediate: "Mostly applied reasoning",
  advanced: "Mostly proofs and edge cases",
};

const FORMAT_HINTS: Record<QuizFormat, string> = {
  mixed: "Multiple choice and true/false",
  multiple_choice: "Multiple choice only",
  true_false: "True/false only",
};

export function QuizSetup({ topics, onGenerate, onClose, busy, error }: QuizSetupProps) {
  const [count, setCount] = useState<QuizCount>(10);
  const [topicId, setTopicId] = useState<string | undefined>(undefined);
  const [difficulty, setDifficulty] = useState<QuizDifficultySetting>("mixed");
  const [format, setFormat] = useState<QuizFormat>("mixed");
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const generateRef = useRef<HTMLButtonElement>(null);

  // Move focus into the dialog on open, and keep Tab inside it: a modal that
  // leaks focus to the page behind it is a trap for keyboard users.
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!busy) generateRef.current?.focus();
  }, [busy]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusables = dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const submit = () => {
    if (busy) return;
    onGenerate({ count, ...(topicId ? { topicId } : {}), difficulty, format });
  };

  return (
    <div className="qa-overlay" role="presentation">
      <div
        className="qa-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="qa-setup-title"
        ref={dialogRef}
      >
        <div className="qa-dialog-head">
          <div>
            <h2 id="qa-setup-title" className="qa-dialog-title">
              Create a quiz
            </h2>
            <p className="qa-dialog-sub">
              Ten to fifty questions, drawn from the lesson catalog and checked against the solvers before you see
              them.
            </p>
          </div>
          <button
            type="button"
            className="btn-icon"
            onClick={onClose}
            ref={closeRef}
            disabled={busy}
            aria-label="Close quiz setup"
          >
            <IconClose />
          </button>
        </div>

        <fieldset className="qa-field" disabled={busy}>
          <legend className="qa-legend">How many questions?</legend>
          <div className="qa-counts" role="radiogroup" aria-label="Quiz length">
            {QUIZ_COUNTS.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={count === option}
                className={`qa-count ${count === option ? "qa-count-active" : ""}`}
                onClick={() => setCount(option)}
              >
                <span className="qa-count-num">{option}</span>
                <span className="qa-count-hint">{COUNT_HINTS[option]}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="qa-field" disabled={busy}>
          <legend className="qa-legend">What should it cover?</legend>
          <div className="qa-scope">
            <label className={`qa-scope-option ${topicId === undefined ? "qa-scope-active" : ""}`}>
              <input
                type="radio"
                name="qa-scope"
                checked={topicId === undefined}
                onChange={() => setTopicId(undefined)}
              />
              <span>
                <span className="qa-scope-title">All Topics — Combined Quiz</span>
                <span className="qa-scope-hint">
                  Questions from every lesson, mixed together. Recommended.
                </span>
              </span>
            </label>
            {topics.map((topic) => (
              <label
                key={topic.slug}
                className={`qa-scope-option ${topicId === topic.slug ? "qa-scope-active" : ""}`}
              >
                <input
                  type="radio"
                  name="qa-scope"
                  checked={topicId === topic.slug}
                  onChange={() => setTopicId(topic.slug)}
                />
                <span>
                  <span className="qa-scope-title">{topic.title}</span>
                  <span className="qa-scope-hint">{topic.description}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="qa-field-row">
          <fieldset className="qa-field qa-field-half" disabled={busy}>
            <legend className="qa-legend">Difficulty</legend>
            <div className="qa-segmented" role="radiogroup" aria-label="Difficulty">
              {QUIZ_DIFFICULTIES.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={difficulty === option}
                  className={`segment ${difficulty === option ? "segment-active" : ""}`}
                  onClick={() => setDifficulty(option)}
                  title={DIFFICULTY_HINTS[option]}
                >
                  {labelFor(option)}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="qa-field qa-field-half" disabled={busy}>
            <legend className="qa-legend">Format</legend>
            <div className="qa-segmented" role="radiogroup" aria-label="Question format">
              {QUIZ_FORMATS.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={format === option}
                  className={`segment ${format === option ? "segment-active" : ""}`}
                  onClick={() => setFormat(option)}
                  title={FORMAT_HINTS[option]}
                >
                  {labelFor(option)}
                </button>
              ))}
            </div>
          </fieldset>
        </div>

        {error && (
          <p className="qa-error" role="alert">
            {error}
          </p>
        )}

        <div className="qa-dialog-foot">
          <p className="qa-estimate">
            {count} questions · {topicId ? topics.find((t) => t.slug === topicId)?.title ?? "One topic" : "All topics"}
          </p>
          <div className="qa-dialog-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={submit}
              disabled={busy}
              ref={generateRef}
            >
              {busy ? "Generating…" : "Generate quiz"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Readable label for an enum value: "true_false" -> "True/False". */
function labelFor(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
