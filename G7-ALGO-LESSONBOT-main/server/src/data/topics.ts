/**
 * Curated topic catalog for AlgoTutor AI.
 *
 * All lesson content is hardcoded, typed, and human-reviewed. No database.
 * Content is educational material written for this app; references point to
 * standard textbooks (not fabricated course approvals).
 */
import type { TopicDetail } from "../../../shared/contract.js";

export const topics: TopicDetail[] = [
  // ------------------------------------------------------------------
  {
    slug: "polynomial-reductions",
    title: "Foundations of Polynomial Reductions",
    description:
      "Translating one problem into another",
    objectives: [
      "Define a decision problem, an instance, and a YES/NO answer.",
      "Explain what a polynomial-time transformation between problems is.",
      "Distinguish solving a problem from reducing it to another problem.",
      "State why preserving the YES/NO answer makes a reduction useful.",
    ],
    prerequisites: [
      "Basic set notation (elements, subsets).",
      "Familiarity with graphs (vertices and edges) as examples of problem instances.",
      "Big-O intuition: what 'polynomial time' roughly means.",
    ],
    readinessQuestions: [
      "Is 'does this graph contain a triangle?' a decision problem? Why or why not?",
      "If I hand you an instance of problem A and a rule to convert it into an instance of problem B, what would you need to know before trusting the conversion?",
    ],
    intuition:
      "Imagine you do not know how to solve a puzzle, but you do know how to turn it into a different puzzle that a friend can solve. If the conversion always keeps the answer the same — a YES stays a YES and a NO stays a NO — then your friend's solution also solves your puzzle. A reduction is exactly this: a reliable translation rule between problems. The analogy stops being precise when we ask how fast the translation must be: for the idea to transfer difficulty between problems, the translation itself must be cheap (polynomial time), otherwise the 'shortcut' could be slower than just solving the original problem.",
    formalStatement:
      "A decision problem A is polynomial-time reducible to a decision problem B, written A ≤p B, if there exists a polynomial-time computable function f such that for every instance x of A: x ∈ A if and only if f(x) ∈ B. The function f is called a polynomial-time many-one reduction (or Karp reduction).",
    keyTerms: [
      { term: "Decision problem", definition: "A problem whose answer is YES or NO for each input instance." },
      { term: "Instance", definition: "One concrete input to a problem, such as a specific graph or formula." },
      { term: "YES instance / NO instance", definition: "An instance whose correct answer is YES (respectively NO)." },
      { term: "Polynomial-time computable", definition: "Computable by an algorithm whose running time is bounded by a polynomial in the input size." },
      { term: "Reduction", definition: "A transformation f that maps instances of problem A to instances of problem B while preserving the answer." },
    ],
    notation: [
      { symbol: "A ≤p B", meaning: "Problem A reduces to problem B in polynomial time (A is 'no harder than' B, up to polynomial factors)." },
      { symbol: "x ∈ A", meaning: "Instance x is a YES instance of problem A." },
      { symbol: "f(x)", meaning: "The instance of B obtained by applying the reduction f to instance x of A." },
    ],
    workedExample: {
      title: "Independent Set becomes Vertex Cover",
      input:
        "Graph G with vertices {A, B, C, D} and edges AB, BC, CD. Question (Independent Set): is there a set of 2 vertices with no edge between them?",
      steps: [
        "The reduction keeps the same graph: f(G, k) = (G, n − k) where n = |V|.",
        "Here n = 4 and k = 2, so the Vertex Cover instance asks: is there a vertex cover of size 4 − 2 = 2?",
        "Answer preservation: a set S of vertices has no edge inside it exactly when every edge touches V ∖ S, i.e. V ∖ S is a vertex cover.",
        "So G has an independent set of size ≥ k exactly when G has a vertex cover of size ≤ n − k.",
      ],
      result:
        "The YES/NO answer is preserved by the transformation, and the transformation (copy the graph, subtract k from n) takes polynomial time.",
    },
    visualization: {
      kind: "graph",
      description:
        "The same graph shown twice: once with an independent set highlighted (no edges inside), once with the complementary vertex cover highlighted (every edge touched).",
    },
    analysis:
      "The transformation f(G, k) = (G, n − k) runs in O(n + m) time: copying the graph and computing n − k are both linear. Because the reduction is polynomial-time, a polynomial-time algorithm for Vertex Cover would immediately give a polynomial-time algorithm for Independent Set.",
    misconceptions: [
      {
        myth: "A reduction solves the problem.",
        correction:
          "A reduction only translates the problem. You still need an algorithm for the target problem B to get an answer for A.",
      },
      {
        myth: "Any conversion between problems counts as a reduction.",
        correction:
          "The conversion must run in polynomial time AND preserve the YES/NO answer in both directions. A conversion that takes exponential time does not transfer polynomial-time solvability.",
      },
      {
        myth: "A ≤p B means A and B are the same problem.",
        correction:
          "They are different problems; the reduction only shows A is no harder than B (up to polynomial factors).",
      },
    ],
    summary:
      "A polynomial reduction is a fast, answer-preserving translation from one decision problem to another. It lets us compare the difficulty of problems without solving them.",
    furtherPractice: [
      "Show that if A ≤p B and B ≤p C, then A ≤p C (hint: compose the two transformations).",
      "Convince yourself that the reduction f(G, k) = (G, n − k) really does preserve NO instances, not just YES instances.",
    ],
    relatedTopics: ["formal-reductions", "cook-levin"],
    references: [
      {
        title: "Introduction to Algorithms (CLRS), Chapter 34 — NP-Completeness",
        note: "Standard textbook treatment of polynomial-time reductions.",
      },
    ],
  },
  // ------------------------------------------------------------------
  {
    slug: "formal-reductions",
    title: "Formal Polynomial-Time Reductions",
    description:
      "Definitions, correctness, and proof",
    objectives: [
      "State the formal definition of A ≤p B with the transformation f.",
      "Prove correctness of a reduction in both directions of the iff.",
      "Carry out the Independent Set ≤p Vertex Cover reduction with parameter mapping.",
      "Explain how a reduction from a known-hard problem establishes NP-hardness.",
    ],
    prerequisites: [
      "Decision problems, instances, and YES/NO answers (Topic 1).",
      "Basic proof structure: proving an 'if and only if' by proving both directions.",
    ],
    readinessQuestions: [
      "In the statement 'x ∈ A if and only if f(x) ∈ B', what are the two directions you must prove?",
      "Why must f be computable in polynomial time for the reduction to be useful?",
    ],
    intuition:
      "A formal reduction is a contract: (1) the translation f must be fast — polynomial time; (2) the translation must be faithful — x is a YES instance of A exactly when f(x) is a YES instance of B. Condition (2) is an 'if and only if', so a proof has two halves: every YES of A becomes a YES of B, and every NO of A becomes a NO of B (equivalently, YES of B pulls back to YES of A). Once the contract holds, any solver for B automatically solves A: translate, solve, read off the answer.",
    formalStatement:
      "A ≤p B iff there exists a function f, computable in time polynomial in |x|, such that for all instances x: x ∈ A ⟺ f(x) ∈ B. Correctness requires proving both directions: (⇒) x ∈ A implies f(x) ∈ B, and (⇐) f(x) ∈ B implies x ∈ A. If A ≤p B and B ∈ P, then A ∈ P. If A is NP-hard and A ≤p B, then B is NP-hard.",
    keyTerms: [
      { term: "Many-one reduction", definition: "A reduction that maps each instance of A to exactly one instance of B (also called a Karp reduction)." },
      { term: "Transformation f", definition: "The polynomial-time computable function producing f(x) from x." },
      { term: "Parameter mapping", definition: "How the numerical parameter of the source instance (e.g. k) is converted for the target instance (e.g. n − k)." },
      { term: "NP-hard", definition: "A problem to which every problem in NP reduces in polynomial time." },
    ],
    notation: [
      { symbol: "A ≤p B", meaning: "A is polynomial-time reducible to B." },
      { symbol: "x ∈ A ⟺ f(x) ∈ B", meaning: "The correctness condition: answer preservation in both directions." },
      { symbol: "f : instances(A) → instances(B)", meaning: "The reduction as a function between instance sets." },
    ],
    workedExample: {
      title: "Independent Set ≤p Vertex Cover, formally",
      input:
        "Instance of Independent Set: graph G = (V, E) with |V| = n, and integer k. Question: does G contain an independent set of size ≥ k?",
      steps: [
        "Define f(G, k) = (G, n − k): same graph, target parameter n − k for Vertex Cover.",
        "Direction (⇒): suppose S ⊆ V is an independent set with |S| ≥ k. Then no edge has both endpoints in S, so every edge has at least one endpoint in V ∖ S. Hence V ∖ S is a vertex cover, and |V ∖ S| = n − |S| ≤ n − k. So f(G, k) is a YES instance of Vertex Cover.",
        "Direction (⇐): suppose C ⊆ V is a vertex cover with |C| ≤ n − k. Then no edge has both endpoints outside C, so V ∖ C is an independent set, and |V ∖ C| = n − |C| ≥ k. So (G, k) is a YES instance of Independent Set.",
        "Complexity of f: copying G and computing n − k takes O(n + m) time — polynomial.",
      ],
      result:
        "Both directions hold and f is polynomial-time computable, so Independent Set ≤p Vertex Cover. Since Vertex Cover is NP-complete, this also shows Independent Set is NP-hard (it is in NP, hence NP-complete).",
    },
    visualization: {
      kind: "graph",
      description:
        "Side-by-side: the original instance (G, k) and the transformed instance (G, n − k), with an independent set and its complementary vertex cover highlighted to show the correspondence.",
    },
    analysis:
      "The transformation runs in O(n + m) time and O(n + m) space. The correctness proof is a two-direction iff argument; the key combinatorial fact is the complement duality: S is independent ⟺ V ∖ S is a vertex cover. This duality is exact — no approximation is involved.",
    misconceptions: [
      {
        myth: "To prove A ≤p B it suffices to show YES instances of A map to YES instances of B.",
        correction:
          "You must also show NO instances map to NO instances (the ⇐ direction). Without it, f could map everything to YES and the reduction would be useless.",
      },
      {
        myth: "Independent Set ≤p Vertex Cover means Vertex Cover is easier.",
        correction:
          "The direction matters: it shows Independent Set is no harder than Vertex Cover. The reduction does not say anything about Vertex Cover being easier.",
      },
      {
        myth: "The reduction changes the graph structure.",
        correction:
          "Here f keeps the same graph and only changes the parameter (k ↦ n − k). Reductions may keep, shrink, or grow the instance — only the answer preservation and polynomial time matter.",
      },
    ],
    summary:
      "A formal reduction is a polynomial-time, answer-preserving transformation with a two-direction correctness proof. The Independent Set → Vertex Cover reduction uses the complement duality S independent ⟺ V ∖ S a vertex cover, with parameter mapping k ↦ n − k.",
    furtherPractice: [
      "Prove the complement duality from scratch: S independent ⟺ V ∖ S is a vertex cover.",
      "If someone claims f(G, k) = (G, k) reduces Independent Set to Vertex Cover, find the flaw (the parameter must change).",
    ],
    relatedTopics: ["polynomial-reductions", "cook-levin", "approximation-algorithms"],
    references: [
      {
        title: "Introduction to Algorithms (CLRS), Chapter 34 — NP-Completeness",
        note: "Formal reduction proofs including Independent Set and Vertex Cover.",
      },
    ],
  },
  // ------------------------------------------------------------------
  {
    slug: "cook-levin",
    title: "The Cook–Levin Theorem",
    description:
      "How computation becomes a Boolean formula",
    objectives: [
      "Define SAT, NP, NP-hardness, and NP-completeness before using them.",
      "Explain the high-level idea of the Cook–Levin construction.",
      "Describe the tableau encoding: cells, variables, local constraints, accepting condition.",
      "State precisely what the bounded illustration does and does not prove.",
    ],
    prerequisites: [
      "Boolean variables, clauses, and what it means for a formula to be satisfiable.",
      "The notion of a nondeterministic Turing machine and an accepting computation.",
      "NP and NP-hardness (Topics 1–2).",
    ],
    readinessQuestions: [
      "What is the difference between a problem being in NP and being NP-complete?",
      "If you wanted to describe a computation as data, what would you record at each step?",
    ],
    intuition:
      "A nondeterministic Turing machine's accepting computation is just a sequence of configurations (snapshots). Write the whole sequence as a grid — a tableau — where each row is one configuration. Now build a Boolean variable for 'cell h at time t contains symbol s' (and for 'the head is at cell h at time t in state q'). The computation is accepting exactly when: the first row is the input configuration, every 2×3 window of adjacent rows follows a legal transition (or is a no-head identity), and some row contains the accepting state. Each of these conditions is a small set of clauses, so 'the machine accepts within T steps' becomes 'this CNF formula is satisfiable'. The bounded demo in this app builds exactly this encoding for one fixed tiny machine — it is a genuine (bounded) instance of the construction, not a general-purpose translator for arbitrary machines.",
    formalStatement:
      "Cook–Levin Theorem: SAT is NP-complete. Sketch: SAT is in NP (a satisfying assignment is a polynomial-size certificate). For NP-hardness, let L ∈ NP via a nondeterministic Turing machine M running in time p(n). For each input x, construct in polynomial time a Boolean formula φx that is satisfiable iff M accepts x within p(|x|) steps. φx encodes the (p(|x|) + 1) × (2p(|x|) + 1) tableau: variables for cell contents and head/state positions, clauses for the initial configuration, the accepting condition, and local 2×3-window transition consistency. Hence every problem in NP reduces to SAT, so SAT is NP-complete.",
    keyTerms: [
      { term: "SAT", definition: "The decision problem: given a Boolean formula in CNF, is there a truth assignment that makes it true?" },
      { term: "NP", definition: "The class of decision problems for which a YES answer has a polynomial-size certificate checkable in polynomial time." },
      { term: "NP-hard", definition: "A problem to which every problem in NP polynomial-time reduces." },
      { term: "NP-complete", definition: "A problem that is in NP and is NP-hard." },
      { term: "Tableau", definition: "The grid of configurations: rows are time steps, columns are tape cells." },
      { term: "Window constraint", definition: "The local consistency condition on each 2×3 block of adjacent tableau rows." },
    ],
    notation: [
      { symbol: "φx", meaning: "The CNF formula built from input x; satisfiable iff the machine accepts x." },
      { symbol: "x(t, h, s)", meaning: "Variable: at time t, tape cell h contains symbol s." },
      { symbol: "q(t, h, q)", meaning: "Variable: at time t, the head scans cell h in state q." },
      { symbol: "T", meaning: "The polynomial step bound of the machine's accepting computation." },
    ],
    workedExample: {
      title: "A bounded tableau illustration",
      input:
        "A fixed tiny machine: states {q0, q1, qacc}, alphabet {0, 1, _}, input '01', step bound T = 3. The machine starts in q0 scanning the leftmost symbol.",
      steps: [
        "Build the tableau grid: T + 1 = 4 rows (times 0..3) and enough tape columns for the head to move within the bound.",
        "Create variables x(t, h, s) for every time, cell, and symbol, and q(t, h, q) for head positions.",
        "Add initial-configuration clauses: row 0 spells '01' with blanks elsewhere, head at cell 0 in state q0.",
        "Add window clauses: for each adjacent row pair and each cell, forbid every 2×3 window that matches no legal transition and is not a head-free identity.",
        "Add the accepting clause: at least one q(t, ·, qacc) variable must be true.",
      ],
      result:
        "The formula is satisfiable exactly when the fixed machine accepts '01' within 3 steps. The app computes the exact variable and clause counts for this bounded instance.",
    },
    visualization: {
      kind: "table",
      description:
        "The tableau grid with the machine's actual accepting run, plus a table of the generated variables and clause groups.",
    },
    analysis:
      "The construction is polynomial: the tableau has O(T²) cells, so φx has O(T² · |Σ|) variables and O(T² · |Σ|³ · |Q|³) clauses — polynomial in the input size because T is polynomial. The bounded illustration uses one fixed machine and small T; it demonstrates the encoding pattern but is not a general-purpose translator for arbitrary Turing machines.",
    misconceptions: [
      {
        myth: "The tableau demo proves Cook–Levin for all machines.",
        correction:
          "The demo is a bounded, fixed-machine illustration of the construction. The theorem's proof is the general argument; the app does not implement a general translator.",
      },
      {
        myth: "Cook–Levin says SAT is the hardest problem, period.",
        correction:
          "It says SAT is NP-hard and in NP, i.e. NP-complete. Problems outside NP (e.g. harder ones) are not covered by the theorem.",
      },
      {
        myth: "The formula simulates the machine step by step at runtime.",
        correction:
          "The formula only encodes the existence of an accepting tableau; a SAT solver finds an assignment, which can then be read back as a computation.",
      },
    ],
    summary:
      "Cook–Levin: every NP computation can be encoded as a SAT instance via a tableau of configurations with local transition constraints, so SAT is NP-complete. The app's bounded demo builds this encoding for one fixed tiny machine.",
    furtherPractice: [
      "Write out the initial-configuration clauses for a 2-cell tape by hand.",
      "Why must the window be 2×3 (two rows, three columns) rather than 1×1?",
    ],
    relatedTopics: ["formal-reductions"],
    references: [
      {
        title: "Introduction to Algorithms (CLRS), Chapter 34.4 — NP-completeness proofs",
        note: "Standard proof of the Cook–Levin theorem.",
      },
      {
        title: "Sipser, Introduction to the Theory of Computation, Chapter 7",
        note: "Alternative treatment of the tableau construction.",
      },
    ],
  },
  // ------------------------------------------------------------------
  {
    slug: "approximation-algorithms",
    title: "Approximation Algorithms",
    description:
      "Finding near-optimal solutions",
    objectives: [
      "Distinguish optimization problems from decision problems.",
      "Define feasible solution, objective value, and approximation ratio.",
      "Trace the 2-approximation Vertex Cover algorithm step by step.",
      "Explain why the selected edges form a matching and how that yields the 2-approximation guarantee.",
    ],
    prerequisites: [
      "Graphs: vertices, edges, vertex covers.",
      "Big-O notation.",
      "The decision version of Vertex Cover (Topics 1–2).",
    ],
    readinessQuestions: [
      "What is the difference between 'find a minimum vertex cover' and 'is there a vertex cover of size ≤ k?'",
      "If an algorithm always returns a solution at most twice the optimum, what is its approximation ratio?",
    ],
    intuition:
      "Finding a minimum vertex cover exactly is NP-hard, so for large graphs we settle for a guarantee: a solution whose size is provably within a factor of the best possible. The classic 2-approximation is beautifully simple: while some edge is uncovered, pick that edge and throw both of its endpoints into the cover. The edges you pick can never share a vertex (once picked, all their incident edges are covered), so they form a matching. Any vertex cover — including the optimal one — must contain at least one endpoint of each picked edge, and since the picked edges are disjoint, it needs at least one vertex per picked edge. The algorithm uses two vertices per picked edge, so it uses at most twice the optimum.",
    formalStatement:
      "Approximation algorithm with ratio ρ(n): for every input of size n, the algorithm returns a feasible solution whose objective value is within a factor ρ(n) of the optimal value (for minimization: ALG ≤ ρ(n) · OPT). Vertex Cover 2-approximation: while E' ≠ ∅, choose any edge (u, v) ∈ E', add u and v to C, and remove from E' every edge incident to u or v. Then C is a vertex cover with |C| ≤ 2 · OPT.",
    keyTerms: [
      { term: "Optimization problem", definition: "A problem whose goal is to find a feasible solution that minimizes or maximizes an objective value." },
      { term: "Feasible solution", definition: "A solution that satisfies all constraints (e.g. a set of vertices touching every edge)." },
      { term: "Approximation ratio", definition: "The worst-case factor ρ by which the algorithm's solution exceeds the optimum (minimization)." },
      { term: "Worst-case guarantee", definition: "A bound that holds for every input, not just on average." },
      { term: "Matching", definition: "A set of edges no two of which share a vertex." },
    ],
    notation: [
      { symbol: "OPT", meaning: "The objective value of an optimal solution." },
      { symbol: "ALG", meaning: "The objective value of the algorithm's solution." },
      { symbol: "ρ", meaning: "The approximation ratio; here ρ = 2." },
      { symbol: "C", meaning: "The cover being built." },
    ],
    workedExample: {
      title: "2-approximation on a path of 4 vertices",
      input: "Graph: vertices A, B, C, D; edges AB, BC, CD (a path).",
      steps: [
        "Step 1: uncovered edges {AB, BC, CD}. Pick AB; add A and B to the cover. Covered edges: AB, BC. Remaining uncovered: {CD}.",
        "Step 2: pick CD; add C and D. All edges covered. Stop.",
        "The picked edges AB and CD share no vertex — they form a matching of size 2.",
        "Any vertex cover needs ≥ 1 endpoint of AB and ≥ 1 endpoint of CD, so OPT ≥ 2. The algorithm returned |C| = 4 ≤ 2 · 2.",
      ],
      result: "Cover {A, B, C, D} of size 4, within factor 2 of the optimum (OPT = 2, e.g. {B, C}).",
    },
    visualization: {
      kind: "graph",
      description:
        "The graph at each step: the active edge highlighted, chosen vertices marked, covered vs uncovered edges distinguished by more than color (labels/line styles).",
    },
    analysis:
      "Time: O(n + m) — each edge is examined when covered, and each vertex enters the cover once. Space: O(n + m). Guarantee: the picked edges form a matching M; OPT ≥ |M| (each needs a distinct vertex), and |C| = 2|M|, so |C| ≤ 2·OPT. This is a worst-case guarantee, not a claim of optimality.",
    misconceptions: [
      {
        myth: "A 2-approximation returns the optimal solution twice.",
        correction:
          "It returns a solution at most twice the optimum — sometimes better, never worse than 2·OPT. On the path example it returns 4 where OPT = 2.",
      },
      {
        myth: "The guarantee means the answer is always within a factor of 2 on every run.",
        correction:
          "The guarantee is about the worst case over all inputs; on many inputs the algorithm does better than 2·OPT.",
      },
      {
        myth: "Picking edges in a different order breaks the guarantee.",
        correction:
          "Any order works: the picked edges always form a matching, which is all the proof needs.",
      },
    ],
    summary:
      "The 2-approximation Vertex Cover algorithm repeatedly covers an uncovered edge with both endpoints. The picked edges form a matching, so the cover is at most twice the optimum — a polynomial-time worst-case guarantee for an NP-hard problem.",
    furtherPractice: [
      "Run the algorithm on a star graph (one center, many leaves). What does it return, and what is OPT?",
      "Show that the matching lower bound OPT ≥ |M| fails if the picked edges are allowed to share a vertex.",
    ],
    relatedTopics: ["formal-reductions", "randomized-algorithms"],
    references: [
      {
        title: "Introduction to Algorithms (CLRS), Chapter 35 — Approximation Algorithms",
        note: "Standard treatment of the 2-approximation for Vertex Cover.",
      },
    ],
  },
  // ------------------------------------------------------------------
  {
    slug: "randomized-algorithms",
    title: "Randomized Algorithms",
    description:
      "Using randomness to solve problems",
    objectives: [
      "Explain how randomness can be part of an algorithm's logic.",
      "Distinguish Monte Carlo algorithms (bounded time, bounded error) from Las Vegas algorithms (random time, always correct).",
      "Compute the expected cut value of a random Max-Cut assignment.",
      "Interpret seeded, reproducible trials and their statistics honestly.",
    ],
    prerequisites: [
      "Basic probability: expectation of a sum of indicator variables.",
      "Graphs and the definition of a cut.",
      "Big-O notation.",
    ],
    readinessQuestions: [
      "If each edge is cut with probability 1/2, what is the expected number of cut edges in a graph with m edges?",
      "What is the difference between 'the algorithm is always fast but sometimes wrong' and 'the algorithm is always correct but sometimes slow'?",
    ],
    intuition:
      "Randomized Max-Cut is the simplest randomized algorithm there is: flip a fair coin for each vertex to decide which side of the cut it lands on. Each edge then has exactly a 1/2 chance of having its endpoints on different sides, so the expected cut size is m/2 — and since OPT ≤ m, the expected value is at least half the optimum. A fixed seed makes the coin flips reproducible: the same seed always produces the same sequence of trials. That reproducibility is a teaching tool, not a proof about all runs — different seeds give different sequences, and the expectation statement is about the average over all 2^n assignments.",
    formalStatement:
      "Randomized Max-Cut: assign each vertex independently to side A or side B with probability 1/2 each. For each edge e, let Xe be the indicator that e is cut; E[Xe] = 1/2. By linearity of expectation, E[cut] = Σe E[Xe] = m/2. Since OPT ≤ m, E[cut] ≥ OPT/2: the algorithm is a 1/2-approximation in expectation. Monte Carlo: bounded running time with a bounded probability of error. Las Vegas: always correct, running time is a random variable.",
    keyTerms: [
      { term: "Randomized algorithm", definition: "An algorithm whose behavior depends on random choices made during execution." },
      { term: "Expected value", definition: "The average over all random choices, weighted by probability." },
      { term: "Monte Carlo", definition: "Bounded running time; the answer may be wrong with some bounded probability." },
      { term: "Las Vegas", definition: "Always correct; the running time is random." },
      { term: "Seed", definition: "The initial value of a pseudorandom generator; fixing it makes the run reproducible." },
    ],
    notation: [
      { symbol: "Xe", meaning: "Indicator variable: 1 if edge e is cut, else 0." },
      { symbol: "E[cut]", meaning: "Expected number of cut edges = m/2." },
      { symbol: "m", meaning: "Number of edges." },
      { symbol: "seed", meaning: "Fixed starting value for the pseudorandom generator in teaching mode." },
    ],
    workedExample: {
      title: "Seeded randomized Max-Cut demo",
      input: "Graph: vertices A, B, C, D; edges AB, AC, BC, BD, CD (5 edges). Seed fixed for reproducibility.",
      steps: [
        "Trial 1: coin flips assign each vertex to side A or B; count the edges crossing the cut.",
        "Repeat for several trials, recording each assignment, its cut edges, and its cut value.",
        "Accumulate statistics: running average, best trial, worst trial.",
        "Compare the average with the theoretical expectation m/2 = 2.5 and with OPT ≤ m = 5.",
      ],
      result:
        "The average cut value over the seeded trials is an empirical estimate of E[cut] = m/2. The best trial found is a concrete cut; the expectation statement is about all 2^n assignments, not just the seeded ones.",
    },
    visualization: {
      kind: "chart",
      description:
        "Bar chart of each trial's cut value with the theoretical expectation line, plus the graph with the best cut's two sides distinguished by shape as well as color.",
    },
    analysis:
      "Time per trial: O(n + m). Space: O(n + m). The expectation E[cut] = m/2 follows from linearity of expectation — no independence needed between edges. The seeded demo shows one reproducible sequence of trials; it does not show all possible runs, and the empirical average over a few trials need not equal m/2 exactly.",
    misconceptions: [
      {
        myth: "A fixed seed proves the algorithm always achieves m/2.",
        correction:
          "A seed makes one sequence reproducible. The expectation m/2 is over all 2^n assignments; individual trials vary around it.",
      },
      {
        myth: "Randomized Max-Cut is a Las Vegas algorithm.",
        correction:
          "The basic version is Monte Carlo-flavored: one trial gives a cut whose quality is random. Repeating and keeping the best improves the empirical result but the per-trial guarantee is the expectation.",
      },
      {
        myth: "The coin flips must be truly random.",
        correction:
          "Any independent 1/2-probability source works; a seeded pseudorandom generator is used here so the teaching demo is reproducible.",
      },
    ],
    summary:
      "Randomized Max-Cut assigns each vertex a random side; each edge is cut with probability 1/2, so E[cut] = m/2 ≥ OPT/2. The seeded demo makes trials reproducible while making clear that one seed shows one run, not all runs.",
    furtherPractice: [
      "Compute E[cut] for a triangle (m = 3) and list all 8 assignments to verify.",
      "Design a Las Vegas version of a simple randomized algorithm and contrast it with a Monte Carlo one.",
    ],
    relatedTopics: ["approximation-algorithms"],
    references: [
      {
        title: "Motwani & Raghavan, Randomized Algorithms, Chapter 1",
        note: "Standard treatment of Monte Carlo vs Las Vegas and randomized Max-Cut.",
      },
    ],
  },
];

export function getTopic(slug: string): TopicDetail | undefined {
  return topics.find((t) => t.slug === slug);
}

export function listTopicSummaries() {
  return topics.map(({ slug, title, description }) => ({ slug, title, description }));
}
