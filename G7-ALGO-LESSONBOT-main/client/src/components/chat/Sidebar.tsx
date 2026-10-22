/**
 * Navigation sidebar. A fixed panel on wide screens; a slide-over drawer with
 * a scrim on narrow screens.
 *
 * The topic catalog is a SECONDARY section here — it is never a prerequisite
 * for asking a question. Recent conversations (browser-local, capped) get the
 * prominent position, plus new-chat, level, provider status, and privacy.
 */
import { useEffect, useRef, useState } from "react";
import type { LearningLevel, TopicSummary } from "@shared/contract";
import type { ProviderStatus } from "../../App";
import { Link } from "../../lib/router";
import type { StoredConversation } from "../../lib/conversations";
import { STORAGE_NOTICE } from "../../lib/conversations";
import algotutorRobot from "../../assets/algotutor-robot.png";
import algotutorWordmark from "../../assets/algotutor-wordmark.png";
import {
  IconCheck,
  IconClose,
  IconEdit,
  IconGraph,
  IconHistory,
  IconPlus,
  IconQuiz,
  IconShield,
  IconTrash,
} from "../icons";

/** Human-readable name for whatever the health endpoint reports. */
export function providerLabel(provider: ProviderStatus): string {
  if (!provider.enabled) return "Curated lessons";
  const name = provider.provider.trim();
  return name ? `${name.charAt(0).toUpperCase()}${name.slice(1)}` : "AI provider";
}

/**
 * Status sentence for the provider badge. The name comes from the health
 * endpoint, not from a hardcoded vendor — the badge has to describe whatever
 * the server is actually running.
 */
export function providerDescription(provider: ProviderStatus): string {
  if (!provider.enabled) return "AI provider is off. Curated offline lessons answer every question.";
  return `${providerLabel(provider)} is answering this conversation.`;
}

