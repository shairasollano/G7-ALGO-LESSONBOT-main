/**
 * Shared API contract between the AlgoTutor AI client and server.
 *
 * This module is the single source of truth for the chat block schema,
 * topic/lesson types, solver result types, and API envelopes. Both the
 * Vite client and the Express server import from here — do not duplicate
 * these types on either side.
 */

// ---------------------------------------------------------------------------
// Learning levels
// ---------------------------------------------------------------------------

export const LEARNING_LEVELS = ["beginner", "intermediate", "formal"] as const;
export type LearningLevel = (typeof LEARNING_LEVELS)[number];

// ---------------------------------------------------------------------------
// Chat blocks (rendered inside assistant turns)
// ---------------------------------------------------------------------------

export type GraphNodeState = "default" | "active" | "selected" | "covered" | "uncovered" | "cut" | "side_a" | "side_b";
export type GraphEdgeState = "default" | "active" | "covered" | "uncovered" | "cut" | "uncut";

export interface GraphNode {
  id: string;
  label: string;
  x: number;
  y: number;
  state: GraphNodeState;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  state: GraphEdgeState;
  caption?: string;
}

export type GraphLayout = "circular" | "linear" | "hierarchical" | "grid";
export type EdgeType = "default" | "straight" | "step" | "smoothstep" | "bezier";

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  directed?: boolean;
  layout?: GraphLayout;
  edgeType?: EdgeType;
}

export interface TableColumn {
  key: string;
  header: string;
}

export type TableRow = Record<string, string | number>;

export interface ChartDatum {
  label: string;
  value: number;
  /** Accessible description of what this datum means. */
  description?: string;
}

export interface ChartData {
  /** Human-readable unit/definition of the value axis, e.g. "cut edges". */
  valueUnit: string;
  data: ChartDatum[];
}

export interface TraceStep {
  step: number;
  title: string;
  description: string;
  /** Node/edge ids highlighted at this step. */
  highlightNodes?: string[];
  highlightEdges?: string[];
  /** Full graph snapshot at this step (states applied to the base graph). */
  graph?: GraphData;
  /** Optional structured table shown beside the step explanation. */
  table?: { columns: TableColumn[]; rows: TableRow[]; caption?: string };
}

export interface AlgorithmTrace {
  algorithmId: string;
  algorithmName: string;
  title: string;
  steps: TraceStep[];
  result: Record<string, unknown>;
  complexity: { time: string; space: string };
  /** Guarantee/probability statement computed by the solver, not by the AI. */
  guarantee?: string;
  /** Present when the algorithm uses randomness (seedable teaching mode). */
  seed?: number;
  warnings?: string[];
}

export type QuizDifficulty = "easy" | "medium" | "hard";

export interface QuizQuestion {
  id: string;
  prompt: string;
  kind: "multiple_choice" | "numerical" | "true_false";
  choices?: string[];
  /** Correct answer: choice index for MC, numeric value for numerical. */
  answer: number;
  rationale: string;
  difficulty: QuizDifficulty;
  hint: string;
  /** Lesson objective this question checks. */
  objective: string;
  /** Topic this question was drawn from (combined quizzes mix topics). */
  topicId?: string;
}

export interface ValidatedQuiz {
  id: string;
  topicId: string;
  title: string;
  questions: QuizQuestion[];
}

// ---------------------------------------------------------------------------
// Assessments (mixed-topic quizzes, 10–50 questions)
// ---------------------------------------------------------------------------

/** The only permitted assessment lengths. Nothing shorter, nothing longer. */
export const QUIZ_COUNTS = [10, 20, 30, 40, 50] as const;
export type QuizCount = (typeof QUIZ_COUNTS)[number];

/** Difficulty of the assessment as a whole. "mixed" is the default. */
export const QUIZ_DIFFICULTIES = ["mixed", "beginner", "intermediate", "advanced"] as const;
export type QuizDifficultySetting = (typeof QUIZ_DIFFICULTIES)[number];

