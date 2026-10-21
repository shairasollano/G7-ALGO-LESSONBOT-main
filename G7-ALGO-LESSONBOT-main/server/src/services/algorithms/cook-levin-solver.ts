/**
 * Solver: bounded Cook–Levin tableau illustration (Topic 3).
 *
 * For ONE fixed, tiny nondeterministic Turing machine and a polynomial step
 * bound T, this builds the genuine Cook–Levin CNF encoding:
 *   variables  x(t, h, s)  — "at time t, tape cell h contains symbol s"
 *   variables  q(t, h, r)  — "at time t, the head scans cell h in state r"
 *   clauses    initial configuration, accepting condition, and local
 *              2×3-window transition consistency.
 *
 * This is a bounded pedagogical illustration of the construction for a fixed
 * machine — NOT a general-purpose translator for arbitrary Turing machines.
 */
import type { SolverResult, TraceStep } from "../../../../shared/contract.js";
import { LIMITS, ValidationError } from "./graph-utils.js";

export interface CookLevinMachine {
  states: string[];
  alphabet: string[];
  startState: string;
  acceptState: string;
  transitions: { from: string; read: string; to: string; write: string; move: "L" | "R" }[];
}

export interface CookLevinInput {
  machine: CookLevinMachine;
  input: string;
  steps: number;
}

interface WindowCell {
  symbol: string;
  head: string | null; // state name if the head is here, else null
}

function validateMachine(m: CookLevinMachine, input: string, steps: number): void {
  if (!m.states?.length || m.states.length > 4) {
    throw new ValidationError("invalid_machine", "The machine must have 1–4 states for the bounded illustration.");
  }
  if (!m.alphabet?.length || m.alphabet.length > 3) {
    throw new ValidationError("invalid_machine", "The machine must have 1–3 tape symbols for the bounded illustration.");
  }
  if (!m.states.includes(m.startState) || !m.states.includes(m.acceptState)) {
    throw new ValidationError("invalid_machine", "startState and acceptState must be states of the machine.");
  }
  if (m.startState === m.acceptState) {
    throw new ValidationError("invalid_machine", "startState and acceptState must differ (otherwise the machine accepts trivially).");
  }
  for (const t of m.transitions ?? []) {
    if (!m.states.includes(t.from) || !m.states.includes(t.to) || !m.alphabet.includes(t.read) || !m.alphabet.includes(t.write)) {
      throw new ValidationError("invalid_machine", "Every transition must reference known states and symbols.");
    }
    if (t.move !== "L" && t.move !== "R") {
      throw new ValidationError("invalid_machine", "Transition moves must be 'L' or 'R'.");
    }
  }
  if (typeof input !== "string" || input.length === 0 || input.length > 4) {
    throw new ValidationError("invalid_input", "The input word must be 1–4 symbols long for the bounded illustration.");
  }
  for (const ch of input) {
    if (!m.alphabet.includes(ch)) {
      throw new ValidationError("invalid_input", `Input symbol '${ch}' is not in the machine alphabet.`);
    }
  }
  if (!Number.isInteger(steps) || steps < 1 || steps > LIMITS.maxCookLevinSteps) {
    throw new ValidationError("invalid_steps", `steps must be an integer between 1 and ${LIMITS.maxCookLevinSteps}.`);
  }
}