interface SidebarProps {
  topics: TopicSummary[];
  topicId: string;
  onTopicChange: (id: string) => void;
  level: LearningLevel;
  onLevelChange: (level: LearningLevel) => void;
  onNewChat: () => void;
  /** Opens the quiz setup view. Separate from new-chat so both stay reachable. */
  onCreateQuiz: () => void;
  onShowPrivacy: () => void;
  provider: ProviderStatus;
  open: boolean;
  onClose: () => void;
  conversations: StoredConversation[];
  activeConversationId: string | null;
  onOpenConversation: (id: string) => void;
  onRenameConversation: (id: string, title: string) => void;
  onDeleteConversation: (id: string) => void;
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

export function Sidebar({
  topics,
  topicId,
  onTopicChange,
  level,
  onLevelChange,
  onNewChat,
  onCreateQuiz,
  onShowPrivacy,
  provider,
  open,
  onClose,
  conversations,
  activeConversationId,
  onOpenConversation,
  onRenameConversation,
  onDeleteConversation,
}: SidebarProps) {
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  /** A delete has to be confirmed in the row before anything is removed. */
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const activeTopicIndex = Math.max(0, topics.findIndex((topic) => topic.slug === topicId));

  // Move focus into the drawer when it opens (keyboard/mobile accessibility).
  useEffect(() => {
    if (open) closeBtnRef.current?.focus();
  }, [open]);

  // Escape closes the drawer — unless an inline rename or delete confirmation
  // is open, in which case it cancels that first, which is what the user means.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (renamingId) {
        setRenamingId(null);
        return;
      }
      if (confirmingId) {
        setConfirmingId(null);
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, renamingId, confirmingId]);

  const startRename = (conv: StoredConversation) => {
    setConfirmingId(null);
    setRenamingId(conv.id);
    setRenameValue(conv.title);
  };

  const commitRename = () => {
    if (renamingId) onRenameConversation(renamingId, renameValue);
    setRenamingId(null);
  };

  return (
    <>
      {open && <div className="drawer-scrim" onClick={onClose} aria-hidden="true" />}
      <aside className={`sidebar ${open ? "sidebar-open" : ""}`} aria-label="Conversation navigation">
        <div className="sidebar-head">
          <Link to="/" className="sidebar-brand" aria-label="AlgoTutor AI — back to the landing page">
            <img className="sidebar-brand-robot" src={algotutorRobot} alt="" aria-hidden="true" />
            <img className="sidebar-brand-wordmark" src={algotutorWordmark} alt="" aria-hidden="true" />
            <span className="sidebar-brand-ai">AI</span>
          </Link>
          <button
            ref={closeBtnRef}
            type="button"
            className="btn btn-icon sidebar-close"
            onClick={onClose}
            aria-label="Close navigation"
          >
            <IconClose />
          </button>
        </div>

        <button
          type="button"
          className="btn btn-primary sidebar-newchat"
          onClick={() => {
            setRenamingId(null);
            setConfirmingId(null);
            onNewChat();
          }}
          title="Start a new conversation"
        >
          <IconPlus />
          New chat
        </button>

        <button
          type="button"
          className="btn btn-secondary sidebar-quiz"
          onClick={() => {
            setRenamingId(null);
            setConfirmingId(null);
            onCreateQuiz();
          }}
          title="Create a mixed-topic quiz"
        >
          <IconQuiz />
          Create quiz
        </button>

        <div className="sidebar-navigation">
          <details
  className="sidebar-topics-section"
  aria-label="Course topics"
  open
>
            <summary className="sidebar-topics-summary">
  <span
    className="sidebar-topics-chevron"
    aria-hidden="true"
  >
    ⌄
  </span>

  <span className="sidebar-topics-heading">
    Course topics
  </span>

  <span className="sidebar-topic-count">
    {topics.length > 0
      ? `${activeTopicIndex + 1} of ${topics.length}`
      : "—"}
  </span>
</summary>
            <div className="sidebar-topic-list">
              {topics.map((topic, index) => {
                const active = topic.slug === topicId;
                return (
                  <button
                    key={topic.slug}
                    type="button"
                    className={`sidebar-topic ${active ? "sidebar-topic-active" : ""}`}
                    aria-current={active ? "true" : undefined}
                    onClick={() => {
                      onTopicChange(topic.slug);
                      onClose();
                    }}
                    title={topic.description}
                  >
                    <span className="sidebar-topic-marker" aria-hidden="true">
                      <span />
                    </span>
                    <span className="sidebar-topic-copy">
                      <span className="sidebar-topic-title">{topic.title}</span>
                      {active && topic.description && (
                        <span className="sidebar-topic-description">{topic.description}</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </details>

          <nav className="sidebar-recents" aria-label="Recent chats">
            <p className="sidebar-label sidebar-label-with-icon">
              <IconHistory />
              Recent chats
            </p>
            {conversations.length === 0 ? (
              <p className="sidebar-empty">No recent conversations yet.</p>
            ) : (
              <ul className="recents-list">
                {conversations.map((conv) => {
                  const active = conv.id === activeConversationId;
                  return (
                    <li
                      key={conv.id}
                      className={`recents-item ${active ? "recents-item-active" : ""}`}
                      aria-current={active ? "true" : undefined}
                    >
                      {renamingId === conv.id ? (
                        <form
                          className="recents-rename"
                          onSubmit={(e) => {
                            e.preventDefault();
                            commitRename();
                          }}
                        >
                          <input
                            autoFocus
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onBlur={commitRename}
                            aria-label="Rename conversation"
                            maxLength={120}
                          />
                          <button
                            type="submit"
                            className="btn-icon-mini"
                            aria-label={`Save the new name for "${conv.title}"`}
                            title="Save name"
                          >
                            <IconCheck />
                          </button>
                        </form>
                      ) : confirmingId === conv.id ? (
                        /* Deleting is destructive and browser-local storage has no
                           undo, so the row has to be confirmed where the click
                           landed rather than firing immediately. */
                        <div className="recents-confirm" role="group" aria-label={`Delete "${conv.title}"?`}>
                          <span className="recents-confirm-text">Delete this conversation?</span>
                          <span className="recents-actions">
                            <button
                              type="button"
                              className="btn-icon-mini btn-icon-mini-danger"
                              onClick={() => {
                                setConfirmingId(null);
                                onDeleteConversation(conv.id);
                              }}
                              aria-label={`Confirm delete "${conv.title}"`}
                            >
                              <IconTrash />
                            </button>
                            <button
                              type="button"
                              className="btn-icon-mini"
                              onClick={() => setConfirmingId(null)}
                              aria-label={`Cancel deleting "${conv.title}"`}
                            >
                              <IconClose />
                            </button>
                          </span>
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="recents-open"
                            onClick={() => onOpenConversation(conv.id)}
                            title={conv.title}
                          >
                            <span className="recents-title">{conv.title}</span>
                            <span className="recents-meta">
                              {relativeTime(conv.updatedAt)} · {conv.messages.length} msg
                            </span>
                          </button>
                          <span className="recents-actions">
                            <button
                              type="button"
                              className="btn-icon-mini"
                              onClick={() => startRename(conv)}
                              aria-label={`Rename "${conv.title}"`}
                              title="Rename"
                            >
                              <IconEdit />
                            </button>
                            <button
                              type="button"
                              className="btn-icon-mini"
                              onClick={() => {
                                setRenamingId(null);
                                setConfirmingId(conv.id);
                              }}
                              aria-label={`Delete "${conv.title}"`}
                              title="Delete"
                            >
                              <IconTrash />
                            </button>
                          </span>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="sidebar-note">{STORAGE_NOTICE}</p>
          </nav>
        </div>

        <div className="sidebar-footer sidebar-footer-privacy">
  <button
    type="button"
    className="linklike privacy-link"
    onClick={onShowPrivacy}
  >
    <IconShield />
    <span>Privacy</span>
  </button>
</div>
      </aside>
    </>
  );
}
