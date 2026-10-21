/**
 * Assessment runner: overview → attempt → results, and the two print paths.
 *
 * What is being asserted here:
 *
 *   - The attempt cannot lose an answer by being navigated away from.
 *   - Blanks are warned about and confirmed, then sent as nulls so the server
 *     can tell "left blank" apart from "not part of this paper".
 *   - The score on screen is whatever the SERVER returned. This component does
 *     no arithmetic of its own, which is the whole reason a tampered client
 *     cannot improve its grade.
 *   - The student paper never contains an answer, and the answer key is a
 *     separate document fetched only when it is explicitly asked for.
 *
 * No jest-dom matchers in this project — assertions are plain DOM.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AssessmentAnswerKeyResponse,
  AssessmentCoverage,
  AssessmentGenerateResponse,
  AssessmentMeta,
  AssessmentQuestion,
  AssessmentQuestionResult,
  AssessmentSubmitResponse,
} from "@shared/contract";
import { QuizView, type LoadedAssessment } from "./QuizView";

const coverage: AssessmentCoverage[] = [
  { topicId: "cook-levin", title: "Cook-Levin", count: 2 },
  { topicId: "approximation-algorithms", title: "Approximation Algorithms", count: 2 },
];

const assessment: AssessmentMeta = {
  id: "asmt-fixture-1",
  title: "Mixed Quiz on Algorithms",
  scope: "combined",
  count: 4,
  difficulty: "mixed",
  format: "mixed",
  source: "ai",
  topicCoverage: coverage,
  createdAt: 1,
  expiresAt: 2,
};

const questions: AssessmentQuestion[] = [
  {
    id: "q1",
    topicId: "cook-levin",
    prompt: "Which statement about the tableau encoding is correct?",
    kind: "multiple_choice",
    choices: ["First option", "Second option", "Third option", "Fourth option"],
    hint: "Hint for the first question.",
    difficulty: "medium",
  },
  {
    id: "q2",
    topicId: "cook-levin",
    prompt: "The encoding preserves satisfiability in both directions.",
    kind: "true_false",
    choices: ["True", "False"],
    hint: "Hint for the second question.",
    difficulty: "easy",
  },
  {
    id: "q3",
    topicId: "approximation-algorithms",
    prompt: "Give the size of the cover the greedy rule returns.",
    kind: "numerical",
    choices: null,
    hint: "Hint for the third question.",
    difficulty: "hard",
  },
  {
    id: "q4",
    topicId: "approximation-algorithms",
    prompt: "What approximation ratio does the vertex cover algorithm achieve?",
    kind: "multiple_choice",
    choices: ["One half", "Two", "Three", "Logarithmic"],
    hint: "Hint for the fourth question.",
    difficulty: "medium",
  },
];

const data: LoadedAssessment = {
  assessment,
  questions,
  notes: ["Filled 1 question for a topic from the curated bank."],
};

/** One review entry per question: all correct except the last. */
function reviewResults(): AssessmentQuestionResult[] {
  return questions.map((q, i) => ({
    questionId: q.id,
    topicId: q.topicId,
    prompt: q.prompt,
    kind: q.kind,
    choices: q.choices,
    given: q.choices ? (i === 3 ? 0 : 1) : 7,
    answer: q.choices ? 1 : 7,
    correct: i !== 3,
    unanswered: false,
    explanation: `Explanation for ${q.id}.`,
  }));
}

function submitResponse(overrides: Partial<AssessmentSubmitResponse> = {}): AssessmentSubmitResponse {
  return {
    assessmentId: assessment.id,
    title: assessment.title,
    score: 3,
    total: 4,
    correct: 3,
    incorrect: 1,
    unanswered: 0,
    percentage: 75,
    topicBreakdown: coverage.map((c) => ({ ...c, correct: c.topicId === "cook-levin" ? 2 : 1 })),
    results: reviewResults(),
    ...overrides,
  };
}