/** Question format mix. "mixed" (MC + true/false) is the default. */
export const QUIZ_FORMATS = ["mixed", "multiple_choice", "true_false"] as const;
export type QuizFormat = (typeof QUIZ_FORMATS)[number];

export type AssessmentQuestionKind = "multiple_choice" | "true_false" | "numerical";

/**
 * A question as the STUDENT sees it. The answer key and explanations are
 * deliberately absent: they live server-side in the quiz session and are only
 * revealed by grading or by the explicit answer-key action.
 */
export interface AssessmentQuestion {
  id: string;
  topicId: string;
  prompt: string;
  kind: AssessmentQuestionKind;
  /** Distinct options for MC (2+), `["True", "False"]` for true/false, null for numerical. */
  choices: string[] | null;
  hint: string;
  difficulty: QuizDifficulty;
}

/** Topic coverage actually present in the assembled assessment. */
export interface AssessmentCoverage {
  topicId: string;
  title: string;
  count: number;
}

export interface AssessmentMeta {
  id: string;
  title: string;
  /** "combined" mixes every catalog topic; "single" restricts to one. */
  scope: "combined" | "single";
  count: number;
  difficulty: QuizDifficultySetting;
  format: QuizFormat;
  /**
   * "ai" = every question came from the active provider; "curated" = every
   * question came from the validated bank; "mixed" = both contributed, so the
   * label never overstates what the model actually produced.
   */
  source: "ai" | "curated" | "mixed";
  topicCoverage: AssessmentCoverage[];
  createdAt: number;
  expiresAt: number;
}

export interface AssessmentGenerateRequest {
  count: QuizCount;
  /** Omit for the default combined-all-topics assessment. */
  topicId?: string;
  difficulty?: QuizDifficultySetting;
  format?: QuizFormat;
}

export interface AssessmentGenerateResponse {
  assessment: AssessmentMeta;
  /** Keyless questions, in mixed assessment order. */
  questions: AssessmentQuestion[];
}

export interface AssessmentSubmitRequest {
  assessmentId: string;
  /** questionId → chosen answer (MC/TF choice index, or the numeric answer). */
  answers: Record<string, number | null>;
}

export interface AssessmentQuestionResult {
  questionId: string;
  topicId: string;
  prompt: string;
  kind: AssessmentQuestionKind;
  choices: string[] | null;
  given: number | null;
  answer: number;
  correct: boolean;
  unanswered: boolean;
  explanation: string;
}

export interface AssessmentSubmitResponse {
  assessmentId: string;
  title: string;
  score: number;
  total: number;
  correct: number;
  incorrect: number;
  unanswered: number;
  percentage: number;
  /**
   * True when this is a replayed grade from an earlier submission of the same
   * assessment. A duplicate submit never re-grades — it returns the stored
   * result — and the UI says so rather than letting a second score appear.
   */
  alreadySubmitted?: boolean;
  /** Per-topic performance, one entry per topic the assessment touched. */
  topicBreakdown: (AssessmentCoverage & { correct: number })[];
  results: AssessmentQuestionResult[];
}

/** The separate answer-key document (explicit instructor action; no auth exists). */
export interface AssessmentAnswerKeyResponse {
  assessmentId: string;
  title: string;
  count: number;
  topicCoverage: AssessmentCoverage[];
  questions: {
    id: string;
    number: number;
    topicId: string;
    prompt: string;
    kind: AssessmentQuestionKind;
    choices: string[] | null;
    answer: number;
    answerText: string;
    explanation: string;
  }[];
}

export type CalloutVariant = "info" | "warning" | "success";

export interface SourceReference {
  title: string;
  url?: string;
  note?: string;
}

