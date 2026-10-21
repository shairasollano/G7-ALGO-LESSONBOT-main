# Test Cases

## Automated tests

### Server (`server/tests/`, run with `npm --prefix server test`)

**`solvers.test.ts` (24 tests)**
- Reduction: parameter mapping `k ↦ n − k`; witness independent set + complement cover verification; `k = 0` edge case; invalid `k` rejection; malformed graph rejection; deterministic replay.
- Vertex Cover: all edges covered; `|C| = 2|M| ≤ 2·OPT` guarantee; star graph; empty graph; single edge; duplicate edge rejection; deterministic replay.
- Cook–Levin: variable/clause counts; valid vs forbidden window counts; oversized machine rejection; unknown input symbol rejection; step bound validation; deterministic replay.
- Max-Cut: seed reproducibility; different seeds differ; `E[cut] = m/2`; cut values within `[0, m]`; invalid seed/trials rejection; single vertex with no edges.

**`routes.test.ts` (20 tests)**
- Health: ok, no secret leak.
- Topics: five listed; full lesson for valid slug; 404 for unknown.
- Solve: trace returned; 422 for invalid graph; 400 for unsupported algorithm; 400 for malformed body.
- Quizzes: generate (5 questions, no answer key leak) → grade (deterministic score, rationales); 410 for expired quiz.
- Chat: curated fallback blocks; solver-first for computed examples; quiz block for quiz intent; body validation; 404 for unknown topic.
- Gemini gate: disabled by default.
- CuratedFallbackProvider: lesson blocks; quiz intent; example intent with solver; unsupported topic redirect.

### Client (`client/src/**/*.test.tsx`, run with `npm --prefix client test`)

**`BlockRenderer.test.tsx` (5 tests)**
- Text block renders sanitized HTML (raw `<script>` stripped).
- Callout block renders title and body.
- Table block renders headers and rows.
- Math block renders KaTeX.
- Source reference block renders title and link.

## Manual / browser QA checklist

- [ ] App opens into chatbot interface with starter prompts and composer.
- [ ] All five topics selectable; lesson content renders per level.
- [ ] "Show a Vertex Cover example" returns a computed trace with step controls and graph.
- [ ] "Quiz me" generates a 5-question quiz; grading shows score + rationales.
- [ ] Layout verified at 320px, 375px, 768px, 1024px, 1440px widths.
- [ ] Graph blocks support pan/zoom on touch and mouse.
- [ ] Composer usable with on-screen keyboard (input not hidden).
- [ ] Loading, error, and empty states visible.
- [ ] Privacy notice accessible from header.
- [ ] Reduced-motion respected (spinner animation disabled).
