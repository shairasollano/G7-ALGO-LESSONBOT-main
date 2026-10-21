# AlgoTutor AI

An AI-assisted learning web app that teaches algorithms and theoretical computer science. Chatbot-first interface with curated lessons, deterministic algorithm solvers, interactive visualizations, and quizzes with deterministic grading.

**Stack:** React + Vite + TypeScript (frontend), Node.js + Express + TypeScript (backend), curated hardcoded data, **no database**.

## Project structure

```
G7-ALGO-LESSONBOT/
├── client/                  # React + Vite frontend
│   ├── src/
│   │   ├── api/             # Typed API client
│   │   ├── components/      # Chat, blocks, visualizations
│   │   └── styles.css
│   ├── vite.config.ts
│   └── package.json
├── server/                  # Express + TypeScript backend
│   ├── src/
│   │   ├── routes/          # API endpoints
│   │   ├── services/        # AI providers, solvers, quizzes
│   │   ├── data/            # Curated topics and quiz bank
│   │   ├── schemas/         # Zod validation
│   │   └── middleware/      # Rate limiting, error handling
│   ├── tests/               # Vitest test suites
│   └── package.json
├── shared/                  # Shared TypeScript contract
│   └── contract.ts
├── docs/                    # Documentation
├── .env.example
└── package.json             # Root scripts
```

## Quick start

### Prerequisites

- Node.js 22+ and npm 10+

### Install dependencies

```bash
npm run install:all
```

### Configure environment

```bash
cp .env.example .env
# Edit .env with your values (all have safe defaults for local development)
```

### Run in development

```bash
# Terminal 1 — backend on http://localhost:3001
npm run dev:server

# Terminal 2 — frontend on http://localhost:5173
npm run dev:client
```

The Vite dev server proxies `/api` to the backend, so the frontend works with no additional configuration.

### Run tests

```bash
npm test
```

### Build for production

```bash
npm run build
```

## API endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Service health (no secrets) |
| GET | `/api/topics` | List all five topics |
| GET | `/api/topics/:slug` | Full lesson for a topic |
| POST | `/api/tutor/chat` | Chat with the tutor (returns content blocks) |
| POST | `/api/problems/solve` | Run a deterministic solver |
| POST | `/api/quizzes/generate` | Generate a quiz (answer keys stay server-side) |
| POST | `/api/quizzes/grade` | Grade a quiz submission |

## AI provider

The app uses a **curated fallback** tutor by default — fully functional offline, no API key required.

A **Gemini adapter** exists but is **disabled by default**. The Gemini API Additional Terms require users to be 18+ and prohibit API clients directed at or likely accessed by individuals under 18. Enabling Gemini requires:

1. `AI_PROVIDER=gemini`
2. `GEMINI_API_KEY` set to a valid key
3. `GEMINI_AUDIENCE_COMPLIANCE_ATTESTED=true` — explicit owner attestation that the audience and terms gate has been reviewed

**The intended audience for this app has not been formally assessed against the current Gemini API terms. Do not enable Gemini until that assessment is complete.**

## Deployment

### Architecture

The app uses a **split deployment**: the frontend is a static site and the backend is a Node.js API server. They can be hosted separately or behind the same reverse proxy.

### Frontend deployment

The frontend is built to `client/dist/`. Serve it with any static file server (nginx, Vercel, Netlify, GitHub Pages, etc.).

**Required build-time environment variable:**

| Variable | Description |
|---|---|
| `VITE_API_BASE_URL` | The API origin (e.g. `https://api.example.com`). Leave empty for same-origin deployment. |

**Build:**

```bash
cd client
VITE_API_BASE_URL=https://api.example.com npm run build
```

The `VITE_API_BASE_URL` value is baked into the production bundle at build time. It is never read at runtime and never exposed in the browser's network tab.

### Backend deployment

The backend is a standard Node.js app. Deploy it to any Node.js host (Vercel, Railway, Render, a VPS, etc.).

**Required environment variables:**

| Variable | Description |
|---|---|
| `PORT` | Port to listen on (default: 3001) |
| `CLIENT_ORIGIN` | Comma-separated allowed CORS origins (the frontend origin) |
| `AI_PROVIDER` | `curated` (default) or `gemini` (only if compliance gate is satisfied) |

**Run:**

```bash
cd server
npm install
npm run build
npm start
```

### CORS configuration

Set `CLIENT_ORIGIN` to the actual frontend origin(s). For example:

```
CLIENT_ORIGIN=https://algotutor.example.com
```

Multiple origins can be comma-separated:

```
CLIENT_ORIGIN=https://algotutor.example.com,https://www.algotutor.example.com
```

### Same-origin deployment (optional)

If you prefer to serve both the frontend and backend from the same origin, you can:

1. Build the frontend: `cd client && npm run build`
2. Copy `client/dist/` to a location the Express server can serve
3. Add `express.static()` to `server/src/app.ts` to serve the static files
4. Set `CLIENT_ORIGIN` to the same origin

This is optional — the split deployment works without any code changes.

## Environment variables

See `.env.example` for the full list with descriptions.

**Server-side (runtime):**

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | Environment mode |
| `PORT` | `3001` | Server port |
| `CLIENT_ORIGIN` | `http://localhost:5173` | Allowed CORS origins |
| `AI_PROVIDER` | `curated` | AI provider selection |
| `GEMINI_API_KEY` | (empty) | Gemini API key (server-side only) |
| `GEMINI_MODEL` | `gemini-2.0-flash` | Gemini model ID |
| `GEMINI_AUDIENCE_COMPLIANCE_ATTESTED` | (empty) | Owner attestation for Gemini compliance |

**Client-side (build-time only):**

| Variable | Default | Description |
|---|---|---|
| `VITE_API_BASE_URL` | (empty) | API origin for production. Empty = same-origin (dev proxy). |

## Testing

```bash
# All tests
npm test

# Server only
npm --prefix server test

# Client only
npm --prefix client test
```

## Documentation

- [Requirements](docs/requirements.md)
- [Algorithm specifications](docs/algorithm-specifications.md)
- [API contracts](docs/api-contracts.md)
- [Responsive QA](docs/responsive-qa.md)
- [Test cases](docs/test-cases.md)

## License

This is a student project. See the repository for details.
