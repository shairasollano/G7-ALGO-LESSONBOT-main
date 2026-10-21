# Algorithm Specifications

All solvers are deterministic TypeScript implementations in `server/src/services/algorithms/`. They validate input, compute every state transition, and return a full structured trace. The AI explanation layer never overwrites computed values.

## 1. Independent Set ≤p Vertex Cover (`reduction-is-to-vc`)

**Input:** graph `(V, E)`, parameter `k`.
**Transformation:** `f(G, k) = (G, n − k)` where `n = |V|`.
**Correctness:** `S` is an independent set ⟺ `V ∖ S` is a vertex cover (exact complement duality). Hence `G` has an independent set of size ≥ `k` ⟺ `G` has a vertex cover of size ≤ `n − k`. Both directions proved in the trace.
**Complexity:** `O(n + m)` time, `O(n + m)` space.
**Witness check:** for `n ≤ 16`, brute-forces an independent set and verifies its complement touches every edge.
**Limits:** ≤ 24 vertices, ≤ 120 edges.

## 2. Cook–Levin Tableau Encoding (`cook-levin-tableau`) — bounded illustration

**Input:** one fixed tiny NTM (≤ 4 states, ≤ 3 symbols), input word (1–4 symbols), step bound `T` (1–5).
**Construction:** variables `x(t,h,s)` ("cell h at time t contains symbol s") and `q(t,h,r)` ("head at cell h at time t in state r"). Clauses:
- **Initial configuration:** row 0 spells the input with blanks; head at cell 0 in the start state.
- **Accepting condition:** at least one `q(t, ·, qacc)` is true.
- **Local 2×3-window consistency:** for each adjacent row pair and center cell, every window matching no legal transition and not a head-free identity is forbidden.
**Output:** exact variable and clause counts, valid/forbidden window counts, tableau dimensions.
**Complexity:** `O(T² · |Σ|³ · |Q|³)` clause generation.
**Limitation:** bounded pedagogical illustration for one fixed machine — **not** a general-purpose translator for arbitrary Turing machines.

## 3. 2-Approximation Vertex Cover (`vertex-cover-2approx`)

**Input:** graph `(V, E)`.
**Algorithm:** while uncovered edges remain, pick the first uncovered edge (sorted order) and add both endpoints to the cover; mark all incident edges covered.
**Guarantee:** the picked edges form a matching `M`; any cover needs ≥ 1 vertex per picked edge, so `OPT ≥ |M|` and `|C| = 2|M| ≤ 2·OPT`.
**Complexity:** `O(n + m)` time, `O(n + m)` space.
**Limits:** ≤ 24 vertices, ≤ 120 edges.

## 4. Randomized Max-Cut (`randomized-max-cut`)

**Input:** graph `(V, E)`, seed, trial count.
**Algorithm:** each trial assigns every vertex to side A or B with probability 1/2 using a seeded mulberry32 generator; count cut edges.
**Expectation:** `E[cut] = m/2 ≥ OPT/2` by linearity of expectation (no independence needed).
**Output:** per-trial assignments and cut values, running average, best/worst, theoretical expectation, seed.
**Limits:** ≤ 24 vertices, ≤ 120 edges, ≤ 50 trials, seed in `[0, 2³²−1]`.
**Disclosure:** a fixed seed shows one reproducible run, not all possible runs.

## Shared validation

All solvers validate: unique vertex ids, valid edge endpoints, no malformed pairs, no duplicate edges, parameter ranges, and input size limits. Invalid input raises `ValidationError` with a stable code mapped to HTTP 400/422.