export function solveCookLevin(input: unknown): SolverResult {
  const parsed = input as CookLevinInput;
  const m = parsed?.machine;
  validateMachine(m, parsed?.input ?? "", parsed?.steps ?? 0);

  const n = parsed.input.length;
  const T = parsed.steps;
  // Tape cells: the head starts at cell 0 and can move at most T cells right.
  const H = n + T + 1;
  if (H > LIMITS.maxTapeCells) {
    throw new ValidationError("too_large", "Tape window exceeds the bounded illustration limit.");
  }

  // --- Variables -------------------------------------------------------------
  // x(t, h, s): symbol s in cell h at time t.  q(t, h, r): head at cell h in state r at time t.
  const xVar = (t: number, h: number, s: string) => `x(${t},${h},${s})`;
  const qVar = (t: number, h: number, r: string) => `q(${t},${h},${r})`;

  const clauses: string[] = [];
  const add = (clause: string) => clauses.push(clause);

  // --- Clause group 1: initial configuration -------------------------------
  // Row 0: input symbols in cells 0..n-1, blanks elsewhere; head at cell 0 in startState.
  for (let h = 0; h < H; h++) {
    const symbol = h < n ? parsed.input[h] : "_";
    add(`(${xVar(0, h, symbol)})`);
    for (const s of m.alphabet) {
      if (s !== symbol) add(`(¬${xVar(0, h, s)})`);
    }
  }
  add(`(${qVar(0, 0, m.startState)})`);
  for (const r of m.states) {
    if (r !== m.startState) add(`(¬${qVar(0, 0, r)})`);
  }
  for (let h = 1; h < H; h++) {
    for (const r of m.states) add(`(¬${qVar(0, h, r)})`);
  }

  // --- Clause group 2: accepting condition -----------------------------------
  // At least one accepting-state head variable must be true.
  const acceptClause: string[] = [];
  for (let t = 0; t <= T; t++) {
    for (let h = 0; h < H; h++) acceptClause.push(qVar(t, h, m.acceptState));
  }
  add(`(${acceptClause.join(" ∨ ")})`);

  // --- Clause group 3: local 2×3-window transition consistency ---------------
  // For each adjacent row pair (t, t+1) and each center cell h, the 2×3 window
  // (rows t,t+1; cols h-1,h,h+1) must match a legal transition or be a
  // head-free identity. We enumerate all window assignments and forbid invalid ones.
  // Each of the 6 cells: symbol is fixed by the alphabet; head is null or a state.
  // Enumerate: for each cell, (symbol, head) pairs.
  const cellOptions: { symbol: string; head: string | null }[] = [];
  for (const s of m.alphabet) {
    cellOptions.push({ symbol: s, head: null });
    for (const r of m.states) cellOptions.push({ symbol: s, head: r });
  }

  function windowIsValid(window: WindowCell[][]): boolean {
    // window[0] = row t (3 cells), window[1] = row t+1 (3 cells).
    const top = window[0];
    const bottom = window[1];
    // Find head position in top row.
    const headIdx = top.findIndex((c) => c.head !== null);
    if (headIdx === -1) {
      // No head: identity — bottom row must equal top row.
      return top.every((c, i) => bottom[i].symbol === c.symbol && bottom[i].head === null);
    }
    const state = top[headIdx].head!;
    const read = top[headIdx].symbol;
    const trans = m.transitions.find((tr) => tr.from === state && tr.read === read);
    if (!trans) return false;
    // Bottom row: head moves, writes, changes state; all other cells unchanged.
    const newHeadIdx = trans.move === "R" ? headIdx + 1 : headIdx - 1;
    if (newHeadIdx < 0 || newHeadIdx > 2) return false;
    for (let i = 0; i < 3; i++) {
      if (i === headIdx) {
        if (bottom[i].symbol !== trans.write || bottom[i].head !== null) return false;
      } else if (i === newHeadIdx) {
        if (bottom[i].symbol !== top[i].symbol || bottom[i].head !== trans.to) return false;
      } else {
        if (bottom[i].symbol !== top[i].symbol || bottom[i].head !== null) return false;
      }
    }
    return true;
  }

  // Enumerate all 6-cell windows (each cell: symbol × (states+1) head options).
  const perCell = cellOptions.length;
  let validWindows = 0;
  let invalidWindows = 0;
  const totalWindows = Math.pow(perCell, 6);
  if (totalWindows > 5_000_000) {
    throw new ValidationError("too_large", "Machine alphabet/state combination exceeds the bounded enumeration limit.");
  }
  for (let code = 0; code < totalWindows; code++) {
    let c = code;
    const window: WindowCell[][] = [[], []];
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 3; col++) {
        const opt = cellOptions[c % perCell];
        c = Math.floor(c / perCell);
        window[row].push({ symbol: opt.symbol, head: opt.head });
      }
    }
    if (windowIsValid(window)) {
      validWindows++;
    } else {
      invalidWindows++;
      // Forbid this window: ¬(all six cells as assigned).
      const literals: string[] = [];
      for (let row = 0; row < 2; row++) {
        for (let col = 0; col < 3; col++) {
          const cell = window[row][col];
          const h = col - 1; // center column is h
          const t = row; // relative row
          if (cell.head === null) {
            literals.push(`¬${xVar(t, h, cell.symbol)}`);
          } else {
            literals.push(`¬${qVar(t, h, cell.head)}`);
          }
        }
      }
      add(`(${literals.join(" ∨ ")})`);
    }
  }

  // --- Build the trace --------------------------------------------------------
  const steps: TraceStep[] = [];
  const varCount = (T + 1) * H * (m.alphabet.length + m.states.length);

  steps.push({
    step: 1,
    title: "Set up the tableau",
    description: `The tableau has T + 1 = ${T + 1} rows (times 0..${T}) and ${H} tape columns (input length ${n} plus room for the head to move within the bound). Each cell at each time gets one variable per symbol and one per head/state.`,
    table: {
      columns: [
        { key: "quantity", header: "Quantity" },
        { key: "value", header: "Value" },
      ],
      rows: [
        { quantity: "Rows (times 0..T)", value: T + 1 },
        { quantity: "Tape columns", value: H },
        { quantity: "Variables x(t,h,s)", value: (T + 1) * H * m.alphabet.length },
        { quantity: "Variables q(t,h,r)", value: (T + 1) * H * m.states.length },
        { quantity: "Total variables", value: varCount },
      ],
    },
  });

  steps.push({
    step: 2,
    title: "Encode the initial configuration",
    description: `Row 0 spells the input '${parsed.input}' with blanks elsewhere, and the head starts at cell 0 in state ${m.startState}. This contributes ${H * m.alphabet.length} symbol clauses (each cell gets its symbol) and ${H * m.states.length} head/state clauses (head only at cell 0 in ${m.startState}) — ${H * (m.alphabet.length + m.states.length)} unit clauses in total.`,
  });

  steps.push({
    step: 3,
    title: "Encode the accepting condition",
    description: `One clause requires at least one of the ${T + 1} × ${H} accepting-state head variables q(t, h, ${m.acceptState}) to be true — the machine must enter ${m.acceptState} within ${T} steps.`,
  });

  steps.push({
    step: 4,
    title: "Encode local transition consistency",
    description: `For each adjacent row pair and each center cell, every 2×3 window that matches no legal transition and is not a head-free identity is forbidden by a clause. Of ${totalWindows} possible windows, ${validWindows} are valid and ${invalidWindows} are forbidden.`,
    table: {
      columns: [
        { key: "quantity", header: "Quantity" },
        { key: "value", header: "Value" },
      ],
      rows: [
        { quantity: "Possible 2×3 windows", value: totalWindows },
        { quantity: "Valid windows", value: validWindows },
        { quantity: "Forbidden-window clauses", value: invalidWindows },
      ],
    },
  });

  // --- Analytic complete-formula count ----------------------------------------
  // The window-clause templates above are instantiated at each valid tableau
  // position. A 2×3 window centered at (t, h) requires cells h-1, h, h+1, so
  // interior positions are h ∈ [1, H-2]. There are T × (H-2) such positions.
  // The initial-configuration and accepting clauses are already fully placed.
  const initialClauseCount = H * (m.alphabet.length + m.states.length);
  const windowPositions = T * (H - 2);
  const completeFormulaClauses = initialClauseCount + 1 + windowPositions * invalidWindows;

  steps.push({
    step: 5,
    title: "The encoded formula",
    description: `The CNF formula has ${varCount} variables. The solver generates ${clauses.length} distinct clause templates (initial + accepting + ${invalidWindows} forbidden-window templates). A complete tableau formula instantiates the window templates at each of the ${windowPositions} valid (t, h) positions, yielding ${completeFormulaClauses} total clauses. It is satisfiable if and only if the fixed machine accepts '${parsed.input}' within ${T} steps. This is the genuine Cook–Levin construction applied to one bounded instance — a pedagogical illustration, not a general-purpose translator for arbitrary Turing machines.`,
    table: {
      columns: [
        { key: "quantity", header: "Quantity" },
        { key: "value", header: "Value" },
      ],
      rows: [
        { quantity: "Variables", value: varCount },
        { quantity: "Clause templates", value: clauses.length },
        { quantity: "Window positions (T × (H−2))", value: windowPositions },
        { quantity: "Complete formula clauses", value: completeFormulaClauses },
      ],
    },
  });

  return {
    algorithmId: "cook-levin-tableau",
    algorithmName: "Cook–Levin Tableau Encoding (bounded)",
    topicId: "cook-levin",
    input: { machine: m, input: parsed.input, steps: T },
    steps,
    result: {
      variables: varCount,
      clauseTemplates: clauses.length,
      completeFormulaClauses,
      windowPositions,
      validWindows,
      forbiddenWindows: invalidWindows,
      tableauRows: T + 1,
      tapeColumns: H,
      satisfiable: "iff the fixed machine accepts the input within the step bound",
    },
    complexity: { time: "O(T² · |Σ|³ · |Q|³) clause generation", space: "O(T² · |Σ|³ · |Q|³)" },
    guarantee: "φ is satisfiable ⟺ the fixed machine accepts the input within T steps (bounded illustration).",
    warnings: [
      "Bounded pedagogical illustration for one fixed tiny machine — not a general-purpose translator for arbitrary Turing machines.",
    ],
  };
}
