/**
 * Message list. User messages render as compact right-aligned pills;
 * assistant replies render as a full-width column (typography-led, no bubble).
 *
 * Follow-up action chips come from the server's done event: the producing
 * provider decides which actions it can honor next (brief §5). Chips are
 * disabled while a request runs to prevent duplicate clicks — but never
 * permanently: an unavailable action is genuinely hidden by the server
 * (e.g. "another example" once every curated example for the topic has been
 * shown), which the brief requires instead of repeating the same content.
 */
import { useState, type ReactElement } from "react";
import type { Message } from "../../App";
import { BlockRenderer } from "../blocks/BlockRenderer";
import { TextBlock } from "../blocks/TextBlock";
import { TUTOR_ACTIONS } from "@shared/contract";
import {
  IconCheck,
  IconCompare,
  IconCopy,
  IconLayers,
  IconLightbulb,
  IconProof,
  IconQuiz,
  IconRestart,
} from "../icons";
import algotutorRobot from "../../assets/AlgoTutor-robot.png";

interface ChatThreadProps {
  messages: Message[];
  streamingActive: boolean;
  onAction: (action: string) => void;
  onRegenerate: () => void;
}

/** Server-declared actions -> ordered chips from the shared contract. */
const ACTION_ORDER: (keyof typeof TUTOR_ACTIONS)[] = [
  "explain_simpler",
  "formal_proof",
  "another_example",
  "compare",
  "quiz",
];

/**
 * One icon per follow-up action, drawn in the app's shared icon family so the
 * action row reads as one set. Always `aria-hidden`: the chip's text label is
 * the accessible name.
 */
const ACTION_ICONS: Record<string, (props: { size?: number }) => ReactElement> =
  {
    explain_simpler: IconLightbulb,
    formal_proof: IconProof,
    another_example: IconLayers,
    compare: IconCompare,
    quiz: IconQuiz,
  };

function ModeLabel({ mode }: { mode: Message["mode"] }) {
  if (!mode) return null;
  return (
    <span
      className={`mode-badge ${mode === "ai" ? "mode-ai" : "mode-curated"}`}
    >
      {mode === "ai" ? "AI-generated" : "Curated lesson (offline)"}
    </span>
  );
}

function AssistantActions({
  actions,
  onAction,
  onRegenerate,
  getFullText,
  disabled,
}: {
  actions: string[] | undefined;
  onAction: (action: string) => void;
  onRegenerate: () => void;
  getFullText: () => string;
  disabled: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(getFullText());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  };
  const available = (actions ?? []).filter(
    (a): a is keyof typeof TUTOR_ACTIONS =>
      (ACTION_ORDER as string[]).includes(a),
  );
  return (
    <div
      className="response-actions"
      role="group"
      aria-label="Response actions"
    >
      {/* Copy/Regenerate are always relevant, so they are always present; the
          server-declared actions appear only when the producer says it can
          honour them, and are disabled while a request is already running. */}
      <button
        type="button"
        className={`chip action-chip ${copied ? "action-chip-done" : ""}`}
        onClick={() => void copy()}
        disabled={disabled}
        title={copied ? "Copied to the clipboard" : "Copy this response"}
      >
        {copied ? <IconCheck size={15} /> : <IconCopy size={15} />}
        {copied ? "Copied" : "Copy"}
      </button>
      <button
        type="button"
        className="chip action-chip"
        onClick={onRegenerate}
        disabled={disabled}
        title="Ask again with the same question and context"
      >
        <IconRestart size={15} />
        Regenerate
      </button>
      {available.map((id) => {
        const def = TUTOR_ACTIONS[id];
        if (!def) return null;
        const Icon = ACTION_ICONS[id];
        return (
          <button
            key={id}
            type="button"
            className="chip action-chip"
            disabled={disabled}
            onClick={() => onAction(def.prompt)}
            title={def.prompt}
          >
            {Icon ? <Icon size={15} /> : null}
            {def.label}
          </button>
        );
      })}
    </div>
  );
}

function AssistantMessage({
  m,
  onAction,
  onRegenerate,
  isLast,
  streamingActive,
}: {
  m: Message;
  onAction: (action: string) => void;
  onRegenerate: () => void;
  isLast: boolean;
  streamingActive: boolean;
}) {
  const streamingEmpty = m.streaming && !m.text && !m.blocks?.length;

  const fullText = () =>
    [
      m.text ?? "",
      ...(m.blocks
        ?.map((b) => ("markdown" in b ? b.markdown : ""))
        .filter(Boolean) ?? []),
    ]
      .filter(Boolean)
      .join("\n\n");

  return (
    <div className="message message-assistant">
      <div className="message-avatar" aria-hidden="true">
        <img className="message-avatar-logo" src={algotutorRobot} alt="" />
      </div>
      <div className="message-content">
        {m.error ? (
          <div className="message-error" role="alert">
            <p>{m.error}</p>
            <button
              type="button"
              className="chip action-chip"
              onClick={onRegenerate}
              title="Send this question again"
            >
              <IconRestart size={15} />
              Retry
            </button>
          </div>
        ) : (
          <>
            {m.text ? (
              <div className="message-streamed">
                <TextBlock markdown={m.text} />
              </div>
            ) : null}
            {m.blocks && m.blocks.length > 0 && (
              <BlockRenderer blocks={m.blocks} />
            )}
            {streamingEmpty && (
              <div className="message-pending" role="status">
                <span className="spinner" aria-hidden="true" />
                <span>Generating…</span>
              </div>
            )}
          </>
        )}
        {m.stopped && (
          <p className="message-stopped" role="status">
            Generation stopped — showing the partial response.
          </p>
        )}
        {m.fallbackReason && (
          <p className="message-fallback-note" role="note">
            AI request failed: {m.fallbackReason}. Showing a curated lesson
            instead.
          </p>
        )}
        <div className="message-foot">
          <ModeLabel mode={m.mode} />
        </div>
        {!m.streaming && !streamingEmpty && !m.error && (
          <AssistantActions
            actions={m.actions}
            onAction={onAction}
            onRegenerate={onRegenerate}
            getFullText={fullText}
            // Actions stay available to fire while streaming, but cannot stack
            // a second request — brief §5: not permanently disabled.
            disabled={streamingActive && isLast}
          />
        )}
      </div>
    </div>
  );
}

function UserMessage({ m }: { m: Message }) {
  return (
    <div className="message message-user">
      <div className="message-pill">{m.text}</div>
    </div>
  );
}

export function ChatThread({
  messages,
  onAction,
  onRegenerate,
  streamingActive,
}: ChatThreadProps) {
  return (
    <div className="chat-thread" role="log" aria-label="Conversation">
      {messages.map((m, i) =>
        m.role === "user" ? (
          <UserMessage key={m.id} m={m} />
        ) : (
          <AssistantMessage
            key={m.id}
            m={m}
            onAction={onAction}
            onRegenerate={onRegenerate}
            isLast={i === messages.length - 1 && !m.streaming}
            streamingActive={streamingActive}
          />
        ),
      )}
    </div>
  );
}
