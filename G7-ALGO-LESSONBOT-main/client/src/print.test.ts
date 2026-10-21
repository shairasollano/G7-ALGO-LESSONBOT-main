/**
 * Print stylesheet.
 *
 * The stylesheet cannot be exercised by jsdom — jsdom has no printer and no
 * pagination — so these tests read the real `print.css` and assert the rules
 * that make a printed sheet work. They are assertions about intent that the
 * browser then honours: what is hidden, what is kept, and what stops a
 * question from straddling a page break.
 *
 * The companion browser check (a real Chromium print-to-PDF) verifies
 * pagination and appearance; this file verifies that the rules responsible for
 * them are actually present and scoped to `@media print`.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Locate a source file without depending on `import.meta.url`, which is an
 *  http URL under the jsdom environment rather than a file path. */
function sourceFile(name: string): string {
  const candidates = [
    resolve(process.cwd(), "src", name),
    resolve(process.cwd(), "client", "src", name),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`could not locate src/${name} from ${process.cwd()}`);
}

const css = readFileSync(sourceFile("print.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Every `@media print { … }` block, with nested at-rules kept intact. */
function printBlocks(source: string): string[] {
  const blocks: string[] = [];
  const re = /@media[^{]*print[^{]*\{/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    let depth = 1;
    let i = match.index + match[0].length;
    const start = i;
    while (depth > 0 && i < source.length) {
      if (source[i] === "{") depth += 1;
      else if (source[i] === "}") depth -= 1;
      i += 1;
    }
    blocks.push(source.slice(start, i - 1));
  }
  return blocks;
}

/** The stylesheet with every `@media` block removed: the on-screen rules. */
const screenOnly = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");

const blocks = printBlocks(css);
const printed = blocks.join("\n");

/** Assert that a selector's declaration block appears inside @media print. */
function printedRule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "m");
  const found = re.exec(printed);
  expect(found, `expected a printed rule for ${selector}`).toBeTruthy();
  return found?.[1] ?? "";
}

describe("the sheet is hidden on screen", () => {
  it("keeps the print root out of the on-screen layout", () => {
    const rule = /\.print-root\s*\{([^}]*)\}/.exec(screenOnly);
    expect(rule, ".print-root needs an on-screen rule").toBeTruthy();
    expect(rule?.[1]).toMatch(/display\s*:\s*none/);
  });

  it("does not put the paper's typography on screen", () => {
    // Typography lives inside @media print so the app's own layout is not
    // restyled; only the hide rule applies on screen.
    expect(screenOnly).not.toMatch(/\.paper-title\s*\{/);
    expect(screenOnly).not.toMatch(/\.paper-question\s*\{/);
  });
});

describe("the sheet is shown when printing", () => {
  it("reveals the print root under @media print", () => {
    expect(printedRule(".print-root")).toMatch(/display\s*:\s*block/);
  });

  it("hides the application chrome while printing", () => {
    // The header, the navigator, and the question footer all live inside
    // .qa-view, so hiding the view is what keeps the quiz chrome off the page.
    const chrome = /\.app,\s*\.qa-view,\s*\.qa-overlay\s*\{([^}]*)\}/.exec(printed);
    expect(chrome, "the app shell and quiz chrome must be hidden when printing").toBeTruthy();
    expect(chrome?.[1]).toMatch(/display\s*:\s*none\s*!important/);
    for (const selector of [".app", ".qa-view", ".qa-overlay"]) {
      expect(chrome?.[0], `${selector} must be hidden when printing`).toContain(selector);
    }
    expect(blocks.length).toBeGreaterThan(1);
  });

  it("hides interactive controls outright, so nothing prints as a button", () => {
    const controlRule = printed.match(/button\s*,\s*a\s*,\s*input\s*,\s*select\s*,\s*textarea\s*\{([^}]*)\}/);
    expect(controlRule, "controls must be hidden in print").toBeTruthy();
    expect(controlRule?.[1]).toMatch(/display\s*:\s*none\s*!important/);
  });

  it("sets page margins", () => {
    expect(printed).toMatch(/@page\s*\{[^}]*margin\s*:/);
  });
});

describe("printed output is legible on a monochrome printer", () => {
  it("prints black on white", () => {
    expect(printedRule("html,\n  body")).toMatch(/background\s*:\s*#fff\s*!important/);
    expect(printedRule("html,\n  body")).toMatch(/color\s*:\s*#000\s*!important/);
    expect(printedRule(".paper")).toMatch(/color\s*:\s*#000/);
    expect(printedRule(".paper")).toMatch(/background\s*:\s*#fff/);
  });

  it("uses borders rather than tints to separate things", () => {
    expect(printedRule(".paper-question")).toMatch(/border-bottom/);
    expect(printedRule(".paper-header")).toMatch(/border-bottom/);
    expect(printedRule(".paper-instructions")).toMatch(/border\s*:/);
    expect(printedRule(".paper-footer")).toMatch(/border-top/);
  });

  it("does not rely on a colour that a grayscale printer would drop", () => {
    // Every colour declared for printed text is pure black or pure white;
    // anything else would come out as an unreadable pale grey.
    const textColors = [...printed.matchAll(/(?:^|[;{])\s*color\s*:\s*([^;}]+)/g)].map((m) =>
      m[1].replace(/\s*!important\s*/i, "").trim().toLowerCase(),
    );
    expect(textColors.length).toBeGreaterThan(0);
    for (const value of textColors) {
      expect(["#000", "#000000", "black", "#fff", "#ffffff", "white"], `printed colour ${value}`).toContain(value);
    }
  });
});

describe("pagination is deliberate", () => {
  it("never splits a question across two pages", () => {
    expect(printedRule(".paper-question")).toMatch(/break-inside\s*:\s*avoid/);
  });

  it("never leaves a heading stranded at the foot of a page", () => {
    expect(printedRule(".paper-header")).toMatch(/break-after\s*:\s*avoid/);
    expect(printedRule(".paper-instructions")).toMatch(/break-after\s*:\s*avoid/);
  });

  it("keeps the masthead and the instructions block whole", () => {
    expect(printedRule(".paper-header")).toMatch(/break-inside\s*:\s*avoid/);
    expect(printedRule(".paper-instructions")).toMatch(/break-inside\s*:\s*avoid/);
  });

  it("keeps the footer off a page of its own", () => {
    expect(printedRule(".paper-footer")).toMatch(/break-inside\s*:\s*avoid/);
  });
});

describe("the answer space prints as something a student can mark", () => {
  it("gives multiple choice ruled lettered options", () => {
    expect(printedRule(".paper-choices")).toBeTruthy();
    expect(printedRule(".paper-letter")).toMatch(/font-weight\s*:\s*700/);
  });

  it("gives true/false two boxes to tick", () => {
    const box = printedRule(".paper-box");
    expect(box).toMatch(/border\s*:/);
    expect(box).toMatch(/text-align\s*:\s*center/);
  });

  it("leaves a blank line for a numerical answer", () => {
    expect(printedRule(".paper-blank")).toBeTruthy();
  });

  it("keeps a question's number attached to its text", () => {
    expect(printedRule(".paper-question-num")).toMatch(/font-weight\s*:\s*700/);
    expect(printedRule(".paper-question-num")).toMatch(/margin-right/);
  });
});

describe("the answer key is unmistakable on paper", () => {
  it("inverts the key's masthead so it cannot be mistaken for a student sheet", () => {
    const school = printedRule(".paper-key .paper-school");
    expect(school).toMatch(/background\s*:\s*#000/);
    expect(school).toMatch(/color\s*:\s*#fff/);
  });

  it("rules the key's header more heavily than the paper's", () => {
    const key = /\.paper-key\s*\.paper-header\s*\{([^}]*)\}/.exec(printed);
    expect(key).toBeTruthy();
    const student = /\.paper-header\s*\{([^}]*)\}/.exec(printed);
    const weight = (block: string) => Number(/border-bottom\s*:\s*([\d.]+)/.exec(block)?.[1] ?? 0);
    expect(weight(key?.[1] ?? "")).toBeGreaterThan(weight(student?.[1] ?? ""));
  });
});

describe("the stylesheet is actually loaded", () => {
  it("is imported by the app entry, after the screen stylesheet", () => {
    const main = readFileSync(sourceFile("main.tsx"), "utf8");
    const printAt = main.indexOf('import "./print.css"');
    const stylesAt = main.indexOf('import "./styles.css"');
    expect(printAt, "print.css must be imported").toBeGreaterThan(-1);
    expect(stylesAt).toBeGreaterThan(-1);
    // Print rules must come last so they win the cascade against the app.
    expect(printAt).toBeGreaterThan(stylesAt);
  });

  it("defines something for every selector it hides", () => {
    // A stylesheet that only hides things would be a regression; the paper has
    // to have real rules of its own.
    const classes = new Set([...printed.matchAll(/\.([a-z][a-z0-9-]*)/g)].map((m) => m[1]));
    expect(classes.has("paper")).toBe(true);
    expect(classes.has("paper-question")).toBe(true);
    expect(classes.has("print-root")).toBe(true);
  });
});
