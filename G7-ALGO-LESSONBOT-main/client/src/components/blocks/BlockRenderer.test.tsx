import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { BlockRenderer } from "./BlockRenderer";
import type { ChatBlock } from "@shared/contract";

describe("BlockRenderer", () => {
  it("renders a text block as sanitized HTML", () => {
    const blocks: ChatBlock[] = [{ type: "text", markdown: "**bold** and <script>alert(1)</script>" }];
    const { container } = render(<BlockRenderer blocks={blocks} />);
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelector("script")).toBeNull();
  });

  it("renders a callout block", () => {
    const blocks: ChatBlock[] = [{ type: "callout", variant: "warning", title: "Careful", markdown: "This is a warning." }];
    const { getByText } = render(<BlockRenderer blocks={blocks} />);
    expect(getByText("Careful")).toBeTruthy();
    expect(getByText("This is a warning.")).toBeTruthy();
  });

  it("renders a table block", () => {
    const blocks: ChatBlock[] = [
      {
        type: "table",
        columns: [
          { key: "a", header: "A" },
          { key: "b", header: "B" },
        ],
        rows: [{ a: "1", b: "2" }],
      },
    ];
    const { getByText } = render(<BlockRenderer blocks={blocks} />);
    expect(getByText("A")).toBeTruthy();
    expect(getByText("1")).toBeTruthy();
  });

  it("renders a math block", () => {
    const blocks: ChatBlock[] = [{ type: "math", latex: "E = mc^2", displayMode: true }];
    const { container } = render(<BlockRenderer blocks={blocks} />);
    expect(container.querySelector(".katex")).toBeTruthy();
  });

  it("renders a source reference block", () => {
    const blocks: ChatBlock[] = [
      { type: "source_reference", ref: { title: "CLRS", url: "https://example.com", note: "Textbook" } },
    ];
    const { getByText } = render(<BlockRenderer blocks={blocks} />);
    expect(getByText("CLRS")).toBeTruthy();
  });
});
