/**
 * AlgoTutor AI — conversation-first learning interface.
 *
 * The conversation is the primary interface: a welcome screen with capability
 * suggestions, then a centered chat. The topic catalog is secondary (drawer);
 * the server decides the effective topic from the message itself and the
 * client follows it. Recent conversations persist in browser-local storage —
 * no accounts, no database, nothing uploaded.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import type {
  AssessmentSubmitResponse,
  ChatBlock,
  LearningLevel,
  TopicSummary,
} from "@shared/contract";
import { TUTOR_ACTIONS } from "@shared/contract";
import { api, friendlyError, streamChat } from "./api/client";
import { ChatThread } from "./components/chat/ChatThread";
import { Composer } from "./components/chat/Composer";
import { Header } from "./components/chat/Header";
import { Sidebar } from "./components/chat/Sidebar";
import { PrivacyNotice } from "./components/chat/PrivacyNotice";
import { QuizSetup, type QuizSetupValue } from "./components/quiz/QuizSetup";
import { QuizView, type LoadedAssessment } from "./components/quiz/QuizView";
import {
  IconArrowDownToLine,
  IconCompare,
  IconGraph,
  IconLayers,
  IconLightbulb,
  IconProof,
  IconQuiz,
  type IconProps,
} from "./components/icons";
import {
  loadConversations,
  newConversationId,
  renameConversation,
  deleteConversation as deleteStoredConversation,
  titleFromMessage,
  upsertConversation,
  type StoredConversation,
} from "./lib/conversations";
import algotutorRobot from "./assets/AlgoTutor-robot.png";

export interface Message {
  id: string;
  role: "user" | "assistant";
  /** User text, or the streamed text of an assistant reply. */
  text?: string;
  blocks?: ChatBlock[];
  /** Producing mode — undefined until the server declares it. */
  mode?: "ai" | "curated_fallback";
  error?: string;
  /** Assistant message still receiving its response. */
  streaming?: boolean;
  /** Generation was stopped by the user before completion. */
  stopped?: boolean;
  /** Context that produced this message (for regenerate). */
  topicId?: string;
  level?: LearningLevel;
  /** Follow-up action ids the producer says it can honor next. */
  actions?: string[];
  /**
   * Present only when an enabled AI provider failed before its first text
   * delta and the curated fallback answered instead (from the SSE done event).
   */
  fallbackReason?: string;
}

export interface ProviderStatus {
  provider: string;
  enabled: boolean;
}

export interface AppProps {
  /**
   * Seed question carried by the route (`/chat?ask=...`) from a landing-page
   * topic action. Prefills the composer; it is never sent on the user's behalf.
   */
  prefill?: string | null;
  /** Topic slug carried by the route (`/chat?topic=...`). Ignored if unknown. */
  topicFromRoute?: string | null;
}

/**
 * Capability suggestions. Each one submits a REAL message; servers route it
 * from the message content itself — no topic pre-selection is implied. Six,
 * not sixty: enough to show the range of the product without turning the empty
 * state into a topic catalogue.
 */
const CAPABILITY_CHIPS: {
  label: string;
  prompt: string;
  hint: string;
  Icon: (p: IconProps) => ReactElement;
}[] = [
  {
    label: "Explain a concept",
    prompt: "Explain polynomial-time reductions to me as a beginner",
    hint: "Plain-language intro to reductions",
    Icon: IconLightbulb,
  },
  {
    label: "Prove a theorem",
    prompt: "Show me the formal proof of the Cook–Levin theorem",
    hint: "Formal statement and proof sketch",
    Icon: IconProof,
  },
  {
    label: "Run an algorithm",
    prompt: "Run a randomized Max-Cut demo",
    hint: "Verified step-by-step solver trace",
    Icon: IconGraph,
  },
  {
    label: "Visualize a graph",
    prompt: "Visualize a Vertex Cover example on a graph",
    hint: "Graph rendering of a worked instance",
    Icon: IconLayers,
  },
  {
    label: "Compare approaches",
    prompt: "Compare Vertex Cover approximation with randomized Max-Cut",
    hint: "Guarantees and trade-offs",
    Icon: IconCompare,
  },
  {
    label: "Generate a practice question",
    prompt: "Generate a practice question for me",
    hint: "Graded quiz from the validated bank",
    Icon: IconQuiz,
  },
];

