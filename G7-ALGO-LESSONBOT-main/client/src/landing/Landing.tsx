/**
 * G7 Algo landing page.
 *
 * Public entry point for the app. It introduces the product, demonstrates real
 * solver output, and routes visitors into the existing chat — it does not
 * re-implement any of it. The topic catalog comes from the same `/api/topics`
 * endpoint the chat sidebar uses, the interactive demo renders the chat's own
 * trace block, and every topic action is a real link into `/chat` carrying a
 * seed question.
 *
 * Animation, colour and layout rules live in landing.css; the scene data lives
 * in shared/landing-scenes.ts (generated from real solver runs).
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { TopicDetail, TopicSummary } from "@shared/contract";
import { landingDemos, TOPIC_PROMPTS } from "@shared/landing-scenes";
import { api } from "../api/client";
import { TraceBlock } from "../components/blocks/TraceBlock";
import { chatHref, Link } from "../lib/router";
import { AlgoScene } from "./AlgoScene";
import { HeroBackdrop, useHeroExample } from "./HeroExample";
import {
  IconArrowDown,
  IconArrowRight,
  IconChat,
  IconClose,
  IconMenu,
  IconRestart,
} from "./icons";
import { MainBackdrop } from "./MainBackdrop";
import { SceneThumb, sceneForTopic } from "./SceneThumb";
import { TabStrip, tabIds } from "./TabStrip";
import {
  CAPABILITIES,
  CLOSING,
  FEATURED_TOPIC_SLUGS,
  FOOTER_LINKS,
  HOW_IT_WORKS,
  SECTION_IDS,
} from "./landing-copy";
import { usePrefersReducedMotion } from "./use-motion";
import "./landing.css";
import algotutorRobot from "../assets/algotutor-robot.png";
import algotutorWordmark from "../assets/algotutor-wordmark.png";

type CatalogStatus = "loading" | "ready" | "error";

/**
 * Load the real topic catalog, then enrich each entry with its detail record
 * (used for the topic's own starting question and its visualization caption).
 * Detail failures degrade to the summary rather than hiding the topic.
 */
function useTopicCatalog() {
  const [topics, setTopics] = useState<TopicSummary[]>([]);
  const [details, setDetails] = useState<Record<string, TopicDetail>>({});
  const [status, setStatus] = useState<CatalogStatus>("loading");

  const load = useCallback(() => {
    let cancelled = false;
    setStatus("loading");
    api
      .topics()
      .then(async (response) => {
        if (cancelled) return;
        setTopics(response.topics);
        setStatus("ready");
        const settled = await Promise.allSettled(
          response.topics.map((topic) => api.topic(topic.slug)),
        );
        if (cancelled) return;
        const next: Record<string, TopicDetail> = {};
        settled.forEach((result, index) => {
          if (result.status === "fulfilled")
            next[response.topics[index].slug] = result.value.topic;
        });
        setDetails(next);
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => load(), [load]);

  return { topics, details, status, reload: load };
}

/**
 * Which of the nav's sections is currently in view, for `aria-current` state.
 *
 * The observation band is a thin slice of the viewport, but a fast scroll can
 * still report two sections at once — taking whichever entry arrived last made
 * the highlight bounce across the boundary. Every intersecting section is
 * therefore tracked and the topmost one (the one nearest the top of the band)
 * wins, so exactly one item is ever current. The previous choice is kept when
 * nothing at all intersects (the gap between sections), rather than flickering
 * to nothing for a frame.
 *
 * Guarded twice: no IntersectionObserver (older webviews, jsdom) means no
 * active state at all, which is the browser default anyway.
 */
function useActiveSection(): string | null {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    if (typeof IntersectionObserver !== "function") return;
    const ids = Object.values(SECTION_IDS);
    const sections = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0) return;

    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        if (visible.size === 0) return;

        let current: HTMLElement | null = null;
        for (const section of sections) {
          if (visible.has(section.id)) {
            current = section;
            break; // `sections` is document order, so the first is topmost.
          }
        }
        if (current) setActive(current.id);
      },
      { rootMargin: "-30% 0px -55% 0px", threshold: 0 },
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  return active;
}

/**
 * Section entrance transitions. Content is only ever *marked* pending by this
 * hook (never hidden by default), and a fallback timer reveals everything even
 * if the observer never fires — content can not become inaccessible because an
 * animation did not run. Reduced motion and environments without an observer
 * skip the whole mechanism.
 */
function useSectionReveal(reducedMotion: boolean) {
  useEffect(() => {
    if (reducedMotion || typeof IntersectionObserver !== "function") return;
    const targets = [
      ...document.querySelectorAll<HTMLElement>(".lp-rail, .lp-section"),
    ];
    if (targets.length === 0) return;

    targets.forEach((el) => el.setAttribute("data-reveal", "pending"));
    const reveal = (el: HTMLElement) => el.setAttribute("data-reveal", "shown");

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          reveal(entry.target as HTMLElement);
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.04 },
    );
    targets.forEach((el) => observer.observe(el));

    // Belt and braces: whatever happens to the observer, nothing stays
    // pending for longer than this.
    const fallback = window.setTimeout(() => targets.forEach(reveal), 2500);

    return () => {
      observer.disconnect();
      window.clearTimeout(fallback);
      targets.forEach((el) => {
        if (el.getAttribute("data-reveal") === "pending") reveal(el);
      });
    };
  }, [reducedMotion]);
}

