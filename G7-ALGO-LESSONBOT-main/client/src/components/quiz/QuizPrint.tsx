/**
 * Printable documents: the student question paper, and the answer key.
 *
 * These are real DOM, printed by the browser's own print dialog through a
 * stylesheet — not screenshots, and not a second rendering path that could
 * drift from what is on screen. One component, two documents, because they
 * share the numbering, the header block, and the topic labels; splitting them
 * would mean keeping two sets of those in step.
 *
 * The separation that matters: the STUDENT PAPER never touches the answer
 * key. It is built from the keyless question list the overview already had,
 * so there is no code path in this file that could put a correct answer on a
 * student sheet — `QuizPrint` receives answers only for the on-screen review,
 * and the paper ignores them entirely. The key is a separate document,
 * rendered only when the instructor asked for it specifically.
 *
 * The off-screen container is `display: none` by default and becomes visible
 * only under `@media print`, which also hides the application chrome. What is
 * on screen and what comes out of the printer therefore cannot overlap.
 */
import { createPortal } from "react-dom";
import type {
  AssessmentAnswerKeyResponse,
  AssessmentMeta,
  AssessmentQuestion,
} from "@shared/contract";

export type PrintDoc =
  | {
      kind: "student";
      assessment: AssessmentMeta;
      questions: AssessmentQuestion[];
      answers: Record<string, number | null>;
    }
  | {
      kind: "key";
      assessment: AssessmentMeta;
      key: AssessmentAnswerKeyResponse;
    };

/**
 * Rendered as a direct child of <body>, not inside the app shell. That is
 * what lets the print stylesheet hide `.app` outright and print this alone —
 * were it nested inside, hiding the chrome would hide the paper too.
 */
export function QuizPrint({ doc }: { doc: PrintDoc }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="print-root" aria-hidden="true">
      {doc.kind === "student" ? <StudentPaper doc={doc} /> : <AnswerKeyPaper doc={doc} />}
    </div>,
    document.body,
  );
}

/** Shared masthead: what this is, how long it is, and where the marks go. */
function PaperHeader({
  assessment,
  kindLabel,
  itemCount,
}: {
  assessment: AssessmentMeta;
  kindLabel: string;
  itemCount: number;
}) {
  const scope =
    assessment.scope === "combined"
      ? `All Topics — Combined Quiz (${assessment.topicCoverage.length} topics)`
      : (assessment.topicCoverage[0]?.title ?? "One topic");
  return (
    <header className="paper-header">
      <p className="paper-school">G7 Algo — Algorithms &amp; Complexity Theory</p>
      <h1 className="paper-title">{assessment.title}</h1>
      <p className="paper-meta">
        {kindLabel} · {itemCount} questions · {scope} · Difficulty: {labelFor(assessment.difficulty)}
      </p>
      <div className="paper-fields">
        <span className="paper-field">Name: ______________________</span>
        <span className="paper-field">Section: __________</span>
        <span className="paper-field">Date: __________</span>
        <span className="paper-field">Score: ______ / {itemCount}</span>
      </div>
    </header>
  );
}

/**
 * The student question paper. Every question, in order, with its answer
 * choices lettered A–D (or a True/False box). No answers, no explanations,
 * no hints — a paper that leaked its own key would be useless in a classroom.
 */
function StudentPaper({ doc }: { doc: Extract<PrintDoc, { kind: "student" }> }) {
  const { assessment, questions } = doc;
  return (
    <article className="paper paper-student">
      <PaperHeader assessment={assessment} kindLabel="Student question paper" itemCount={questions.length} />

      <section className="paper-instructions">
        <h2 className="paper-section-title">Instructions</h2>
        <ul>
          <li>Answer every question. Circle or write your choice on this sheet.</li>
          <li>Multiple-choice questions have one correct answer, lettered A–D.</li>
          <li>True/false questions are marked with the boxes provided.</li>
          <li>Write numerical answers in the box beside the question.</li>
          <li>Work at your own pace. Check your answers before handing in.</li>
        </ul>
      </section>

      <ol className="paper-questions">
        {questions.map((q, i) => (
          <li key={q.id} className="paper-question">
            <p className="paper-question-text">
              <span className="paper-question-num">{i + 1}.</span>
              {q.prompt}
              <span className="paper-topic-label">
                {" "}
                [{assessment.topicCoverage.find((t) => t.topicId === q.topicId)?.title ?? q.topicId}]
              </span>
            </p>
            <AnswerArea question={q} />
          </li>
        ))}
      </ol>

      <footer className="paper-footer">
        <p>End of paper — {questions.length} questions. Check you have answered every one before handing in.</p>
      </footer>
    </article>
  );
}

/** The answer space: lettered choices, T/F boxes, or a blank for numerical. */
function AnswerArea({ question }: { question: AssessmentQuestion }) {
  if (question.kind === "true_false") {
    return (
      <p className="paper-tf">
        <span className="paper-box">True</span>
        <span className="paper-box">False</span>
      </p>
    );
  }
  if (question.choices) {
    return (
      <ul className="paper-choices">
        {question.choices.map((choice, i) => (
          <li key={i} className="paper-choice">
            <span className="paper-letter">{String.fromCharCode(65 + i)}.</span> {choice}
          </li>
        ))}
      </ul>
    );
  }
  return <p className="paper-blank">Answer: ______________________</p>;
}

/**
 * The answer key. A separate document with its own masthead, so it is obvious
 * from the printed page itself which sheet this is — nobody can staple the
 * wrong one to the back by accident without seeing it.
 */
function AnswerKeyPaper({ doc }: { doc: Extract<PrintDoc, { kind: "key" }> }) {
  const { assessment, key } = doc;
  return (
    <article className="paper paper-key">
      <PaperHeader assessment={assessment} kindLabel="ANSWER KEY — not for students" itemCount={key.questions.length} />

      <section className="paper-instructions">
        <h2 className="paper-section-title">Coverage summary</h2>
        <ul>
          {key.topicCoverage.map((entry) => (
            <li key={entry.topicId}>
              {entry.title} — {entry.count} question{entry.count === 1 ? "" : "s"}
            </li>
          ))}
        </ul>
      </section>

      <ol className="paper-questions paper-key-questions">
        {key.questions.map((q) => (
          <li key={q.id} className="paper-question paper-key-item">
            <p className="paper-question-text">
              <span className="paper-question-num">{q.number}.</span>
              {q.prompt}
            </p>
            <p className="paper-answer">
              <strong>Answer:</strong> {letterFor(q.number, q)} {q.answerText}
            </p>
            <p className="paper-explanation">
              <strong>Why:</strong> {q.explanation}
            </p>
          </li>
        ))}
      </ol>

      <footer className="paper-footer">
        <p>End of answer key — {key.questions.length} questions.</p>
      </footer>
    </article>
  );
}

/** Multiple choice reads better with its letter; numerical answers stand alone. */
function letterFor(_number: number, q: AssessmentAnswerKeyResponse["questions"][number]): string {
  return q.choices && q.choices[q.answer] !== undefined ? `${String.fromCharCode(65 + q.answer)}.` : "";
}

function labelFor(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
