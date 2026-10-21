/**
 * Quiz setup dialog.
 *
 * The properties that matter here are the ones a student could not detect on
 * their own: that the ONLY lengths offered are the five the server supports,
 * that the default scope really is the combined catalog, and that what gets
 * sent is what was shown.
 *
 * No jest-dom matchers in this project — assertions are plain DOM.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QUIZ_COUNTS, type TopicSummary } from "@shared/contract";
import { QuizSetup, type QuizSetupValue } from "./QuizSetup";

const topics: TopicSummary[] = [
  { slug: "cook-levin", title: "Cook-Levin", description: "SAT is NP-complete." },
  { slug: "formal-reductions", title: "Formal Reductions", description: "Both directions." },
];

function renderSetup(overrides: Partial<Parameters<typeof QuizSetup>[0]> = {}) {
  const onGenerate = vi.fn<(value: QuizSetupValue) => void>();
  const onClose = vi.fn();
  render(
    <QuizSetup
      topics={topics}
      onGenerate={onGenerate}
      onClose={onClose}
      busy={false}
      error={null}
      {...overrides}
    />,
  );
  return { onGenerate, onClose };
}

function checked(el: HTMLElement): boolean {
  return el.getAttribute("aria-checked") === "true";
}

describe("length selector", () => {
  it("offers exactly 10, 20, 30, 40, and 50 — no other length is reachable", () => {
    renderSetup();
    const group = screen.getByRole("radiogroup", { name: "Quiz length" });
    const options = within(group).getAllByRole("radio");
    expect(options.map((o) => (o.textContent ?? "").match(/^\d+/)?.[0])).toEqual(["10", "20", "30", "40", "50"]);
    expect(options).toHaveLength(QUIZ_COUNTS.length);
  });

  it("defaults to 10 questions", () => {
    renderSetup();
    const group = screen.getByRole("radiogroup", { name: "Quiz length" });
    expect(checked(within(group).getAllByRole("radio")[0])).toBe(true);
  });

  it.each(QUIZ_COUNTS)("sends the requested length of %i unchanged", (count) => {
    const { onGenerate } = renderSetup();
    const group = screen.getByRole("radiogroup", { name: "Quiz length" });
    fireEvent.click(within(group).getByRole("radio", { name: new RegExp(`^${count}`) }));
    fireEvent.click(screen.getByRole("button", { name: "Generate quiz" }));
    expect(onGenerate).toHaveBeenCalledTimes(1);
    expect(onGenerate.mock.calls[0][0].count).toBe(count);
  });
});

describe("scope", () => {
  it("defaults to All Topics — Combined Quiz and asks for it by omission", () => {
    const onGenerate = vi.fn<(value: QuizSetupValue) => void>();
    render(<QuizSetup topics={topics} onGenerate={onGenerate} onClose={vi.fn()} busy={false} error={null} />);

    const combined = screen.getByLabelText(/All Topics — Combined Quiz/) as HTMLInputElement;
    expect(combined.checked).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Generate quiz" }));
    // Omitting topicId is how the client asks for the combined paper.
    expect(onGenerate.mock.calls[0][0].topicId).toBeUndefined();
  });

  it("sends a chosen topic, and only then", () => {
    const { onGenerate } = renderSetup();
    fireEvent.click(screen.getByLabelText(/Cook-Levin/));
    fireEvent.click(screen.getByRole("button", { name: "Generate quiz" }));
    expect(onGenerate.mock.calls[0][0].topicId).toBe("cook-levin");
  });

  it("lists every topic from the catalog, not a hardcoded second list", () => {
    renderSetup();
    for (const topic of topics) {
      expect(screen.getByText(topic.title)).toBeTruthy();
    }
    expect(screen.getByLabelText(/Formal Reductions/)).toBeTruthy();
  });
});

describe("difficulty and format", () => {
  it("defaults to mixed difficulty and mixed format", () => {
    renderSetup();
    const difficulty = within(screen.getByRole("radiogroup", { name: "Difficulty" })).getAllByRole("radio");
    const format = within(screen.getByRole("radiogroup", { name: "Question format" })).getAllByRole("radio");
    expect(checked(difficulty[0])).toBe(true);
    expect(checked(format[0])).toBe(true);
  });

  it("sends what was selected", () => {
    const { onGenerate } = renderSetup();
    fireEvent.click(screen.getByRole("radio", { name: "Advanced" }));
    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: "Question format" })).getByRole("radio", { name: "True False" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Generate quiz" }));
    expect(onGenerate.mock.calls[0][0]).toMatchObject({ difficulty: "advanced", format: "true_false" });
  });
});

describe("dialog behaviour", () => {
  it("closes on Escape while not busy", () => {
    const { onClose } = renderSetup();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("refuses to close on Escape while a request is in flight", () => {
    const { onClose } = renderSetup({ busy: true });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("reports a server failure as an alert instead of failing silently", () => {
    renderSetup({ error: "The provider is unavailable right now." });
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("The provider is unavailable right now.");
  });

  it("shows no alert when nothing went wrong", () => {
    renderSetup();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("disables every control while generating", () => {
    renderSetup({ busy: true });
    const generate = screen.getByRole("button", { name: "Generating…" }) as HTMLButtonElement;
    expect(generate.disabled).toBe(true);
    const fieldset = screen.getByRole("radiogroup", { name: "Quiz length" }).closest("fieldset");
    expect((fieldset as HTMLFieldSetElement).disabled).toBe(true);
    // A second submit cannot be fired from a disabled button.
    fireEvent.click(generate);
    expect(screen.queryByRole("button", { name: "Generate quiz" })).toBeNull();
  });

  it("is a modal dialog with an accessible name", () => {
    renderSetup();
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByRole("heading", { name: "Create a quiz" })).toBeTruthy();
  });
});