/** Brand mark + wordmark, shared by the nav and the footer. */
function Brand({ onActivate }: { onActivate?: () => void }) {
  return (
    <a
      className="lp-brand"
      href="/"
      onClick={(event) => {
        event.preventDefault();
        onActivate?.();
        // Same-page "back to top": drop the fragment first, otherwise the URL
        // keeps claiming a section the page is no longer showing. replaceState
        // (rather than a second navigation) keeps Back/Forward honest. The
        // scroll behavior stays `auto`, which CSS resolves to smooth here and
        // to an immediate jump under prefers-reduced-motion.
        if (window.location.hash) {
          window.history.replaceState(
            null,
            "",
            window.location.pathname + window.location.search,
          );
        }
        window.scrollTo({ top: 0, behavior: "auto" });
      }}
    >
      <img
  className="lp-brand-robot"
  src={algotutorRobot}
  alt=""
  aria-hidden="true"
/>

<img
  className="lp-brand-wordmark"
  src={algotutorWordmark}
  alt="AlgoTutor"
/>
    </a>
  );
}

/** Compact navigation. Inline links on wide screens, a drawer below 900px. */
function Nav() {
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const activeSection = useActiveSection();

  const close = useCallback(() => {
    setOpen(false);
    toggleRef.current?.focus();
  }, []);

  // Focus into the drawer on open; Escape closes; page scroll is locked while
  // the drawer covers the viewport. Cleanup runs on unmount too, so navigating
  // to /chat from the drawer can never leave the body scroll-locked.
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, close]);

  const links = [
    { id: SECTION_IDS.topics, label: "Topics" },
    { id: SECTION_IDS.how, label: "How it works" },
    { id: SECTION_IDS.about, label: "What it does" },
  ];

  return (
    <>
      <header className="lp-nav">
        <div className="lp-nav-inner">
          <Brand />
          <nav className="lp-nav-links" aria-label="Sections">
            {links.map((link) => (
              <a
                key={link.id}
                href={`#${link.id}`}
                aria-current={activeSection === link.id ? "true" : undefined}
              >
                {link.label}
              </a>
            ))}
          </nav>
          <div className="lp-nav-actions">
            <Link className="lp-btn lp-btn-primary" to="/chat">
              <IconChat />
              Try the Chat
            </Link>
          </div>
          <button
            ref={toggleRef}
            type="button"
            className="lp-nav-toggle"
            aria-expanded={open}
            aria-controls="lp-nav-drawer"
            aria-label={open ? "Close navigation menu" : "Open navigation menu"}
            onClick={() => (open ? close() : setOpen(true))}
          >
            <span className="lp-burger" aria-hidden="true">
              <IconMenu />
            </span>
          </button>
        </div>
      </header>

      {open && <div className="lp-scrim" onClick={close} aria-hidden="true" />}
      <div
        id="lp-nav-drawer"
        className="lp-drawer"
        data-open={open ? "true" : "false"}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        aria-hidden={!open}
      >
        <div className="lp-drawer-head">
          <span className="lp-drawer-title">Menu</span>
          <button
            ref={closeRef}
            type="button"
            className="lp-icon-btn"
            onClick={close}
            aria-label="Close menu"
          >
            <IconClose />
          </button>
        </div>
        <nav className="lp-drawer-links" aria-label="Sections">
          {links.map((link) => (
            <a
              key={link.id}
              href={`#${link.id}`}
              onClick={close}
              aria-current={activeSection === link.id ? "true" : undefined}
            >
              {link.label}
            </a>
          ))}
        </nav>
        <Link
          className="lp-btn lp-btn-primary lp-btn-block"
          to="/chat"
          onClick={close}
        >
          <IconChat />
          Try the Chat
        </Link>
      </div>
    </>
  );
}

