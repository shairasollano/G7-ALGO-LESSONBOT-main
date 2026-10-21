/**
 * Typed API client. Maps network/HTTP errors to friendly messages; never
 * exposes server internals.
 *
 * In development, requests go to the same origin (the Vite dev server proxies
 * /api to the backend). In production, set VITE_API_BASE_URL at build time to
 * the API origin (e.g. https://api.example.com).
 */
import type {
  AssessmentAnswerKeyResponse,
  AssessmentGenerateRequest,
  AssessmentGenerateResponse,
  AssessmentSubmitRequest,
  AssessmentSubmitResponse,
  ChatBlock,
  ChatRequest,
  ChatResponse,
  HealthResponse,
  QuizGenerateRequest,
  QuizGradeRequest,
  QuizGradeResponse,
  SolveRequest,
  SolverResult,
  TopicDetail,
  TopicSummary,
} from "@shared/contract";

/**
 * Resolve the API base URL. In production, VITE_API_BASE_URL is baked in at
 * build time. In development it is empty, so requests use the same origin
 * (the Vite dev server proxies /api to the backend).
 */
const API_BASE: string = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

/** Join a base URL and a path, avoiding duplicated or missing slashes. */
export function joinUrl(base: string, path: string): string {
  if (!base) return path;
  const trimmedBase = base.replace(/\/+$/, "");
  const trimmedPath = path.replace(/^\/+/, "");
  return `${trimmedBase}/${trimmedPath}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = joinUrl(API_BASE, path);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...init,
    });
  } catch {
    throw new Error("network_error");
  }
  if (!res.ok) {
    let code = "unknown";
    try {
      const body = await res.json();
      code = body?.error?.code ?? "unknown";
    } catch {
      /* ignore */
    }
    if (res.status === 429) throw new Error("rate_limited");
    if (res.status === 410) throw new Error("quiz_expired");
    if (res.status === 422) throw new Error(`invalid_input:${code}`);
    if (res.status === 404) throw new Error(`not_found:${code}`);
    throw new Error(`server_error:${code}`);
  }
  return (await res.json()) as T;
}

export const api = {
  health: () => request<HealthResponse>("/api/health"),
  topics: () => request<{ topics: TopicSummary[] }>("/api/topics"),
  topic: (slug: string) => request<{ topic: TopicDetail }>(`/api/topics/${encodeURIComponent(slug)}`),
  chat: (body: ChatRequest) =>
    request<ChatResponse>("/api/tutor/chat", { method: "POST", body: JSON.stringify(body) }),
  solve: (body: SolveRequest) =>
    request<SolverResult>("/api/problems/solve", { method: "POST", body: JSON.stringify(body) }),
  generateQuiz: (body: QuizGenerateRequest) =>
    request<{ quiz: { id: string; topicId: string; title: string; questions: import("@shared/contract").QuizQuestion[] } }>(
      "/api/quizzes/generate",
      { method: "POST", body: JSON.stringify(body) },
    ),
  gradeQuiz: (body: QuizGradeRequest) =>
    request<QuizGradeResponse>("/api/quizzes/grade", { method: "POST", body: JSON.stringify(body) }),

  // -------------------------------------------------------------------------
  // Assessments (mixed-topic quizzes, 10–50 questions)
  //
  // The response to `createAssessment` carries KEYLESS questions only. The
  // answer key is fetched separately, by an explicit action, and grading
  // happens server-side against the stored key.
  // -------------------------------------------------------------------------

  /**
   * Build an assessment of exactly the requested length. `count` is a closed
   * set (10/20/30/40/50); the server rejects anything else rather than
   * rounding to the nearest length it happens to be able to build.
   */
  createAssessment: (body: AssessmentGenerateRequest) =>
    request<AssessmentGenerateResponse & { notes?: string[] }>("/api/quizzes/assessment", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** Reload an active session's keyless questions (e.g. after a refresh). */
  getAssessment: (id: string) =>
    request<AssessmentGenerateResponse & { alreadySubmitted?: boolean; result?: AssessmentSubmitResponse }>(
      `/api/quizzes/assessment/${encodeURIComponent(id)}`,
    ),

  /** Server-authoritative grading. A duplicate submit replays the first result. */
  submitAssessment: (body: AssessmentSubmitRequest) =>
    request<AssessmentSubmitResponse & { alreadySubmitted?: boolean }>(
      `/api/quizzes/assessment/${encodeURIComponent(body.assessmentId)}/submit`,
      { method: "POST", body: JSON.stringify(body) },
    ),

  /**
   * The separate answer-key document. This app has no authentication: the
   * unguessable session id is the only guard, and the UI must say so rather
   * than implying this is an access-controlled instructor feature.
   */
  getAssessmentAnswerKey: (id: string) =>
    request<AssessmentAnswerKeyResponse>(`/api/quizzes/assessment/${encodeURIComponent(id)}/key`),
};

// ---------------------------------------------------------------------------
// Streaming chat (SSE)
// ---------------------------------------------------------------------------

export interface StreamUsageMeta {
  model?: string;
  /** Exact provider-reported output tokens when available. */
  outputTokens?: number;
  inputTokens?: number;
}

export interface StreamCallbacks {
  /** Request id from the server's `start` event. */
  onStart?: (info: { requestId: string; topicId: string | null; level: string; computed: boolean }) => void;
  /** Each newly generated chunk of text. Called exactly once per text piece. */
  onDelta: (text: string, requestId?: string) => void;
  /** Structured educational blocks as they become available. */
  onBlock: (index: number, block: ChatBlock) => void;
  /** Producing mode, declared once as soon as it is conclusively known. */
  onMeta: (meta: { mode: "ai" | "curated_fallback"; topicId: string | null; effectiveTopicId?: string | null; level: string; computed: boolean }) => void;
  /**
   * Completion metadata. The server re-sends NO text payload here; it
   * declares the effective topic and which follow-up actions it can honor.
   * `fallbackReason` is present only when an enabled AI provider failed before
   * its first text delta and the curated fallback answered instead.
   */
  onDone: (info: {
    requestId?: string;
    usage?: StreamUsageMeta;
    effectiveTopicId?: string;
    actions?: string[];
    fallbackReason?: string;
  }) => void;
  /** Safe, user-presentable error (stream-level failure). */
  onError: (message: string) => void;
}

/**
 * Parse a chunk of SSE text matching `event: <type>\ndata: <json>\n\n` frames
 * and classify each event. Exported for tests. Defends against servers that
 * pack several events into a single frame: each "event:" line starts a new
 * record, and the most recent data line before the next record is used.
 */
export function parseSseChunk(chunk: string): { event: string; data: unknown }[] {
  const events: { event: string; data: unknown }[] = [];
  const frames = chunk.split("\n\n");
  for (const frame of frames) {
    if (!frame.trim()) continue;
    let event = "";
    let data = "";
    const dispatch = () => {
      if (event && data) {
        try {
          events.push({ event, data: JSON.parse(data) });
        } catch {
          // Malformed frame: skip rather than crash the stream.
        }
      }
      event = "";
      data = "";
    };
    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) {
        if (event && data) dispatch();
        event = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        data = line.slice(5).trim();
      }
    }
    dispatch();
  }
  return events;
}

/**
 * Stream a chat response via SSE. The returned cancel() aborts the request;
 * after cancellation no further callbacks fire.
 */
export function streamChat(body: ChatRequest, callbacks: StreamCallbacks): () => void {
  const url = joinUrl(API_BASE, "/api/tutor/chat/stream");
  const controller = new AbortController();
  let cancelled = false;

  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: controller.signal,
  })
    .then(async (res) => {
      if (cancelled) return;
      if (!res.ok) {
        let code = "unknown";
        try {
          const data = await res.json();
          code = data?.error?.code ?? "unknown";
        } catch { /* ignore */ }
        if (res.status === 429) throw new Error("rate_limited");
        if (res.status === 404) throw new Error(`not_found:${code}`);
        throw new Error(`server_error:${code}`);
      }
      const reader = res.body?.getReader();
      if (!reader) throw new Error("network_error");

      const decoder = new TextDecoder();
      let buffer = "";
      while (!cancelled) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // Keep an incomplete trailing frame in the buffer; process complete ones.
        const lastDoubleNewline = buffer.lastIndexOf("\n\n");
        if (lastDoubleNewline === -1) continue;
        const complete = buffer.slice(0, lastDoubleNewline + 2);
        buffer = buffer.slice(lastDoubleNewline + 2);
        for (const { event, data } of parseSseChunk(complete)) {
          if (cancelled) break;
          switch (event) {
            case "start":
              callbacks.onStart?.(data as { requestId: string; topicId: string | null; level: string; computed: boolean });
              break;
            case "delta":
              callbacks.onDelta((data as { text: string }).text);
              break;
            case "block": {
              const { index, block } = data as { index: number; block: ChatBlock };
              callbacks.onBlock(index, block);
              break;
            }
            case "meta":
              callbacks.onMeta(
                data as {
                  mode: "ai" | "curated_fallback";
                  topicId: string | null;
                  effectiveTopicId?: string | null;
                  level: string;
                  computed: boolean;
                },
              );
              break;
            case "done":
              callbacks.onDone(
                data as {
                  requestId?: string;
                  usage?: StreamUsageMeta;
                  effectiveTopicId?: string;
                  actions?: string[];
                  fallbackReason?: string;
                },
              );
              return;
            case "error":
              callbacks.onError((data as { message: string }).message);
              return;
            default:
              break;
          }
        }
      }
    })
    .catch((err: unknown) => {
      if (cancelled) return;
      if (err instanceof Error && err.name === "AbortError") return;
      callbacks.onError(friendlyError(err));
    });

  return () => {
    cancelled = true;
    controller.abort();
  };
}

export function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg === "network_error") return "Could not reach the server. Check your connection and try again.";
  if (msg === "rate_limited") return "Too many requests to the AI tutor. Please wait a moment and try again.";
  if (msg === "quiz_expired") return "This quiz session has expired. Please generate a new quiz.";
  if (msg.startsWith("invalid_input:")) return "That input is not valid. Check the problem data and try again.";
  if (msg.startsWith("not_found:")) return "That resource was not available. Try a different topic or problem.";
  if (msg.startsWith("server_error:")) return "Something went wrong on the server. Please try again.";
  return "Something went wrong. Please try again.";
}
