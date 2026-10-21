# AlgoTutor AI — Requirements

## Product identity

**AlgoTutor AI** is an AI-assisted learning web app that teaches algorithms and theoretical computer science. It behaves like a modern chatbot while rendering structured lesson content, formulas, algorithm traces, interactive graphs, tables, and charts directly inside the conversation.

**Stack:** React + Vite + TypeScript (frontend), Node.js + Express + TypeScript (backend), curated hardcoded TypeScript data, **no database**.

## Target learning areas

1. Foundations of polynomial reductions
2. Formal polynomial-time reductions and reduction proofs
3. Cook–Levin theorem
4. Approximation algorithms
5. Randomized algorithms

## Core learning loop

Choose a topic → ask a question or read a lesson → submit a supported problem → inspect the verified step-by-step computation and visualization → take a quiz → receive an explanation of mistakes → practice again.

## Functional requirements

- **FR-1:** Chatbot-first interface with starter prompts, topic selector, learning-level selector, and a usable message composer.
- **FR-2:** All five topics have curated learning material: objectives, prerequisites, intuition, formal statement, key terms, notation, worked example, visualization, analysis, misconceptions, summary, practice, references.
- **FR-3:** Deterministic solvers compute and return structured traces for: Independent Set → Vertex Cover reduction, Cook–Levin tableau encoding (bounded), 2-approximation Vertex Cover, randomized Max-Cut (seeded).
- **FR-4:** Chat messages render multiple content blocks: text, math, callout, graph, table, chart, algorithm trace, quiz, source reference.
- **FR-5:** Five-question quizzes with deterministic backend grading, per-question rationales, hints, and retry.
- **FR-6:** Mobile-responsive layout verified at 320 CSS pixels and typical phone/tablet/desktop widths.
- **FR-7:** Loading, empty, error, timeout, AI-disabled, and retry states.
- **FR-8:** Privacy notice disclosing session-only storage, AI provider transmission, and no database.

## Non-functional requirements

- **NFR-1:** No PostgreSQL or any database. Curated data lives in typed static modules.
- **NFR-2:** API keys only in backend environment variables; never in frontend bundles, source control, logs, or responses.
- **NFR-3:** All inbound data validated (Zod); all provider output validated and treated as untrusted.
- **NFR-4:** Request-size limits, timeouts, and rate limiting on AI routes.
- **NFR-5:** Stable error responses without stack traces in production.
- **NFR-6:** WCAG 2.2 AA targets: semantic headings, visible focus, keyboard navigation, 44px touch targets, reduced-motion support, non-color-dependent graph states.

## AI provider requirements

- Provider-neutral interface: `TutorProvider.generateReply(context)`.
- `CuratedFallbackProvider` always available; `GeminiTutorProvider` only when the compliance gate passes.
- Gemini API terms (verified 2026-10-16, effective 2026-03-23): users must be 18+; API clients must not be directed at or likely accessed by under-18 individuals. For a student audience, Gemini remains **disabled** by default.
- If enabled: official Google Gen AI SDK, configurable model via `GEMINI_MODEL`, server-side key, timeouts, bounded I/O, schema-validated output, no raw HTML, graceful fallback on failure.

## Out of scope (MVP)

- User accounts, login, cross-device progress sync.
- Classroom management, instructor dashboard.
- Greedy Set Cover, randomized Quicksort (noted as future scope).
- General-purpose Cook–Levin translator for arbitrary Turing machines (the app implements a bounded, fixed-machine illustration).
- Database-backed persistence of any kind.
