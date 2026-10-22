/**
 * Bottom-anchored composer. The input stays usable while a response streams;
 * the send button becomes a stop button during streaming, and Enter submits /
 * Shift+Enter inserts a newline.
 *
 * `draft` is an externally supplied seed question (from a landing-page topic
 * action). It prefills the input and focuses it, and is never submitted on the
 * visitor's behalf — they press Send themselves.
 */
import { useEffect, useRef, useState } from "react";
import { IconArrowUp, IconStop } from "../icons";

interface ComposerProps {
  onSend: (text: string) => void;
  onStop: () => void;
  streaming: boolean;
  /** Optional placeholder copy (home screen vs active conversation). */
  placeholder?: string;
  /** Seed question from the route; applied when it changes. */
  draft?: string | null;
  /** id of the element describing the composer, for aria-describedby. */
  hintId?: string;
  /** Hide the solver accuracy note when the welcome screen renders its own footer note. */
  showAccuracyNote?: boolean;
}

export function Composer({ onSend, onStop, streaming, placeholder, draft = null, hintId, showAccuracyNote = true }: ComposerProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow the textarea up to a cap. The cap is read from the computed
  // style rather than re-typed in JS, so the visual and behavioural limits
  // cannot drift apart.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const max = Number.parseFloat(getComputedStyle(el).maxHeight) || 200;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  }, [value]);

  // Apply a seed question: fill the input, put the caret at the end, focus it.
  useEffect(() => {
    if (!draft) return;
    setValue(draft);
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(draft.length, draft.length);
  }, [draft]);

  const submit = () => {
    const text = value.trim();
    if (!text) return;
    setValue("");
    onSend(text);
  };

  return (
    <div className="composer">
      <div className="composer-inner">
        <div className="composer-row">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends on a hardware keyboard; Shift+Enter always makes a
              // newline, and composing IME text is never treated as a submit.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (!streaming) submit();
              }
            }}
            placeholder={placeholder ?? "Ask a question, request an example, or say “quiz me”…"}
            aria-label="Message input"
            aria-describedby={hintId}
            rows={1}
            className="composer-input"
          />
          {streaming ? (
            <button
              type="button"
              onClick={onStop}
              className="btn btn-stop composer-send"
              aria-label="Stop generating"
              title="Stop generating"
            >
              <IconStop />
              <span className="send-label">Stop</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!value.trim()}
              className="btn btn-primary composer-send"
              aria-label="Send message"
              title="Send message"
            >
              <IconArrowUp />
              <span className="send-label"></span>
            </button>
          )}
        </div>
        <p className="composer-hint" id={hintId}>
          <span className="hint-desktop">Enter to send · Shift+Enter for a new line</span>
          {showAccuracyNote && (
            <>
              <span className="hint-separator" aria-hidden="true"> · </span>
              Answers are computed by deterministic solvers; always check formal claims against your course notes.
            </>
          )}
        </p>
      </div>
    </div>
  );
}
