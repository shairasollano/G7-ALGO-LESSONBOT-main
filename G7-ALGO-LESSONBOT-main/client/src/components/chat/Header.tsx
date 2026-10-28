/**
 * Desktop topic context bar and compact mobile navigation header.
 * Topic selection stays in the sidebar; learning level is available here on
 * desktop and in the sidebar drawer on narrow screens.
 */
import type { RefObject } from "react";
import type { LearningLevel, TopicSummary } from "@shared/contract";
import { LEARNING_LEVELS } from "@shared/contract";
import { Link } from "../../lib/router";
import { IconGraph, IconMenu } from "../icons";
import algotutorRobot from "../../assets/AlgoTutor-robot.png";

interface HeaderProps {
  topics: TopicSummary[];
  topicId: string;
  level: LearningLevel;
  onLevelChange: (level: LearningLevel) => void;
  onOpenDrawer: () => void;
  streaming: boolean;
  conversationTitle?: string | null;
  triggerRef?: RefObject<HTMLButtonElement>;
}

const LEVEL_LABELS: Record<LearningLevel, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  formal: "Formal",
};

export function Header({
  topics,
  topicId,
  level,
  onLevelChange,
  onOpenDrawer,
  triggerRef,
  streaming,
  conversationTitle,
}: HeaderProps) {
  const topicIndex = Math.max(0, topics.findIndex((item) => item.slug === topicId));
  const topic = topics.find((item) => item.slug === topicId);

  return (
    <header className="header">
      <Link to="/" className="header-home" aria-label="AlgoTutor AI — back to the landing page">
        <img src={algotutorRobot} alt="" aria-hidden="true" />
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
        <div className="header-topic-group">
          <span className="header-topic-icon" aria-hidden="true">
            <IconGraph size={18} />
          </span>
          <div className="header-topic-copy">
            <span className="header-topic" title={conversationTitle ?? topic?.title ?? "AlgoTutor AI"}>
              {topic?.title ?? "AlgoTutor AI"}
            </span>
            <span className="header-topic-count">
              {topics.length > 0 ? `Topic ${topicIndex + 1} of ${topics.length}` : "Course topics"}
            </span>
          </div>
          {streaming && <span className="streaming-dot" aria-label="Generating response" />}
        </div>

        <div className="header-level-controls">
          <span className="header-level-label">Explanation level</span>
          <div className="segmented header-segmented" role="radiogroup" aria-label="Explanation level">
            {LEARNING_LEVELS.map((item) => (
              <button
                key={item}
                type="button"
                role="radio"
                aria-checked={level === item}
                className={`segment ${level === item ? "segment-active" : ""}`}
                onClick={() => onLevelChange(item)}
              >
                {LEVEL_LABELS[item]}
              </button>
            ))}
          </div>
        </div>
      </div>
    </header>
  );
}
