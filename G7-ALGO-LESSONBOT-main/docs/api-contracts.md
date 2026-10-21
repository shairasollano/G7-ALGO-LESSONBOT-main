# API Contracts

Base URL: `/api`. All bodies are JSON. Errors use a consistent envelope:

```json
{ "error": { "code": "string", "message": "string", "details": "optional" } }
```

## GET /api/health

Returns service health without leaking secrets.

**Response 200:**
```json
{ "status": "ok", "ai": { "provider": "curated", "enabled": false }, "time": "2026-10-16T..." }
```

## GET /api/topics

**Response 200:** `{ "topics": [{ "slug", "title", "description" }] }` — all five topics.

## GET /api/topics/:slug

**Response 200:** full `TopicDetail` (objectives, prerequisites, readiness questions, intuition, formal statement, key terms, notation, worked example, visualization, analysis, misconceptions, summary, further practice, related topics, references).
**Response 404:** `topic_not_found`.

## POST /api/tutor/chat

**Request:**
```json
{
  "message": "Show a Vertex Cover example",
  "topicId": "approximation-algorithms",
  "level": "intermediate",
  "history": [{ "role": "user", "content": "..." }]
}
```
- `message`: 1–2000 chars (required)
- `topicId`: optional, defaults to `polynomial-reductions`
- `level`: `beginner` | `intermediate` | `formal` (required)
- `history`: ≤ 20 entries (optional)

**Response 200:**
```json
{
  "blocks": [ /* ChatBlock[] — see shared contract */ ],
  "mode": "ai" | "curated_fallback",
  "topicId": "approximation-algorithms",
  "level": "intermediate",
  "computed": true
}
```
When the message asks for a computed example, the deterministic solver runs first and the verified trace is prepended to the blocks.

**Errors:** 400 `validation_error`, 404 `topic_not_found`, 429 `rate_limited`.

## POST /api/problems/solve

**Request:** `{ "algorithmId": "vertex-cover-2approx", "input": { "vertices": [...], "edges": [[...]] } }`

**Response 200:** `SolverResult` — `algorithmId`, `algorithmName`, `topicId`, `input`, `steps[]` (ordered, with graph snapshots and tables), `result`, `complexity`, `guarantee?`, `seed?`, `warnings?`.

**Errors:** 400 `validation_error` / `unsupported_algorithm`, 422 `invalid_vertices` / `invalid_edges` / `invalid_parameter` / `too_large` / `invalid_seed` / `invalid_trials` / `invalid_machine` / `invalid_input` / `invalid_steps`.

## POST /api/quizzes/generate

**Request:** `{ "topicId": "cook-levin", "count": 5 }` (both optional; count ≤ 10).

**Response 200:** `{ "quiz": { "id", "topicId", "title", "questions": [...] } }` — questions **omit** `answer`, `rationale`, and `hint` (grading is server-side).

**Errors:** 400 `validation_error`, 404 `topic_not_found`.

## POST /api/quizzes/grade

**Request:** `{ "quizId": "quiz-...", "answers": { "<questionId>": <choiceIndex|number> } }`

**Response 200:**
```json
{
  "quizId": "quiz-...",
  "score": 4,
  "total": 5,
  "results": [{ "questionId", "correct", "given", "answer", "rationale", "hint" }]
}
```

**Errors:** 400 `validation_error`, 410 `quiz_expired` (quiz sessions live 30 minutes in memory; no database).

## ChatBlock contract

```ts
type ChatBlock =
  | { type: "text"; markdown: string }
  | { type: "math"; latex: string; displayMode?: boolean }
  | { type: "callout"; variant: "info"|"warning"|"success"; title?: string; markdown: string }
  | { type: "graph"; graphId: string; data: GraphData; caption: string }
  | { type: "table"; columns: TableColumn[]; rows: TableRow[]; caption?: string }
  | { type: "chart"; chartType: "line"|"bar"; data: ChartData; caption: string }
  | { type: "algorithm_trace"; trace: AlgorithmTrace }
  | { type: "quiz"; quiz: ValidatedQuiz }
  | { type: "source_reference"; ref: { title: string; url?: string; note?: string } };
```

The full contract lives in `shared/contract.ts` — the single source of truth imported by both client and server.
