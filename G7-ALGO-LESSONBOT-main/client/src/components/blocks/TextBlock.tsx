import { useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";

// Markdown is rendered to sanitized HTML only. Raw HTML in model output is
// stripped by the server; this is the second line of defense. Table elements
// are allowed so streamed markdown tables survive sanitization.
marked.setOptions({ gfm: true, breaks: true });

export function TextBlock({ markdown }: { markdown: string }) {
  const html = useMemo(() => {
    const raw = marked.parse(markdown, { async: false }) as string;
    // A markdown table has no width limit of its own, so a wide one would
    // stretch the message column — and with it the whole page — sideways.
    // Wrapping each table in the shared scroll container (the same class the
    // structured table block uses) keeps the overflow inside the message.
    // The wrap is applied before sanitisation, so it is subject to the same
    // allow-list as everything else.
    const wrapped = raw
      .replace(/<table>/gi, '<div class="table-scroll"><table>')
      .replace(/<\/table>/gi, "</table></div>");
    return DOMPurify.sanitize(wrapped, {
      ALLOWED_TAGS: [
        "p", "strong", "em", "ul", "ol", "li", "code", "pre", "br", "div",
        "h1", "h2", "h3", "h4", "blockquote", "a", "table", "thead", "tbody",
        "tr", "th", "td",
      ],
      ALLOWED_ATTR: ["href", "target", "rel", "class"],
    });
  }, [markdown]);
  return <div className="block text-block" dangerouslySetInnerHTML={{ __html: html }} />;
}
