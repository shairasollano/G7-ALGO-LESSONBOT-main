import { useState } from "react";
import type { ValidatedQuiz } from "@shared/contract";
import { api, friendlyError } from "../../api/client";

interface QuizBlockProps {
  quiz: ValidatedQuiz;
}

export function QuizBlock({ quiz }: QuizBlockProps) {
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<{
    score: number;
    total: number;
    results: { questionId: string; correct: boolean; given: number | null; answer: number; rationale: string; hint: string }[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [grading, setGrading] = useState(false);
  const [revealedHints, setRevealedHints] = useState<Set<string>>(new Set());

  const submit = async () => {
    setGrading(true);
    setError(null);
    try {
      const res = await api.gradeQuiz({ quizId: quiz.id, answers });
      setResult(res);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setGrading(false);
    }
  };

  const revealHint = (qid: string) => {
    setRevealedHints((prev) => new Set(prev).add(qid));
  };

  if (result) {
    return (
      <div className="block quiz-block">
        <div className="quiz-score" aria-live="polite">
          <span className="quiz-score-value">{result.score}/{result.total}</span>
          <span className="quiz-score-label">correct</span>
        </div>
        <ol className="quiz-results">
          {quiz.questions.map((q, i) => {
            const r = result.results[i];
            return (
              <li key={q.id} className={`quiz-result ${r.correct ? "correct" : "incorrect"}`}>
                <p className="quiz-result-prompt">{q.prompt}</p>
                <p className="quiz-result-verdict">
                  {r.correct ? "✓ Correct" : `✗ Incorrect — correct answer: ${q.choices ? q.choices[r.answer] : r.answer}`}
                </p>
                <p className="quiz-result-rationale">{r.rationale}</p>
              </li>
            );
          })}
        </ol>
        <button type="button" className="btn btn-primary" onClick={() => { setResult(null); setAnswers({}); }}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="block quiz-block">
      <p className="quiz-title">{quiz.title}</p>
      <ol className="quiz-questions">
        {quiz.questions.map((q, qi) => (
          <li key={q.id} className="quiz-question">
            <p className="quiz-prompt">
              <span className="quiz-qnum">{qi + 1}.</span> {q.prompt}
            </p>
            {q.kind === "multiple_choice" && q.choices ? (
              <div className="quiz-choices" role="radiogroup" aria-label={`Question ${qi + 1}`}>
                {q.choices.map((choice, ci) => (
                  <label key={ci} className={`quiz-choice ${answers[q.id] === ci ? "selected" : ""}`}>
                    <input
                      type="radio"
                      name={q.id}
                      value={ci}
                      checked={answers[q.id] === ci}
                      onChange={() => setAnswers((prev) => ({ ...prev, [q.id]: ci }))}
                    />
                    <span>{choice}</span>
                  </label>
                ))}
              </div>
            ) : (
              <div className="quiz-numerical">
                <label htmlFor={`num-${q.id}`} className="sr-only">Your numerical answer</label>
                <input
                  id={`num-${q.id}`}
                  type="number"
                  inputMode="numeric"
                  value={answers[q.id] ?? ""}
                  onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value === "" ? -1 : Number(e.target.value) }))}
                  placeholder="Enter a number"
                />
              </div>
            )}
            {revealedHints.has(q.id) && <p className="quiz-hint">Hint: {q.hint}</p>}
            {!revealedHints.has(q.id) && (
              <button type="button" className="btn btn-small btn-ghost" onClick={() => revealHint(q.id)}>
                Hint
              </button>
            )}
          </li>
        ))}
      </ol>
      {error && <p className="quiz-error" role="alert">{error}</p>}
      <button type="button" className="btn btn-primary" onClick={submit} disabled={grading}>
        {grading ? "Grading…" : "Submit answers"}
      </button>
    </div>
  );
}