export type ChatBlock =
  | { type: "text"; markdown: string }
  | { type: "math"; latex: string; displayMode?: boolean }
  | { type: "callout"; variant: CalloutVariant; title?: string; markdown: string }
  | { type: "graph"; graphId: string; data: GraphData; caption: string }
  | { type: "table"; columns: TableColumn[]; rows: TableRow[]; caption?: string }
  | { type: "chart"; chartType: "line" | "bar"; data: ChartData; caption: string }
  | { type: "algorithm_trace"; trace: AlgorithmTrace }
  | { type: "quiz"; quiz: ValidatedQuiz }
  | { type: "source_reference"; ref: SourceReference };

// ---------------------------------------------------------------------------
// Topics / curriculum
// ---------------------------------------------------------------------------

export interface KeyTerm {
  term: string;
  definition: string;
}

export interface Misconception {
  myth: string;
  correction: string;
}

export interface TopicSummary {
  slug: string;
  title: string;
  description: string;
}

export interface TopicDetail extends TopicSummary {
  objectives: string[];
  prerequisites: string[];
  readinessQuestions: string[];
  intuition: string;
  formalStatement: string;
  keyTerms: KeyTerm[];
  notation: { symbol: string; meaning: string }[];
  workedExample: {
    title: string;
    input: string;
    steps: string[];
    result: string;
  };
  visualization: {
    kind: "graph" | "table" | "chart" | "none";
    description: string;
  };
  analysis: string;
  misconceptions: Misconception[];
  summary: string;
  furtherPractice: string[];
  relatedTopics: string[];
  references: { title: string; url?: string; note?: string }[];
}

// ---------------------------------------------------------------------------
// Solver results
// ---------------------------------------------------------------------------

export interface SolverResult {
  algorithmId: string;
  algorithmName: string;
  topicId: string;
  input: Record<string, unknown>;
  steps: TraceStep[];
  result: Record<string, unknown>;
  complexity: { time: string; space: string };
  guarantee?: string;
  seed?: number;
  warnings?: string[];
}

// ---------------------------------------------------------------------------
// API envelopes
// ---------------------------------------------------------------------------

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface ChatRequest {
  message: string;
  topicId?: string;
  level: LearningLevel;
  history?: { role: "user" | "assistant"; content: string }[];
}

export interface ChatResponse {
  blocks: ChatBlock[];
  mode: "ai" | "curated_fallback";
  topicId: string | null;
  level: LearningLevel;
  /** True when the request asked for a computed example and the solver ran. */
  computed: boolean;
  /** Effective topic for THIS turn (may switch from the user-selected one). */
  effectiveTopicId?: string | null;
  /** Action ids the producing provider can honor on the next turn. */
  actions?: string[];
}

/**
 * Contextual follow-up actions (ids -> UI prompt). The server decides which
 * ids are available per response; the client renders the matching subset.
 */
export const TUTOR_ACTIONS: Record<string, { label: string; prompt: string }> = {
  explain_simpler: { label: "Explain more simply", prompt: "Explain that more simply" },
  formal_proof: { label: "Show formal proof", prompt: "Show me the formal proof for the current topic" },
  another_example: { label: "Give another example", prompt: "Give me another example for the current topic" },
  quiz: { label: "Generate a practice question", prompt: "Generate a practice question on this" },
  compare: { label: "Compare approaches", prompt: "Now compare that with another approach from the supported topics" },
};

export interface SolveRequest {
  algorithmId: string;
  input: Record<string, unknown>;
}

export interface QuizGenerateRequest {
  topicId?: string;
  count?: number;
}

export interface QuizGradeRequest {
  quizId: string;
  answers: Record<string, number>;
}

export interface QuizGradeResponse {
  quizId: string;
  score: number;
  total: number;
  results: {
    questionId: string;
    correct: boolean;
    given: number | null;
    answer: number;
    rationale: string;
    hint: string;
  }[];
}

export interface HealthResponse {
  status: "ok";
  ai: { provider: string; enabled: boolean };
  time: string;
}
