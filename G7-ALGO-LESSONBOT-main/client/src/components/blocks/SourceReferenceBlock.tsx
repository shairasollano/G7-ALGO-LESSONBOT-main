import type { SourceReference } from "@shared/contract";

interface SourceReferenceBlockProps {
  source: SourceReference;
}

export function SourceReferenceBlock({ source }: SourceReferenceBlockProps) {
  return (
    <div className="block source-ref">
      <span className="source-ref-label">Source</span>
      {source.url ? (
        <a href={source.url} target="_blank" rel="noopener noreferrer" className="source-ref-link">
          {source.title}
        </a>
      ) : (
        <span className="source-ref-title">{source.title}</span>
      )}
      {source.note && <span className="source-ref-note">{source.note}</span>}
    </div>
  );
}