/**
 * Hero: concise introduction beside one focused, interactive algorithm scene.
 * The quiet animated backdrop stays decorative; the full step-by-step result
 * is presented inside AlgoScene, avoiding a second competing data table.
 */
function Hero() {
  const example = useHeroExample();

  return (
    <section className="lp-hero">
      <HeroBackdrop step={example.step} paused={example.paused} />
      <div className="lp-hero-inner">
        <div className="lp-hero-copy">
          <p className="lp-hero-eyebrow">A calmer way to learn algorithms</p>
          <h1 className="lp-hero-title">
            Understand algorithms. See why they work.
          </h1>
          <p className="lp-hero-lede">
            Explore reductions, complexity theory, approximation, and randomized
            algorithms through clear explanations and interactive, step-by-step examples.
          </p>
          <div className="lp-hero-actions">
            <Link className="lp-btn lp-btn-primary lp-btn-lg" to="/chat">
              <IconChat />
              Try the Chat
            </Link>
            <a
              className="lp-btn lp-btn-secondary lp-btn-lg"
              href={`#${SECTION_IDS.topics}`}
            >
              Explore the Topics
              <IconArrowDown />
            </a>
          </div>
          <p className="lp-hero-note">
            Interactive examples use the app’s own deterministic solvers, so
            computed results are not guessed by a language model.
          </p>
        </div>
        <div className="lp-hero-visual">
          <AlgoScene />
        </div>
      </div>
    </section>
  );
}

/** The curated subset near the hero; always a subset of the real catalog. */
function TopicRail({ topics }: { topics: TopicSummary[] }) {
  const featured = FEATURED_TOPIC_SLUGS.map((slug) =>
    topics.find((topic) => topic.slug === slug),
  ).filter((topic): topic is TopicSummary => Boolean(topic));
  if (featured.length === 0) return null;

  return (
    <section className="lp-rail" aria-labelledby="lp-rail-title">
      <h2 className="lp-rail-title" id="lp-rail-title">
        Start with one of these
      </h2>
      <ul className="lp-rail-list">
        {featured.map((topic) => (
          <li key={topic.slug}>
            <Link
              className="lp-chip"
              to={chatHref({
                ask: TOPIC_PROMPTS[topic.slug] ?? topic.title,
                topic: topic.slug,
              })}
            >
              {topic.title}
            </Link>
          </li>
        ))}
      </ul>
      <p className="lp-rail-note">
        Opens the chat with that question ready to send. You can also ask about
        anything else — no topic needs to be selected first.
      </p>
    </section>
  );
}

/**
 * Interactive demonstration: the chat's own trace component, driven by the
 * real solver output for a curated example. Prev/Next/Reset and the result
 * values all come from the solver; the graph changes with the step.
 */
function DemoSection() {
  const baseId = useId();
  const [index, setIndex] = useState(0);
  const demo = landingDemos[index];
  const panelIds = tabIds(baseId, demo.id);

  return (
    <section
      className="lp-section lp-demo"
      id="demo"
      aria-labelledby="lp-demo-title"
    >
      <div className="lp-section-head">
        <h2 id="lp-demo-title">See it work before you ask</h2>
        <p>
          This is the chat's own trace block, running the deterministic solver
          on a curated example. Step through it with Previous and Next: the
          graph, the explanation and the computed result all describe the same
          step.
        </p>
      </div>

      <TabStrip
        baseId={baseId}
        ariaLabel="Demonstration examples"
        activeIndex={index}
        onSelect={setIndex}
        tabs={landingDemos.map((entry) => ({
          id: entry.id,
          label: entry.label,
        }))}
      />

      <div
        className="lp-demo-panel"
        role="tabpanel"
        id={panelIds.panel}
        aria-labelledby={panelIds.tab}
      >
        <p className="lp-demo-caption">{demo.caption}</p>
        <div className="lp-demo-frame">
          <TraceBlock trace={demo.trace} />
        </div>
        <p className="lp-demo-note">
          Example: {demo.exampleTitle}. Solver: <code>{demo.solverId}</code>.
          Every value shown is computed by the app, and the guarantee and
          complexity lines are produced by the solver.
        </p>
      </div>
    </section>
  );
}