const answerKey: AssessmentAnswerKeyResponse = {
  assessmentId: assessment.id,
  title: assessment.title,
  count: 4,
  topicCoverage: coverage,
  questions: questions.map((q, i) => ({
    id: q.id,
    number: i + 1,
    topicId: q.topicId,
    prompt: q.prompt,
    kind: q.kind,
    choices: q.choices,
    answer: 1,
    answerText: q.choices ? q.choices[1] : "7",
    explanation: `Key explanation for ${q.id}.`,
  })),
};

interface Rendered {
  submit: ReturnType<typeof vi.fn>;
  fetchAnswerKey: ReturnType<typeof vi.fn>;
  onExit: ReturnType<typeof vi.fn>;
  onNewQuiz: ReturnType<typeof vi.fn>;
}

function renderView(overrides: Partial<LoadedAssessment> = {}): Rendered {
  const submit = vi.fn(async (_assessmentId: string, _answers: Record<string, number | null>) =>
    submitResponse(),
  );
  const fetchAnswerKey = vi.fn(async (_id: string) => answerKey);
  const onExit = vi.fn();
  const onNewQuiz = vi.fn();
  render(
    <QuizView
      data={{ ...data, ...overrides }}
      onExit={onExit}
      onNewQuiz={onNewQuiz}
      submit={submit}
      fetchAnswerKey={fetchAnswerKey}
    />,
  );
  return { submit, fetchAnswerKey, onExit, onNewQuiz };
}

/** Answer whatever control the current question presents, then move on. */
function answerCurrentQuestion(): void {
  const numeric = document.querySelector<HTMLInputElement>(".qa-numerical-input");
  if (numeric) {
    fireEvent.change(numeric, { target: { value: "7" } });
    return;
  }
  const radios = document.querySelectorAll<HTMLInputElement>(".qa-choice input");
  if (radios.length > 0) fireEvent.click(radios[1]);
}

function clickNext(): void {
  fireEvent.click(screen.getByRole("button", { name: /^Next/ }));
}

function start(): void {
  fireEvent.click(screen.getByRole("button", { name: "Start quiz" }));
}

/** Overview → Start → answer everything → walk to the end → submit. */
async function runToResults(rendered: Rendered): Promise<void> {
  start();
  for (let i = 0; i < questions.length; i++) {
    if (i > 0) clickNext();
    answerCurrentQuestion();
  }
  fireEvent.click(screen.getByRole("button", { name: "Submit quiz" }));
  await waitFor(() => expect(rendered.submit).toHaveBeenCalledTimes(1));
  await screen.findByRole("heading", { name: "By topic" });
}

/** Answer only the first question, then walk to the last one. */
function startWithBlanks(): void {
  start();
  answerCurrentQuestion();
  for (let i = 0; i < 3; i++) clickNext();
}

/** Wait for a portal-rendered sheet to appear anywhere in the document. */
async function findByClass(className: string): Promise<HTMLElement> {
  return waitFor(() => {
    const el = document.querySelector(`.${className}`);
    expect(el, `expected a .${className} to render`).toBeTruthy();
    return el as HTMLElement;
  });
}

let printMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  printMock = vi.fn();
  Object.defineProperty(window, "print", { value: printMock, configurable: true, writable: true });
});

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

