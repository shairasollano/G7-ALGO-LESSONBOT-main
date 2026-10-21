/**
 * Compact top bar. Shows on small screens (with a menu button that opens the
 * sidebar drawer) and as a slim context bar on desktop.
 *
 * The provider badge reports whatever the health endpoint says the server is
 * running — it is a status indicator, so a hardcoded vendor name would be a
 * lie the moment the provider changes.
 */
import type { RefObject } from "react";
import type { LearningLevel, TopicSummary } from "@shared/contract";
import type { ProviderStatus } from "../../App";
import { Link } from "../../lib/router";
import { IconMenu } from "../icons";
import { providerLabel } from "./Sidebar";
import algotutorRobot from "../../assets/AlgoTutor-robot.png";

interface HeaderProps {
  topics: TopicSummary[];
  topicId: string;
  level: LearningLevel;
  provider: ProviderStatus;
  onOpenDrawer: () => void;
  streaming: boolean;
  /** Title of the active (or restored) conversation, when one exists. */
  conversationTitle?: string | null;
  /** Focus target when the drawer closes (App owns the ref). */
  triggerRef?: RefObject<HTMLButtonElement>;
}

export function Header({
  topics,
  topicId,
  level,
  provider,
  onOpenDrawer,
  triggerRef,
  streaming,
  conversationTitle,
}: HeaderProps) {
  const topic = topics.find((t) => t.slug === topicId);
  const title = conversationTitle ?? (topic ? topic.title : "G7 Algo");
  return (
    <header className="header">
      <Link
        to="/"
        className="btn btn-icon header-home"
        aria-label="AlgoTutor AI — back to the landing page"
      >
        <img className="header-home-logo" src={algotutorRobot} alt="" />
      </Link>
      <button
        ref={triggerRef}
        type="button"
        className="btn btn-icon header-menu"
        onClick={onOpenDrawer}
        aria-label="Open navigation menu"
        aria-haspopup="true"
      >
        <IconMenu size={20} />
      </button>
      <div className="header-context">
        <span className="header-topic" title={title}>
          {title}
        </span>
        <span className="header-meta">
          <span
            className={`provider-badge ${provider.enabled ? "provider-ai" : "provider-curated"}`}
            title={
              provider.enabled
                ? `${providerLabel(provider)} is answering this conversation.`
                : "AI provider is off. Curated offline lessons answer every question."
            }
          >
            <span className="provider-dot" aria-hidden="true" />
            {provider.enabled ? providerLabel(provider) : "Curated"}
          </span>
          {streaming && (
            <span className="streaming-dot" aria-label="Generating response" />
          )}
          <span className="header-level" title={`Teaching level: ${level}`}>
            {level === "beginner"
              ? "Beginner"
              : level === "intermediate"
                ? "Intermediate"
                : "Formal"}
          </span>
        </span>
      </div>
    </header>
  );
}
