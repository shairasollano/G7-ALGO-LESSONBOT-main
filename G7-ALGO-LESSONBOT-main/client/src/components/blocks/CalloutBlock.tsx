import type { CalloutVariant } from "@shared/contract";
import { TextBlock } from "./TextBlock";

interface CalloutBlockProps {
  variant: CalloutVariant;
  title?: string;
  markdown: string;
}

const VARIANT_LABELS: Record<CalloutVariant, string> = {
  info: "Note",
  warning: "Watch out",
  success: "Key point",
};

export function CalloutBlock({ variant, title, markdown }: CalloutBlockProps) {
  return (
    <div className={`block callout callout-${variant}`} role="note">
      <div className="callout-header">
        <span className="callout-icon" aria-hidden="true">
          {variant === "info" ? "ℹ" : variant === "warning" ? "⚠" : "✓"}
        </span>
        <span className="callout-title">{title ?? VARIANT_LABELS[variant]}</span>
      </div>
      <TextBlock markdown={markdown} />
    </div>
  );
}