describe("overview", () => {
  it("shows what the student is about to take before anything starts", () => {
    renderView();
    expect(screen.getByRole("heading", { name: assessment.title, level: 1 })).toBeTruthy();
    const facts = document.querySelector(".qa-facts") as HTMLElement;
    expect(facts.textContent).toContain("Questions");
    expect(facts.textContent).toContain("4");
    expect(facts.textContent).toContain("Mixed");
    expect(screen.getByText(/AI-generated from the lesson catalog/)).toBeTruthy();
  });

  it("lists the actual coverage with per-topic counts", () => {
    renderView();
    const list = screen.getByRole("heading", { name: "Coverage" }).nextElementSibling as HTMLElement;
    expect(list.textContent).toContain("Cook-Levin");
    expect(list.textContent).toContain("Approximation Algorithms");
    expect(list.textContent).toContain("2");
  });

  it("states plainly that the answer key is never shown during the attempt", () => {
    renderView();
    expect(screen.getByText(/The answer key is never shown during the attempt/)).toBeTruthy();
    expect(screen.getByText(/This session lasts an hour/)).toBeTruthy();
  });

  it("surfaces the generator's notes instead of hiding a partial build", () => {
    renderView();
    expect(screen.getByRole("note").textContent).toContain("curated bank");
  });

  it("hides the notes when there are none", () => {
    renderView({ notes: undefined });
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("labels a curated paper as curated, not as AI-generated", () => {
    renderView({ assessment: { ...assessment, source: "curated" } });
    expect(screen.getByText(/Curated question bank/)).toBeTruthy();
    expect(screen.queryByText(/AI-generated/)).toBeNull();
  });

  it("labels a half-generated paper as mixed", () => {
    renderView({ assessment: { ...assessment, source: "mixed" } });
    expect(screen.getByText(/AI-generated and curated/)).toBeTruthy();
  });

  it("starts in the overview, with no attempt state yet", () => {
    const rendered = renderView();
    expect(rendered.onExit).not.toHaveBeenCalled();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByRole("button", { name: "Submit quiz" })).toBeNull();
    start();
    expect(screen.getByRole("progressbar")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Attempt
// ---------------------------------------------------------------------------

describe("attempt", () => {
  beforeEach(() => {
    renderView();
    start();
  });

  it("reports position as N of M", () => {
    expect(screen.getByText("Question 1 of 4")).toBeTruthy();
    clickNext();
    expect(screen.getByText("Question 2 of 4")).toBeTruthy();
  });

  it("exposes progress as a real progressbar with answered counts", () => {
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("0");
    expect(bar.getAttribute("aria-valuemin")).toBe("0");
    expect(bar.getAttribute("aria-valuemax")).toBe("4");
    expect(screen.getByText("0 answered · 4 remaining")).toBeTruthy();
  });

  it("tags each question with its topic and difficulty", () => {
    expect(document.querySelector(".qa-topic-tag")?.textContent).toBe("Cook-Levin");
    expect(document.querySelector(".qa-difficulty-tag")?.textContent).toBe("Medium");
    clickNext();
    clickNext();
    expect(document.querySelector(".qa-topic-tag")?.textContent).toBe("Approximation Algorithms");
  });

  it("letters multiple-choice options A–D", () => {
    const letters = [...document.querySelectorAll(".qa-choice-letter")].map((el) => el.textContent);
    expect(letters).toEqual(["A", "B", "C", "D"]);
  });

  it("offers True/False as a pair, and a number input for numerical answers", () => {
    clickNext();
    const tf = [...document.querySelectorAll(".qa-choice-text")].map((el) => el.textContent);
    expect(tf).toEqual(["True", "False"]);
    clickNext();
    const input = document.querySelector(".qa-numerical-input") as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.type).toBe("number");
    expect(screen.getByLabelText("Your answer")).toBe(input);
  });

  it("keeps an answer when the student navigates away and back", () => {
    fireEvent.click(document.querySelectorAll<HTMLInputElement>(".qa-choice input")[0]);
    fireEvent.click(screen.getByRole("button", { name: /^Next/ }));
    expect(screen.getByText("Question 2 of 4")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(document.querySelectorAll<HTMLInputElement>(".qa-choice input")[0].checked).toBe(true);
    expect(screen.getByText("1 answered · 3 remaining")).toBeTruthy();
  });

  it("jumps straight to any question from the navigator", () => {
    const nav = screen.getByRole("navigation", { name: "Jump to a question" });
    const dots = within(nav).getAllByRole("button");
    expect(dots).toHaveLength(4);
    expect(dots[0].getAttribute("aria-current")).toBe("true");
    expect(dots[0].getAttribute("aria-label")).toContain("not answered");
    fireEvent.click(dots[3]);
    expect(screen.getByText("Question 4 of 4")).toBeTruthy();
    expect(within(screen.getByRole("navigation", { name: "Jump to a question" })).getAllByRole("button")[3]
      .getAttribute("aria-current")).toBe("true");
  });

  it("marks answered questions in the navigator", () => {
    fireEvent.click(document.querySelectorAll<HTMLInputElement>(".qa-choice input")[0]);
    const dots = within(screen.getByRole("navigation", { name: "Jump to a question" })).getAllByRole("button");
    expect(dots[0].getAttribute("aria-label")).toContain("answered");
  });

  it("disables Previous on the first question and offers Submit at the last", () => {
    expect((screen.getByRole("button", { name: "Previous" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Submit quiz" })).toBeNull();
    for (let i = 0; i < 3; i++) clickNext();
    expect(screen.queryByRole("button", { name: /^Next/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Submit quiz" })).toBeTruthy();
  });

  it("keeps the hint behind a deliberate click", () => {
    expect(screen.queryByText("Hint for the first question.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show hint" }));
    expect(screen.getByText("Hint for the first question.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hide hint" }));
    expect(screen.queryByText("Hint for the first question.")).toBeNull();
  });

  it("does not show the review, the score, or any explanation mid-attempt", () => {
    answerCurrentQuestion();
    const attempt = document.querySelector(".qa-view") as HTMLElement;
    expect(attempt.querySelector(".qa-review")).toBeNull();
    expect(attempt.querySelector(".qa-score")).toBeNull();
    expect(attempt.textContent).not.toContain("Explanation for");
    expect(attempt.textContent).not.toContain("Key explanation");
  });
});

// ---------------------------------------------------------------------------
// Submitting
// ---------------------------------------------------------------------------

describe("submitting", () => {
  it("warns about blanks before submitting, then sends them as nulls", async () => {
    const rendered = renderView();
    startWithBlanks();

    // Three of four are still blank on the last question.
    expect(screen.getByText(/questions are still unanswered/)).toBeTruthy();
    expect(screen.getByText(/3 questions are still unanswered/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Submit quiz" }));
    const confirm = await screen.findByRole("alertdialog");
    expect(confirm.textContent).toContain("3 unanswered questions");
    expect(rendered.submit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Go back and answer" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(rendered.submit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Submit quiz" }));
    fireEvent.click(await screen.findByRole("button", { name: "Submit anyway" }));

    await waitFor(() => expect(rendered.submit).toHaveBeenCalledTimes(1));
    const [id, answers] = rendered.submit.mock.calls[0];
    expect(id).toBe(assessment.id);
    // Every question is sent, blanks included, so the server can distinguish
    // "left blank" from "not part of this paper".
    expect(Object.keys(answers).sort()).toEqual(["q1", "q2", "q3", "q4"]);
    expect(answers.q1).toBe(1);
    expect(answers.q2).toBeNull();
    expect(answers.q3).toBeNull();
    expect(answers.q4).toBeNull();
  });

  it("submits without a confirmation once everything is answered", async () => {
    const rendered = renderView();
    await runToResults(rendered);
    expect(rendered.submit).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("shows the server's expiry message instead of a generic failure", async () => {
    const rendered = renderView();
    rendered.submit.mockRejectedValueOnce(new Error("quiz_expired"));
    startWithBlanks();

    fireEvent.click(screen.getByRole("button", { name: "Submit quiz" }));
    fireEvent.click(await screen.findByRole("button", { name: "Submit anyway" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("This quiz session has expired. Please generate a new quiz.");
    // A failed submit must not advance to a results screen it does not have.
    expect(screen.queryByRole("heading", { name: "By topic" })).toBeNull();
    expect(screen.getByRole("progressbar")).toBeTruthy();
  });

  it("reports a rejected submit without losing the answers", async () => {
    const rendered = renderView();
    rendered.submit.mockRejectedValueOnce(new Error("network_error"));
    startWithBlanks();
    fireEvent.click(screen.getByRole("button", { name: "Submit quiz" }));
    fireEvent.click(await screen.findByRole("button", { name: "Submit anyway" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Could not reach the server");
    expect(screen.getByText(/3 questions are still unanswered/)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Results — all of it server-issued
// ---------------------------------------------------------------------------

describe("results", () => {
  it("displays the score the SERVER returned, not one computed here", async () => {
    const rendered = renderView();
    // Whatever the student answered, the displayed score is the server's.
    rendered.submit.mockResolvedValueOnce(submitResponse({ percentage: 20, correct: 1, total: 5 }));
    startWithBlanks();
    fireEvent.click(screen.getByRole("button", { name: "Submit quiz" }));
    fireEvent.click(await screen.findByRole("button", { name: "Submit anyway" }));

    await screen.findByRole("heading", { name: "By topic" });
    const score = document.querySelector(".qa-score") as HTMLElement;
    expect(score.textContent).toContain("20%");
    expect(score.textContent).toContain("1 of 5 correct");
  });

  it("shows correct, incorrect, and unanswered counts separately", async () => {
    const rendered = renderView();
    await runToResults(rendered);
    const breakdown = document.querySelector(".qa-score-breakdown") as HTMLElement;
    expect(breakdown.textContent).toContain("3 correct");
    expect(breakdown.textContent).toContain("1 incorrect");
    expect(breakdown.textContent).toContain("0 unanswered");
  });

  it("summarises performance by topic", async () => {
    const rendered = renderView();
    await runToResults(rendered);
    const list = document.querySelector(".qa-topic-results .qa-coverage-list") as HTMLElement;
    expect(list.textContent).toContain("Cook-Levin");
    expect(list.textContent).toContain("2/2");
    expect(list.textContent).toContain("1/2");
  });

  it("reviews every question with the given answer, the correct one, and why", async () => {
    const rendered = renderView();
    await runToResults(rendered);
    const items = document.querySelectorAll(".qa-review-item");
    expect(items).toHaveLength(4);
    expect(items[0].textContent).toContain("Correct");
    expect(items[3].textContent).toContain("Incorrect");
    expect(items[0].textContent).toContain("Your answer");
    expect(items[0].textContent).toContain("Correct answer");
    expect(items[0].textContent).toContain("Explanation for q1.");
    // The correct option is spelled out, lettered.
    expect(items[0].textContent).toContain("B. Second option");
    // The student's own (wrong) choice is shown as theirs.
    expect(items[3].textContent).toContain("A. One half");
  });

  it("says so when the result is a replay of an earlier submission", async () => {
    const rendered = renderView();
    rendered.submit.mockResolvedValueOnce(submitResponse({ alreadySubmitted: true }));
    startWithBlanks();
    fireEvent.click(screen.getByRole("button", { name: "Submit quiz" }));
    fireEvent.click(await screen.findByRole("button", { name: "Submit anyway" }));

    const note = await screen.findByRole("note");
    expect(note.textContent).toContain("already submitted");
  });

  it("offers a way back to the chat and a fresh quiz", async () => {
    const rendered = renderView();
    await runToResults(rendered);
    fireEvent.click(screen.getByRole("button", { name: /Back to chat/ }));
    expect(rendered.onExit).toHaveBeenCalledTimes(1);
    const newQuiz = screen.getAllByRole("button", { name: /New quiz/ });
    fireEvent.click(newQuiz[newQuiz.length - 1]);
    expect(rendered.onNewQuiz).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Print — the student paper
// ---------------------------------------------------------------------------

describe("print: the student paper", () => {
  it("renders a printable sheet with headings, blanks, and sequential numbering", async () => {
    const rendered = renderView();
    await runToResults(rendered);
    fireEvent.click(screen.getByRole("button", { name: "Print question paper" }));

    const root = await waitFor(() => {
      const el = document.querySelector(".print-root");
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    const paper = root.querySelector(".paper-student") as HTMLElement;

    expect(paper.textContent).toContain("G7 Algo");
    expect(paper.textContent).toContain(assessment.title);
    expect(paper.textContent).toContain("4 questions");
    expect(paper.textContent).toContain("Name:");
    expect(paper.textContent).toContain("Section:");
    expect(paper.textContent).toContain("Date:");
    expect(paper.textContent).toContain("Score:");
    expect(paper.textContent).toContain("Instructions");

    const numbers = [...paper.querySelectorAll(".paper-question-num")].map((el) => el.textContent);
    expect(numbers).toEqual(["1.", "2.", "3.", "4."]);
    expect(paper.querySelectorAll(".paper-question")).toHaveLength(4);
  });

  it("letters choices, and gives true/false its own boxes", async () => {
    const rendered = renderView();
    await runToResults(rendered);
    fireEvent.click(screen.getByRole("button", { name: "Print question paper" }));
    const paper = (await findByClass("paper-student")) as HTMLElement;
    const items = paper.querySelectorAll(".paper-question");

    const letters = items[0].querySelectorAll(".paper-letter");
    expect([...letters].map((el) => el.textContent)).toEqual(["A.", "B.", "C.", "D."]);

    const tf = items[1].querySelectorAll(".paper-box");
    expect([...tf].map((el) => el.textContent)).toEqual(["True", "False"]);

    // The numerical item leaves a blank to write in, not an input control.
    expect(items[2].textContent).toContain("Answer: ___");
    expect(items[2].querySelector("input")).toBeNull();
  });

  it("carries NO answer, explanation, hint, or score on the student sheet", async () => {
    const rendered = renderView();
    await runToResults(rendered);
    fireEvent.click(screen.getByRole("button", { name: "Print question paper" }));
    const paper = (await findByClass("paper-student")) as HTMLElement;
    const text = paper.textContent ?? "";

    expect(paper.querySelector(".paper-answer")).toBeNull();
    expect(paper.querySelector(".paper-explanation")).toBeNull();
    expect(text).not.toContain("Explanation for");
    expect(text).not.toContain("Hint for");
    expect(text).not.toContain("Key explanation");
    // The graded review does not leak onto a blank paper either.
    expect(text).not.toContain("Your answer");
    expect(text).not.toContain("Correct answer");
    expect(text).not.toContain("75%");
    // Printing the paper does not touch the key endpoint at all.
    expect(rendered.fetchAnswerKey).not.toHaveBeenCalled();
  });

  it("hands off to the browser print dialog and clears up afterwards", async () => {
    const rendered = renderView();
    await runToResults(rendered);
    fireEvent.click(screen.getByRole("button", { name: "Print question paper" }));
    await waitFor(() => expect(printMock).toHaveBeenCalledTimes(1));

    act(() => {
      window.dispatchEvent(new Event("afterprint"));
    });
    await waitFor(() => expect(document.querySelector(".print-root")).toBeNull());
    expect(printMock).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Print — the answer key
// ---------------------------------------------------------------------------

describe("print: the answer key", () => {
  it("is a separate document, fetched only when explicitly asked for", async () => {
    const rendered = renderView();
    await runToResults(rendered);
    expect(rendered.fetchAnswerKey).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Print answer key" }));
    const key = (await findByClass("paper-key")) as HTMLElement;

    expect(rendered.fetchAnswerKey).toHaveBeenCalledTimes(1);
    expect(rendered.fetchAnswerKey).toHaveBeenCalledWith(assessment.id);
    expect(key.textContent).toContain("ANSWER KEY — not for students");
    expect(key.textContent).toContain("End of answer key");
  });

  it("shows the answer, its letter, and the reason, numbered in order", async () => {
    const rendered = renderView();
    await runToResults(rendered);
    fireEvent.click(screen.getByRole("button", { name: "Print answer key" }));
    const key = (await findByClass("paper-key")) as HTMLElement;

    const items = key.querySelectorAll(".paper-key-item");
    expect(items).toHaveLength(4);
    expect(items[0].querySelector(".paper-question-num")?.textContent).toBe("1.");
    expect(items[4 - 1].querySelector(".paper-question-num")?.textContent).toBe("4.");
    expect(items[0].textContent).toContain("B. Second option");
    expect(items[0].textContent).toContain("Key explanation for q1.");
    expect(items[3].textContent).toContain("Key explanation for q4.");
    // The numerical key states the value, with no letter.
    expect(items[2].textContent).toContain("Answer:");
    expect(items[2].textContent).toContain("7");
  });

  it("lists the coverage summary on the key, as an instructor's sheet should", async () => {
    const rendered = renderView();
    await runToResults(rendered);
    fireEvent.click(screen.getByRole("button", { name: "Print answer key" }));
    const key = (await findByClass("paper-key")) as HTMLElement;
    expect(key.textContent).toContain("Coverage summary");
    expect(key.textContent).toContain("Cook-Levin — 2 questions");
  });

  it("reports a failure to fetch the key instead of printing an empty sheet", async () => {
    const rendered = renderView();
    await runToResults(rendered);
    rendered.fetchAnswerKey.mockRejectedValueOnce(new Error("quiz_expired"));
    fireEvent.click(screen.getByRole("button", { name: "Print answer key" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("This quiz session has expired");
    expect(document.querySelector(".print-root")).toBeNull();
    expect(printMock).not.toHaveBeenCalled();
  });

  it("never renders the key and the student paper at the same time", async () => {
    const rendered = renderView();
    await runToResults(rendered);
    fireEvent.click(screen.getByRole("button", { name: "Print answer key" }));
    await findByClass("paper-key");
    expect(document.querySelector(".paper-student")).toBeNull();
    expect(document.querySelectorAll(".print-root")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Portal placement — what makes the print stylesheet able to hide the app
// ---------------------------------------------------------------------------

describe("the print portal", () => {
  it("attaches to document.body so the app shell can be hidden while printing", async () => {
    const rendered = renderView();
    await runToResults(rendered);
    fireEvent.click(screen.getByRole("button", { name: "Print question paper" }));
    const root = await findByClass("print-root");
    expect(root.parentElement).toBe(document.body);
    expect(root.getAttribute("aria-hidden")).toBe("true");
  });

  it("keeps the printable sheet out of the app shell", async () => {
    const rendered = renderView();
    await runToResults(rendered);
    fireEvent.click(screen.getByRole("button", { name: "Print question paper" }));
    await findByClass("print-root");
    const shell = document.querySelector(".qa-view") as HTMLElement;
    expect(shell.contains(document.querySelector(".print-root"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The questions the student is handed
// ---------------------------------------------------------------------------

describe("the keyless payload", () => {
  it("contains no answer or explanation field at all", () => {
    renderView();
    for (const q of questions) {
      expect(Object.keys(q)).not.toContain("answer");
      expect(Object.keys(q)).not.toContain("explanation");
      expect(Object.keys(q)).not.toContain("answerText");
    }
    // And the overview/attempt never renders one either.
    const view = document.querySelector(".qa-view") as HTMLElement;
    expect(view.textContent).not.toContain("Key explanation");
    expect(view.querySelector(".qa-review")).toBeNull();
  });

  it("matches what the client reads from the server", () => {
    const response: AssessmentGenerateResponse = { assessment, questions };
    expect(response.assessment.topicCoverage).toHaveLength(2);
    expect(response.questions.every((q) => !("answer" in q))).toBe(true);
  });
});
