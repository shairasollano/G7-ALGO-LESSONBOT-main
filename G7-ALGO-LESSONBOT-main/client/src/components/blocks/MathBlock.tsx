import katex from "katex";
import { useMemo } from "react";
import "katex/dist/katex.min.css";

interface MathBlockProps {
  latex: string;
  displayMode?: boolean;
}

export function MathBlock({ latex, displayMode = true }: MathBlockProps) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(latex, {
        displayMode,
        throwOnError: false,
        strict: false,
      });
    } catch {
      return null;
    }
  }, [latex, displayMode]);

  if (!html) {
    return (
      <div className="block math-block math-error" role="alert">
        Could not render formula: <code>{latex}</code>
      </div>
    );
  }
  return (
    <div
      className={`block math-block ${displayMode ? "math-display" : "math-inline"}`}
      // KaTeX output is generated from a validated latex string; katex.renderToString
      // escapes HTML by default, so this is safe.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