/** One topic card: catalog title and description, plus a starting question. */
function TopicCard({
  topic,
  detail,
}: {
  topic: TopicSummary;
  detail?: TopicDetail;
}) {
  const scene = sceneForTopic(topic.slug);
  const question = detail?.readinessQuestions?.[0];
  const prompt = TOPIC_PROMPTS[topic.slug] ?? topic.title;

  return (
    <li className="lp-topic-card">
      <div className="lp-topic-figure">
        {scene ? (
          <SceneThumb scene={scene} />
        ) : (
          <p className="lp-topic-nofigure">
            {detail?.visualization?.description ??
              "A written lesson with a worked example."}
          </p>
        )}
        {detail?.visualization?.description && scene && (
          <p className="lp-topic-figcaption">
            {detail.visualization.description}
          </p>
        )}
      </div>
      <div className="lp-topic-body">
        <h3 className="lp-topic-title">{topic.title}</h3>
        <p className="lp-topic-desc">{topic.description}</p>
        {question && (
          <p className="lp-topic-question">
            <span className="lp-topic-question-label">
              Question to start with:
            </span>{" "}
            {question}
          </p>
        )}
        <Link
          className="lp-btn lp-btn-secondary lp-topic-action"
          to={chatHref({ ask: prompt, topic: topic.slug })}
        >
          Ask about this
          <IconArrowRight />
        </Link>
      </div>
    </li>
  );
}