let idCounter = 0;
function nextId() {
  return `m-${Date.now().toString(36)}-${idCounter++}`;
}

/** Compact, fact-bearing history line for structured blocks (Phase 7). */
function blockHistoryFacts(m: Message): string {
  if (!m.blocks) return "";
  return m.blocks
    .map((b) => {
      if (b.type === "text" || b.type === "callout") return b.markdown;
      if (b.type === "algorithm_trace") {
        const trace = b.trace;
        return `[Verified ${trace.algorithmName} result: ${JSON.stringify(trace.result).slice(0, 400)}${trace.guarantee ? `, guarantee: ${trace.guarantee}` : ""}]`;
      }
      if (b.type === "graph") {
        return `[Graph shown: ${b.data.nodes.length} vertices (${b.data.nodes
          .map((n) => n.label)
          .join(", ")
          .slice(0, 120)}), ${b.data.edges.length} edges]`;
      }
      if (b.type === "quiz") return `[Practice quiz shown: ${b.quiz.title}]`;
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .slice(0, 4000);
}

function currentConversationId(): string {
  return newConversationId();
}

export default function App({
  prefill = null,
  topicFromRoute = null,
}: AppProps = {}) {
  const [topics, setTopics] = useState<TopicSummary[]>([]);
  const [topicId, setTopicId] = useState<string>("polynomial-reductions");
  const [level, setLevel] = useState<LearningLevel>("beginner");
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [provider, setProvider] = useState<ProviderStatus>({
    provider: "curated",
    enabled: false,
  });
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  /** The header menu button that opens the drawer; focus returns to it. */
  const drawerTriggerRef = useRef<HTMLButtonElement>(null);
  const drawerWasOpen = useRef(false);
  /**
   * Closing the drawer has to hand focus back to whatever opened it — Escape,
   * the scrim, the close button and "pick a topic" all end here, and without
   * this a keyboard user is dropped onto <body> with no idea where they are.
   */
  useEffect(() => {
    if (drawerWasOpen.current && !drawerOpen) {
      const trigger = drawerTriggerRef.current;
      // `getClientRects()` is the reliable "is this focusable at all" test:
      // below 1024px the header menu button is the only way in, above it the
      // header is display:none, and focusing that would be a silent no-op.
      if (trigger && trigger.getClientRects().length > 0) trigger.focus();
    }
    drawerWasOpen.current = drawerOpen;
  }, [drawerOpen]);
  /** Seed question from a landing-page topic action, handed to the composer. */
  const [draft, setDraft] = useState<string | null>(prefill);

  // Recent conversations (browser-local; no database).
  const [conversations, setConversations] = useState<StoredConversation[]>(() =>
    loadConversations(),
  );
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversationTitle, setConversationTitle] = useState<string | null>(
    null,
  );

  // Quiz (assessment) view. `quizSetupOpen` shows the setup dialog; `quiz`
  // holds a loaded assessment to take. Both are null when the chat is showing,
  // so the conversation state is never disturbed by taking a quiz.
  const [quizSetupOpen, setQuizSetupOpen] = useState(false);
  const [quizBusy, setQuizBusy] = useState(false);
  const [quizError, setQuizError] = useState<string | null>(null);
  const [quiz, setQuiz] = useState<LoadedAssessment | null>(null);

  const openQuizSetup = useCallback(() => {
    setQuizError(null);
    setQuizSetupOpen(true);
  }, []);

  const closeQuizSetup = useCallback(() => {
    setQuizSetupOpen(false);
    setQuizError(null);
  }, []);

  /**
   * Request an assessment. Any failure is shown, never swallowed: the setup
   * dialog stays open with the server's message so the student can change the
   * length or scope and try again rather than finding an empty screen.
   */
  const generateQuiz = useCallback(async (value: QuizSetupValue) => {
    setQuizBusy(true);
    setQuizError(null);
    try {
      const res = await api.createAssessment({
        count: value.count,
        ...(value.topicId ? { topicId: value.topicId } : {}),
        difficulty: value.difficulty,
        format: value.format,
      });
      setQuiz({
        assessment: res.assessment,
        questions: res.questions,
        notes: res.notes,
      });
      setQuizSetupOpen(false);
    } catch (err) {
      setQuizError(friendlyError(err));
    } finally {
      setQuizBusy(false);
    }
  }, []);

  const exitQuiz = useCallback(() => setQuiz(null), []);
  const startNewQuiz = useCallback(() => {
    setQuiz(null);
    setQuizError(null);
    setQuizSetupOpen(true);
  }, []);

  const submitQuiz = useCallback(
    (
      assessmentId: string,
      answers: Record<string, number | null>,
    ): Promise<AssessmentSubmitResponse> =>
      api.submitAssessment({ assessmentId, answers }),
    [],
  );

  const fetchAnswerKey = useCallback(
    (assessmentId: string) => api.getAssessmentAnswerKey(assessmentId),
    [],
  );

  // Auto-scroll: only when the user is already near the bottom.
  const threadRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  // Delta batching: accumulate provider text chunks and flush at most once
  // per animation frame so the UI tracks the stream without re-rendering the
  // conversation for every tiny chunk.
  const deltaQueue = useRef<{ id: string; text: string }[]>([]);
  const rafHandle = useRef<number | null>(null);

  // Latest effective topic/title, for end-of-turn bookkeeping.
  const conversationStateRef = useRef<{
    id: string | null;
    title: string | null;
    topicId: string;
    level: LearningLevel;
  }>({
    id: null,
    title: null,
    topicId: "polynomial-reductions",
    level: "beginner",
  });
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;

  useEffect(() => {
    api
      .topics()
      .then((r) => setTopics(r.topics))
      .catch(() => setTopics([]));
    api
      .health()
      .then((r) => setProvider(r.ai))
      .catch(() => undefined);
  }, []);

  // A topic slug carried by the route is applied only once the real catalog has
  // loaded, and only when it names a topic that exists — an unknown slug would
  // otherwise make every chat request fail with a 404.
  useEffect(() => {
    if (!topicFromRoute || topics.length === 0) return;
    if (!topics.some((topic) => topic.slug === topicFromRoute)) return;
    setTopicId(topicFromRoute);
    conversationStateRef.current = {
      ...conversationStateRef.current,
      topicId: topicFromRoute,
    };
  }, [topicFromRoute, topics]);

  // A seed question updates the composer draft. It is only ever a draft: the
  // visitor presses Send themselves.
  useEffect(() => {
    if (prefill) setDraft(prefill);
  }, [prefill]);

  // Persist the active conversation after each completed turn.
  const persistConversation = useCallback(
    (finalMessages: Message[]) => {
      if (finalMessages.length === 0) return;
      const state = conversationStateRef.current;
      const convId = state.id ?? currentConversationId();
      const firstUser =
        finalMessages.find((m) => m.role === "user")?.text ?? "";
      const stored: StoredConversation = {
        id: convId,
        title: state.title ?? titleFromMessage(firstUser || "Conversation"),
        topicId: state.topicId,
        level: state.level,
        messages: finalMessages.map((m) => ({
          id: m.id,
          role: m.role,
          text: m.text,
          blocks: m.blocks,
          error: m.error,
          stopped: m.stopped,
        })),
        updatedAt: Date.now(),
      };
      setConversations((prev) => upsertConversation(prev, stored));
      conversationStateRef.current = { ...state, id: convId };
      if (!conversationId) setConversationId(convId);
    },
    [conversationId],
  );

  const flushDeltas = useCallback(() => {
    rafHandle.current = null;
    const queued = deltaQueue.current;
    deltaQueue.current = [];
    if (queued.length === 0) return;
    setMessages((prev) => {
      const next = [...prev];
      for (const { id, text } of queued) {
        const idx = next.findIndex((m) => m.id === id);
        if (idx >= 0 && next[idx].streaming) {
          next[idx] = { ...next[idx], text: (next[idx].text ?? "") + text };
        }
      }
      return next;
    });
  }, []);

  const queueDelta = useCallback(
    (id: string, text: string) => {
      deltaQueue.current.push({ id, text });
      if (rafHandle.current === null) {
        rafHandle.current = requestAnimationFrame(flushDeltas);
      }
    },
    [flushDeltas],
  );

  useEffect(
    () => () => {
      if (rafHandle.current !== null) cancelAnimationFrame(rafHandle.current);
    },
    [],
  );

  // Keep near-bottom scroll behavior: scroll only if the user has not scrolled
  // up to review earlier content.
  useEffect(() => {
    if (!stickToBottom.current) return;
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [messages]);

  // Set when the reader has scrolled away from the newest content while a
  // response is still arriving. Auto-scroll never fights them — they get an
  // explicit control instead, which is the one case the brief allows for
  // scrolling on the user's behalf.
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  const onThreadScroll = useCallback(() => {
    const el = threadRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stickToBottom.current = nearBottom;
    setShowJumpToLatest(!nearBottom);
  }, []);

  const jumpToLatest = useCallback(() => {
    const el = threadRef.current;
    if (!el) return;
    // `auto` resolves to the thread's own `scroll-behavior`, which is an
    // immediate jump: a smooth scroll would fight the streaming auto-scroll.
    stickToBottom.current = true;
    setShowJumpToLatest(false);
    el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
  }, []);

  const cancelRef = useRef<(() => void) | null>(null);
  // Synchronous in-flight guard: the streamingId state read lags a render,
  // so rapid double submissions (double-click, chip + Enter) need a ref that
  // is set before the first request is dispatched.
  const inFlightRef = useRef(false);

  const send = useCallback(
    async (text: string, topicOverride?: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (inFlightRef.current || cancelRef.current) return; // no duplicate submissions
      inFlightRef.current = true;
      const effectiveTopicId =
        topicOverride ?? conversationStateRef.current.topicId;
      const levelForTurn = level;

      const userMsg: Message = {
        id: nextId(),
        role: "user",
        text: trimmed,
        topicId: effectiveTopicId,
        level: levelForTurn,
      };
      const assistantId = nextId();
      stickToBottom.current = true;
      setShowJumpToLatest(false);

      // Phase 7: bounded, fact-bearing conversation history. The last user
      // messages plus the assistant text AND structured facts (verified
      // results, graph contents, shown quizzes) so follow-ups can refer to
      // "those vertices" or "step 3" concretely.
      const history = messagesRef.current
        .filter((m) => !m.error && (m.text || m.blocks?.length))
        .slice(-12)
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content:
            m.role === "user"
              ? (m.text ?? "")
              : [m.text ?? "", blockHistoryFacts(m)]
                  .filter(Boolean)
                  .join("\n")
                  .slice(0, 2000),
        }));

      const priorMessages = messagesRef.current;
      if (!conversationStateRef.current.id) {
        conversationStateRef.current = {
          ...conversationStateRef.current,
          id: currentConversationId(),
          title: titleFromMessage(
            priorMessages.length === 0
              ? trimmed
              : (priorMessages.find((m) => m.role === "user")?.text ?? trimmed),
          ),
        };
        setConversationId(conversationStateRef.current.id);
        setConversationTitle(conversationStateRef.current.title);
      }

      setMessages((prev) => [
        ...prev,
        userMsg,
        {
          id: assistantId,
          role: "assistant",
          streaming: true,
          topicId: effectiveTopicId,
          level: levelForTurn,
        },
      ]);
      setStreamingId(assistantId);
      setDrawerOpen(false);

      let done = false;

      const finishTurn = (patch: Partial<Message>) => {
        if (done) return;
        done = true;
        flushDeltas();
        setMessages((prev) => {
          const next = prev.map((m) =>
            m.id === assistantId ? { ...m, streaming: false, ...patch } : m,
          );
          return next;
        });
        setStreamingId(null);
        cancelRef.current = null;
        inFlightRef.current = false;
      };

      cancelRef.current = streamChat(
        {
          message: trimmed,
          topicId: effectiveTopicId,
          level: levelForTurn,
          history,
        },
        {
          onDelta: (delta) => queueDelta(assistantId, delta),
          onBlock: (_index, block) => {
            // A structured block means the streamed text (if any) is complete;
            // flush pending deltas first so ordering stays truthful.
            flushDeltas();
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, blocks: [...(m.blocks ?? []), block] }
                  : m,
              ),
            );
          },
          onMeta: (meta) => {
            // Topic switching without the sidebar: the server's effective
            // topic governs the conversation from now on.
            if (meta.effectiveTopicId) {
              conversationStateRef.current = {
                ...conversationStateRef.current,
                topicId: meta.effectiveTopicId,
              };
              setTopicId(meta.effectiveTopicId);
            }
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId && !m.mode ? { ...m, mode: meta.mode } : m,
              ),
            );
          },
          onDone: (info) => {
            if (info.effectiveTopicId) {
              conversationStateRef.current = {
                ...conversationStateRef.current,
                topicId: info.effectiveTopicId,
              };
              setTopicId(info.effectiveTopicId);
            }
            finishTurn({
              actions: info.actions,
              fallbackReason: info.fallbackReason,
            });
            window.setTimeout(
              () => persistConversation(messagesRef.current),
              60,
            );
          },
          onError: (message) => {
            finishTurn({ error: message });
          },
        },
      );
    },
    [level, streamingId, queueDelta, flushDeltas, persistConversation],
  );

  const stop = useCallback(() => {
    if (cancelRef.current) cancelRef.current();
    cancelRef.current = null;
    inFlightRef.current = false;
    if (streamingId) {
      const id = streamingId;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id
            ? { ...m, streaming: false, stopped: !m.text && !m.blocks?.length }
            : m,
        ),
      );
      setStreamingId(null);
      window.setTimeout(() => persistConversation(messagesRef.current), 50);
    }
  }, [streamingId, persistConversation]);

  const reset = useCallback(() => {
    stop();
    setMessages([]);
    setConversationId(null);
    setConversationTitle(null);
    conversationStateRef.current = {
      id: null,
      title: null,
      topicId,
      level,
    };
    setDrawerOpen(false);
    stickToBottom.current = true;
    setShowJumpToLatest(false);
  }, [stop, topicId, level]);

  const regenerate = useCallback(() => {
    if (streamingId) return;
    // Find the last user message and remove everything after it, then resend.
    let lastUser = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        lastUser = i;
        break;
      }
    }
    if (lastUser < 0) return;
    const user = messages[lastUser];
    setMessages(messages.slice(0, lastUser));
    void send(user.text ?? "", user.topicId);
  }, [messages, streamingId, send]);

  const selectTopic = useCallback((id: string) => {
    setTopicId(id);
    conversationStateRef.current = {
      ...conversationStateRef.current,
      topicId: id,
    };
  }, []);

  const openConversation = useCallback(
    (id: string) => {
      const conv = conversations.find((c) => c.id === id);
      if (!conv) return;
      stop();
      setMessages(conv.messages.map((m) => ({ ...m, streaming: false })));
      setConversationId(conv.id);
      setConversationTitle(conv.title);
      conversationStateRef.current = {
        id: conv.id,
        title: conv.title,
        topicId: conv.topicId,
        level: conv.level,
      };
      setTopicId(conv.topicId);
      setLevel(conv.level);
      setDrawerOpen(false);
      stickToBottom.current = true;
      setShowJumpToLatest(false);
    },
    [conversations, stop],
  );

  const removeConversation = useCallback(
    (id: string) => {
      const next = deleteStoredConversation(id, conversations);
      setConversations(next);
      if (id === conversationId) {
        stop();
        setMessages([]);
        setConversationId(null);
        setConversationTitle(null);
      }
    },
    [conversations, conversationId, stop],
  );

  const renameCurrent = useCallback(
    (id: string, title: string) => {
      const next = renameConversation(id, title, conversations);
      setConversations(next);
      if (id === conversationId && title.trim()) {
        setConversationTitle(title.trim());
        conversationStateRef.current = {
          ...conversationStateRef.current,
          title: title.trim(),
        };
      }
    },
    [conversations, conversationId],
  );

  return (
    <div className="app">
      <Sidebar
        topics={topics}
        topicId={topicId}
        onTopicChange={selectTopic}
        level={level}
        onLevelChange={setLevel}
        onNewChat={reset}
        onCreateQuiz={() => {
          openQuizSetup();
          setDrawerOpen(false);
        }}
        onShowPrivacy={() => {
          setShowPrivacy(true);
          setDrawerOpen(false);
        }}
        provider={provider}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        conversations={conversations}
        activeConversationId={conversationId}
        onOpenConversation={openConversation}
        onRenameConversation={renameCurrent}
        onDeleteConversation={removeConversation}
      />
      <div className="main">
        <Header
          topics={topics}
          topicId={topicId}
          level={level}
          provider={provider}
          onOpenDrawer={() => setDrawerOpen(true)}
          triggerRef={drawerTriggerRef}
          streaming={Boolean(streamingId)}
          conversationTitle={conversationTitle}
        />
        {quiz ? (
          /* A focused surface, not a modal: a 50-question paper in a dialog
             would be unusable on a phone. The chat underneath keeps its
             state, so leaving the quiz returns to exactly where it was. */
          <QuizView
            data={quiz}
            onExit={exitQuiz}
            onNewQuiz={startNewQuiz}
            submit={submitQuiz}
            fetchAnswerKey={fetchAnswerKey}
          />
        ) : (
          <>
            <div className="thread-wrap">
              <main
                className="thread"
                ref={threadRef}
                onScroll={onThreadScroll}
                aria-live="polite"
              >
                <div className="thread-inner">
                  {messages.length === 0 ? (
                    <div className="welcome">
                      
                      <h1 className="welcome-title">
                        What would you like to learn today?
                      </h1>
                      <p className="welcome-sub">
                        Ask a question in your own words — no topic selection needed. I can explain concepts, prove theorems, run
                        verified algorithms step by step, and draw graphs.
                        {provider.enabled
                          ? " Responses are AI-generated."
                          : " Responses come from curated, offline lessons."}
                      </p>

                      <div className="welcome-composer">
                        <Composer
                          onSend={(text) => {
                            setDraft(null);
                            void send(text);
                          }}
                          onStop={stop}
                          streaming={Boolean(streamingId)}
                          draft={draft}
                          hintId="composer-hint"
                          placeholder="Ask anything — e.g. 'run a Max-Cut demo' or 'explain the formal proof'"
                        />
                      </div>
                      {/* Six real request paths, each sending the message it names.
                    They are starters, not a catalogue: every one of them routes
                    through the same send path as typing the question yourself. */}
                      <div
                        className="starter-chips"
                        role="group"
                        aria-label="Suggested starting points"
                      >
                        {CAPABILITY_CHIPS.map(
                          ({ label, prompt, hint, Icon }) => (
                            <button
                              key={label}
                              type="button"
                              className="chip starter-chip"
                              title={prompt}
                              onClick={() => void send(prompt)}
                            >
                              <span
                                className="starter-chip-icon"
                                aria-hidden="true"
                              >
                                <Icon size={18} />
                              </span>
                              <span className="starter-chip-text">
                                <span className="starter-chip-label">
                                  {label}
                                </span>
                                <span className="starter-chip-hint">
                                  {hint}
                                </span>
                              </span>
                            </button>
                          ),
                        )}
                      </div>
                      
                    </div>
                  ) : (
                    <ChatThread
                      messages={messages}
                      streamingActive={Boolean(streamingId)}
                      onAction={(action) => void send(action)}
                      onRegenerate={regenerate}
                    />
                  )}
                </div>
              </main>
              {/* Only ever offered when the reader has scrolled away from the
            newest content; auto-scroll never overrides them otherwise. The
            wrapper puts it at the foot of the reading area: inside the
            scrolling box it would scroll away, over the composer it would
            cover the input. */}
              {showJumpToLatest && messages.length > 0 && (
                <button
                  type="button"
                  className="jump-latest"
                  onClick={jumpToLatest}
                >
                  <IconArrowDownToLine />
                  Latest
                </button>
              )}
            </div>
            {messages.length > 0 && (
              <Composer
                onSend={(text) => {
                  setDraft(null);
                  void send(text);
                }}
                onStop={stop}
                streaming={Boolean(streamingId)}
                draft={draft}
                hintId="composer-hint"
                placeholder="Ask anything — e.g. 'run a Max-Cut demo' or 'explain the formal proof'"
              />
            )}
          </>
        )}
      </div>
      {quizSetupOpen && (
        <QuizSetup
          topics={topics}
          onGenerate={(value) => void generateQuiz(value)}
          onClose={closeQuizSetup}
          busy={quizBusy}
          error={quizError}
        />
      )}
      {showPrivacy && <PrivacyNotice onClose={() => setShowPrivacy(false)} />}
    </div>
  );
}