/** Section E — every supported topic, straight from the app's catalog. */
function TopicGrid({
  topics,
  details,
  status,
  onRetry,
}: {
  topics: TopicSummary[];
  details: Record<string, TopicDetail>;
  status: CatalogStatus;
  onRetry: () => void;
}) {
  return (
    <section
      className="lp-section lp-topics"
      id={SECTION_IDS.topics}
      aria-labelledby="lp-topics-title"
      tabIndex={-1}
    >
      <div className="lp-section-head">
        <h2 id="lp-topics-title">Every supported topic</h2>
        <p>
          {status === "ready"
            ? `All ${topics.length} topics in the app's own catalog, in catalog order. Each one opens the chat with a question ready to send.`
            : "The app's topic catalog, read from the server rather than retyped here."}
        </p>
      </div>

      {status === "loading" && (
        <p className="lp-status" role="status">
          Loading the topic catalog…
        </p>
      )}

      {status === "error" && (
        <div className="lp-status lp-status-error" role="status">
          <p>
            The topic catalog could not be loaded, so it is not shown rather
            than guessed at. The chat itself is unaffected — you can ask about
            any topic directly.
          </p>
          <div className="lp-status-actions">
            <button
              type="button"
              className="lp-btn lp-btn-secondary"
              onClick={onRetry}
            >
              <IconRestart />
              Retry
            </button>
            <Link className="lp-btn lp-btn-primary" to="/chat">
              <IconChat />
              Open the chat
            </Link>
          </div>
        </div>
      )}

      {status === "ready" && topics.length === 0 && (
        <p className="lp-status" role="status">
          The catalog returned no topics. Ask a question in the chat instead —
          topic selection is optional.
        </p>
      )}

      {topics.length > 0 && (
        <ul className="lp-topic-grid">
          {topics.map((topic) => (
            <TopicCard
              key={topic.slug}
              topic={topic}
              detail={details[topic.slug]}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/** Section F — the learning loop, and who computes what. */
function HowItWorks() {
  return (
    <section
      className="lp-section lp-how"
      id={SECTION_IDS.how}
      aria-labelledby="lp-how-title"
      tabIndex={-1}
    >
      <div className="lp-section-head">
        <h2 id="lp-how-title">How a session works</h2>
        <p>Four stages, in the order they actually happen.</p>
      </div>
      <ol className="lp-stages">
        {HOW_IT_WORKS.map((stage, index) => (
          <li key={stage.title} className="lp-stage">
            <span className="lp-stage-number" aria-hidden="true">
              {index + 1}
            </span>
            <div>
              <h3 className="lp-stage-title">{stage.title}</h3>
              <p className="lp-stage-body">{stage.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="lp-how-note">
        <span>
          Every computed value in this app — traces, graph states, tableau
          counts, quiz answer keys — is produced by deterministic solver code.
        </span>
        <span>
          When an AI provider is configured it writes the explanation around
          that computed result; when none is configured, curated offline lessons
          answer instead. Either way the reply is labelled with how it was
          produced, and the model is never presented as having verified a
          computation.
        </span>
      </p>
    </section>
  );
}

/** "What it does" — real capabilities, read off the repository. */
function About() {
  return (
    <section
      className="lp-section lp-about"
      id={SECTION_IDS.about}
      aria-labelledby="lp-about-title"
      tabIndex={-1}
    >
      <div className="lp-section-head">
        <h2 id="lp-about-title">What it does</h2>
        <p>
          Capabilities that exist in the app today — nothing here is on a
          roadmap.
        </p>
      </div>
      <dl className="lp-capabilities">
        {CAPABILITIES.map((capability) => (
          <div key={capability.title} className="lp-capability">
            <dt>{capability.title}</dt>
            <dd>{capability.body}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Section G — closing call to action. */
function Closing() {
  return (
    <section
      className="lp-section lp-closing"
      aria-labelledby="lp-closing-title"
    >
      <h2 id="lp-closing-title">{CLOSING.headline}</h2>
      <p className="lp-closing-lede">{CLOSING.supporting}</p>
      <div className="lp-closing-actions">
        <Link className="lp-btn lp-btn-primary lp-btn-lg" to="/chat">
          <IconChat />
          Try the Chat
        </Link>
        <a
          className="lp-btn lp-btn-secondary lp-btn-lg"
          href={`#${SECTION_IDS.topics}`}
        >
          Explore the Topics
          <IconArrowDown />
        </a>
      </div>
    </section>
  );
}

/** Section H — footer. Identity, a few real links, and the storage note. */
function Footer() {
  return (
    <footer className="lp-footer">
      <div className="lp-footer-inner">
        <div className="lp-footer-brand">
          <Brand />
          <p className="lp-footer-note">
            An algorithms and complexity tutor for college-level study:
            reductions, NP-completeness, approximation and randomized
            algorithms.
          </p>
        </div>
        <nav className="lp-footer-links" aria-label="Footer">
          {FOOTER_LINKS.map((entry) =>
            entry.href.startsWith("#") ? (
              <a key={entry.label} href={entry.href}>
                {entry.label}
              </a>
            ) : (
              <Link key={entry.label} to={entry.href}>
                {entry.label}
              </Link>
            ),
          )}
        </nav>
      </div>
      <p className="lp-footer-legal">
        Conversations are stored in this browser only — nothing is uploaded or
        synced. No accounts, no subscription, no payment.
      </p>
    </footer>
  );
}

export function Landing() {
  const { topics, details, status, reload } = useTopicCatalog();
  const reducedMotion = usePrefersReducedMotion();
  useSectionReveal(reducedMotion);

  return (
    <div className="lp">
      <a className="lp-skip" href="#lp-main">
        Skip to content
      </a>
      <Nav />
      <main id="lp-main" tabIndex={-1}>
        {/* Decorative computational canvas filling the side gutters; first in
            main so it paints behind the sections, which sit above it in
            z-order. Inert: aria-hidden, pointer-events none, out of flow. */}
        <MainBackdrop />
        <Hero />
        <TopicRail topics={topics} />
        <DemoSection />
        <TopicGrid
          topics={topics}
          details={details}
          status={status}
          onRetry={reload}
        />
        <HowItWorks />
        <About />
        <Closing />
      </main>
      <Footer />
    </div>
  );
}

export default Landing;
