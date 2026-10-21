/**
 * Landing-page scene fixtures — deterministic, and verified against the real
 * solvers by server/tests/landing-scenes.test.ts.
 *
 * Nothing here is invented: every topology is a validated curated-example
 * input, and every step title, description, table row and node/edge state is
 * read out of a live run of the deterministic solver named by `solverId`.
 * The client renders these; the server test re-runs the solvers and asserts
 * the fixtures still match, so the animation can never drift from the maths.
 *
 * `cookLevinTableau` is the one piece of logic: a simulator for the single
 * fixed machine the Cook–Levin fixture uses, so the tableau shows that
 * machine's real accepting run rather than a drawing of one.
 */
import type { AlgorithmTrace } from "./contract.js";

/** Node states the landing renderer understands (subset of the app's graph states). */
export type SceneNodeState = "default" | "active" | "selected" | "covered" | "uncovered" | "cut" | "side_a" | "side_b";
/** Edge states the landing renderer understands. */
export type SceneEdgeState = "default" | "active" | "covered" | "uncovered" | "cut" | "uncut";

export interface SceneNode {
  id: string;
  label: string;
  x: number;
  y: number;
}

export interface SceneEdge {
  source: string;
  target: string;
}

export interface SceneGraph {
  /** Stable key used to address this graph from a step. */
  key: string;
  /** Header shown above the drawing. */
  label: string;
  nodes: SceneNode[];
  edges: SceneEdge[];
}

export interface SceneStepGraphState {
  nodeStates: Record<string, SceneNodeState>;
  edgeStates: Record<string, SceneEdgeState>;
}

export interface SceneTable {
  caption?: string;
  columns: string[];
  rows: (string | number)[][];
  /** Render the rows of every earlier step that shares these columns too. */
  accumulate?: boolean;
}

export interface CookLevinMachineSpec {
  states: string[];
  alphabet: string[];
  startState: string;
  acceptState: string;
  transitions: { from: string; read: string; to: string; write: string; move: "L" | "R" }[];
}

export interface SceneTableau {
  caption: string;
  machine: CookLevinMachineSpec;
  input: string;
  stepBound: number;
}

export interface SceneStep {
  step: number;
  title: string;
  description: string;
  /** Per-graph state overrides for this step, keyed by SceneGraph.key. */
  graphs?: Record<string, SceneStepGraphState>;
  table?: SceneTable;
  /** Annotations active on the tableau at this step. */
  tableau?: {
    /** Cell symbols are written in. */
    filled?: boolean;
    /** Highlight the whole initial-configuration row. */
    initialConfig?: boolean;
    /** Highlight the accepting-state head cell. */
    accept?: boolean;
    /** Highlight the 2×3 window whose centre is (row, col). */
    window?: { row: number; col: number };
  };
  /** Edge keys ("A|B") that carry a travelling signal; "mapping" is the arrow between two graphs. */
  signals?: string[];
}

export interface Scene {
  id: string;
  /** Slug of the real topic this scene belongs to. */
  topicId: string;
  tabLabel: string;
  title: string;
  caption: string;
  /** Curated example the inputs came from. */
  exampleId: string | null;
  /** Solver whose live output every value here was read from. */
  solverId: string | null;
  graphs: SceneGraph[];
  /** Label drawn on the arrow between graphs[0] and graphs[1]. */
  mappingLabel?: string;
  tableau?: SceneTableau;
  steps: SceneStep[];
}

/** Order-independent key for an undirected edge, matching the solvers' edgeId(). */
export function sceneEdgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export interface TableauCell {
  symbol: string;
  /** State name when the head scans this cell, else null. */
  head: string | null;
}

export interface TableauRow {
  time: number;
  cells: TableauCell[];
}

/**
 * Run one fixed machine for a bounded number of steps and return the
 * configuration after each step. Pure and deterministic; used for the
 * Cook–Levin tableau drawing. A halted run repeats its final configuration,
 * and a run with no applicable transition loses its head marker.
 */
export function cookLevinTableau(machine: CookLevinMachineSpec, input: string, stepBound: number): TableauRow[] {
  const columns = input.length + stepBound + 1;
  let tape: string[] = Array.from({ length: columns }, (_, i) => (i < input.length ? input[i] : "_"));
  let head = 0;
  let state: string = machine.startState;
  const rows: TableauRow[] = [];
  for (let t = 0; t <= stepBound; t++) {
    rows.push({ time: t, cells: tape.map((symbol, i) => ({ symbol, head: i === head ? state : null })) });
    if (state === machine.acceptState) continue; // halted: the configuration repeats
    const transition = machine.transitions.find((tr) => tr.from === state && tr.read === tape[head]);
    if (!transition) {
      head = -1;
      state = "";
      continue;
    }
    const nextHead = transition.move === "R" ? head + 1 : head - 1;
    if (nextHead < 0 || nextHead >= columns) {
      head = -1;
      state = "";
      continue;
    }
    const next = [...tape];
    next[head] = transition.write;
    tape = next;
    head = nextHead;
    state = transition.to;
  }
  return rows;
}

/** The fixed machine the Cook–Levin fixture uses (from the curated example input). */
export const COOK_LEVIN_MACHINE: CookLevinMachineSpec = {
  "states": [
    "q0",
    "q1",
    "qacc"
  ],
  "alphabet": [
    "0",
    "1",
    "_"
  ],
  "startState": "q0",
  "acceptState": "qacc",
  "transitions": [
    {
      "from": "q0",
      "read": "0",
      "to": "q1",
      "write": "1",
      "move": "R"
    },
    {
      "from": "q1",
      "read": "1",
      "to": "qacc",
      "write": "1",
      "move": "R"
    },
    {
      "from": "q0",
      "read": "1",
      "to": "q0",
      "write": "1",
      "move": "L"
    }
  ]
};

/** Every landing scene, in display order. */
export const landingScenes: Scene[] = [
  {
    "id": "reductions",
    "topicId": "polynomial-reductions",
    "tabLabel": "Reductions",
    "title": "Polynomial reductions",
    "caption": "One graph, two instances. The mapping keeps the graph and changes only the parameter, so a YES stays a YES and a NO stays a NO.",
    "exampleId": "ex-reduction-p4",
    "solverId": "reduction-is-to-vc",
    "graphs": [
      {
        "key": "source",
        "label": "Independent Set — (G, k = 2)",
        "nodes": [
          {
            "id": "A",
            "label": "A",
            "x": 50,
            "y": 110
          },
          {
            "id": "B",
            "label": "B",
            "x": 160,
            "y": 110
          },
          {
            "id": "C",
            "label": "C",
            "x": 270,
            "y": 110
          },
          {
            "id": "D",
            "label": "D",
            "x": 380,
            "y": 110
          }
        ],
        "edges": [
          {
            "source": "A",
            "target": "B"
          },
          {
            "source": "B",
            "target": "C"
          },
          {
            "source": "C",
            "target": "D"
          }
        ]
      },
      {
        "key": "target",
        "label": "Vertex Cover — (G, n − k = 2)",
        "nodes": [
          {
            "id": "A",
            "label": "A",
            "x": 50,
            "y": 110
          },
          {
            "id": "B",
            "label": "B",
            "x": 160,
            "y": 110
          },
          {
            "id": "C",
            "label": "C",
            "x": 270,
            "y": 110
          },
          {
            "id": "D",
            "label": "D",
            "x": 380,
            "y": 110
          }
        ],
        "edges": [
          {
            "source": "A",
            "target": "B"
          },
          {
            "source": "B",
            "target": "C"
          },
          {
            "source": "C",
            "target": "D"
          }
        ]
      }
    ],
    "mappingLabel": "f(G, k) = (G, n − k)",
    "steps": [
      {
        "step": 1,
        "title": "Validate the source instance",
        "description": "The instance is a graph with 4 vertices and 3 edges, and parameter k = 2 for Independent Set. The graph is well formed: unique vertex ids, valid edge endpoints, no duplicate edges.",
        "graphs": {
          "source": {
            "nodeStates": {
              "A": "default",
              "B": "default",
              "C": "default",
              "D": "default"
            },
            "edgeStates": {
              "A|B": "default",
              "B|C": "default",
              "C|D": "default"
            }
          },
          "target": {
            "nodeStates": {
              "A": "default",
              "B": "default",
              "C": "default",
              "D": "default"
            },
            "edgeStates": {
              "A|B": "default",
              "B|C": "default",
              "C|D": "default"
            }
          }
        }
      },
      {
        "step": 2,
        "title": "Apply the transformation f(G, k) = (G, n − k)",
        "description": "Keep the same graph and map the parameter: k = 2 ↦ n − k = 4 − 2 = 2. The transformed instance asks whether the graph has a vertex cover of size ≤ 2. The transformation runs in O(n + m) time.",
        "graphs": {
          "source": {
            "nodeStates": {
              "A": "default",
              "B": "default",
              "C": "default",
              "D": "default"
            },
            "edgeStates": {
              "A|B": "default",
              "B|C": "default",
              "C|D": "default"
            }
          },
          "target": {
            "nodeStates": {
              "A": "default",
              "B": "default",
              "C": "default",
              "D": "default"
            },
            "edgeStates": {
              "A|B": "default",
              "B|C": "default",
              "C|D": "default"
            }
          }
        },
        "table": {
          "columns": [
            "Quantity",
            "Value"
          ],
          "rows": [
            [
              "n (vertices)",
              4
            ],
            [
              "m (edges)",
              3
            ],
            [
              "k (Independent Set parameter)",
              2
            ],
            [
              "n − k (Vertex Cover parameter)",
              2
            ]
          ]
        },
        "signals": [
          "mapping"
        ]
      },
      {
        "step": 3,
        "title": "Verify the complement duality on this instance",
        "description": "The graph has an independent set S = {A, C} of size 2. Its complement V ∖ S = {B, D} touches every edge: verified — it is a vertex cover. This witnesses the (⇒) direction: a YES instance of Independent Set maps to a YES instance of Vertex Cover.",
        "graphs": {
          "source": {
            "nodeStates": {
              "A": "selected",
              "B": "default",
              "C": "selected",
              "D": "default"
            },
            "edgeStates": {
              "A|B": "covered",
              "B|C": "covered",
              "C|D": "covered"
            }
          },
          "target": {
            "nodeStates": {
              "A": "default",
              "B": "selected",
              "C": "default",
              "D": "selected"
            },
            "edgeStates": {
              "A|B": "covered",
              "B|C": "covered",
              "C|D": "covered"
            }
          }
        },
        "table": {
          "columns": [
            "Set",
            "Members",
            "Verified property"
          ],
          "rows": [
            [
              "S",
              "{A, C}",
              "no edge inside (independent set)"
            ],
            [
              "V ∖ S",
              "{B, D}",
              "touches every edge (vertex cover)"
            ]
          ]
        },
        "signals": [
          "mapping"
        ]
      },
      {
        "step": 4,
        "title": "Complexity of the transformation",
        "description": "Copying the graph takes O(n + m) time and O(n + m) space; computing n − k is O(1). The transformation is polynomial-time, as required for a polynomial-time reduction.",
        "graphs": {
          "source": {
            "nodeStates": {
              "A": "default",
              "B": "default",
              "C": "default",
              "D": "default"
            },
            "edgeStates": {
              "A|B": "default",
              "B|C": "default",
              "C|D": "default"
            }
          },
          "target": {
            "nodeStates": {
              "A": "default",
              "B": "default",
              "C": "default",
              "D": "default"
            },
            "edgeStates": {
              "A|B": "default",
              "B|C": "default",
              "C|D": "default"
            }
          }
        }
      }
    ]
  },
  {
    "id": "independent-set",
    "topicId": "formal-reductions",
    "tabLabel": "Indep. set ↔ cover",
    "title": "Independent Set ↔ Vertex Cover",
    "caption": "The complement duality the reduction rests on: a set has no edge inside it exactly when its complement touches every edge.",
    "exampleId": "ex-reduction-triangle",
    "solverId": "reduction-is-to-vc",
    "graphs": [
      {
        "key": "g",
        "label": "G = (V, E), k = 1, n = 3",
        "nodes": [
          {
            "id": "A",
            "label": "A",
            "x": 120,
            "y": 40
          },
          {
            "id": "B",
            "label": "B",
            "x": 48,
            "y": 168
          },
          {
            "id": "C",
            "label": "C",
            "x": 192,
            "y": 168
          }
        ],
        "edges": [
          {
            "source": "A",
            "target": "B"
          },
          {
            "source": "B",
            "target": "C"
          },
          {
            "source": "A",
            "target": "C"
          }
        ]
      }
    ],
    "steps": [
      {
        "step": 1,
        "title": "The instance",
        "description": "A triangle on 3 vertices with k = 1: is there a set of 1 vertices with no edge between them?",
        "graphs": {
          "g": {
            "nodeStates": {
              "A": "default",
              "B": "default",
              "C": "default"
            },
            "edgeStates": {
              "A|B": "default",
              "B|C": "default",
              "A|C": "default"
            }
          }
        },
        "table": {
          "columns": [
            "Quantity",
            "Value"
          ],
          "rows": [
            [
              "n (vertices)",
              3
            ],
            [
              "m (edges)",
              3
            ],
            [
              "k (Independent Set)",
              1
            ],
            [
              "n − k (Vertex Cover)",
              2
            ]
          ]
        }
      },
      {
        "step": 2,
        "title": "Independent set S = {A}",
        "description": "S = {A} contains no edge: no pair of vertices inside S is joined by an edge, so S is independent.",
        "graphs": {
          "g": {
            "nodeStates": {
              "A": "selected",
              "B": "default",
              "C": "default"
            },
            "edgeStates": {
              "A|B": "default",
              "B|C": "default",
              "A|C": "default"
            }
          }
        },
        "table": {
          "columns": [
            "Set",
            "Members",
            "Property"
          ],
          "rows": [
            [
              "S",
              "{A}",
              "no edge inside (independent set)"
            ]
          ]
        },
        "signals": [
          "A|B"
        ]
      },
      {
        "step": 3,
        "title": "Verify the complement duality on this instance",
        "description": "The graph has an independent set S = {A} of size 1. Its complement V ∖ S = {B, C} touches every edge: verified — it is a vertex cover. This witnesses the (⇒) direction: a YES instance of Independent Set maps to a YES instance of Vertex Cover.",
        "graphs": {
          "g": {
            "nodeStates": {
              "A": "default",
              "B": "selected",
              "C": "selected"
            },
            "edgeStates": {
              "A|B": "covered",
              "B|C": "covered",
              "A|C": "covered"
            }
          }
        },
        "table": {
          "columns": [
            "Set",
            "Members",
            "Verified property"
          ],
          "rows": [
            [
              "S",
              "{A}",
              "no edge inside (independent set)"
            ],
            [
              "V ∖ S",
              "{B, C}",
              "touches every edge (vertex cover)"
            ]
          ]
        }
      }
    ]
  },
  {
    "id": "vertex-cover",
    "topicId": "approximation-algorithms",
    "tabLabel": "Vertex cover",
    "title": "Vertex Cover 2-approximation",
    "caption": "Repeatedly cover an uncovered edge with both endpoints. The picked edges never share a vertex, so the cover is at most twice the optimum.",
    "exampleId": "ex-vertex-cover",
    "solverId": "vertex-cover-2approx",
    "graphs": [
      {
        "key": "g",
        "label": "G = (V, E)",
        "nodes": [
          {
            "id": "A",
            "label": "A",
            "x": 50,
            "y": 110
          },
          {
            "id": "B",
            "label": "B",
            "x": 160,
            "y": 110
          },
          {
            "id": "C",
            "label": "C",
            "x": 270,
            "y": 110
          },
          {
            "id": "D",
            "label": "D",
            "x": 380,
            "y": 110
          }
        ],
        "edges": [
          {
            "source": "A",
            "target": "B"
          },
          {
            "source": "B",
            "target": "C"
          },
          {
            "source": "C",
            "target": "D"
          }
        ]
      }
    ],
    "steps": [
      {
        "step": 1,
        "title": "Initialize",
        "description": "Start with an empty cover and all 3 edges uncovered. While any edge remains uncovered, pick the first uncovered edge (in sorted order) and add both endpoints to the cover.",
        "graphs": {
          "g": {
            "nodeStates": {
              "A": "default",
              "B": "default",
              "C": "default",
              "D": "default"
            },
            "edgeStates": {
              "A|B": "uncovered",
              "B|C": "uncovered",
              "C|D": "uncovered"
            }
          }
        },
        "table": {
          "columns": [
            "Current cover",
            "Uncovered edges"
          ],
          "rows": [
            [
              "∅",
              3
            ]
          ]
        }
      },
      {
        "step": 2,
        "title": "Pick uncovered edge A–B",
        "description": "Add A and B to the cover, which newly covers A–B, B–C. 1 edge still uncovered.",
        "graphs": {
          "g": {
            "nodeStates": {
              "A": "selected",
              "B": "selected",
              "C": "default",
              "D": "default"
            },
            "edgeStates": {
              "A|B": "active",
              "B|C": "covered",
              "C|D": "uncovered"
            }
          }
        },
        "table": {
          "columns": [
            "Current cover",
            "Uncovered edges"
          ],
          "rows": [
            [
              "{A, B}",
              1
            ]
          ]
        },
        "signals": [
          "A|B"
        ]
      },
      {
        "step": 3,
        "title": "Pick uncovered edge C–D",
        "description": "Add C and D to the cover, which newly covers C–D. 0 edges still uncovered.",
        "graphs": {
          "g": {
            "nodeStates": {
              "A": "selected",
              "B": "selected",
              "C": "selected",
              "D": "selected"
            },
            "edgeStates": {
              "A|B": "covered",
              "B|C": "covered",
              "C|D": "active"
            }
          }
        },
        "table": {
          "columns": [
            "Current cover",
            "Uncovered edges"
          ],
          "rows": [
            [
              "{A, B, C, D}",
              0
            ]
          ]
        },
        "signals": [
          "C|D"
        ]
      },
      {
        "step": 4,
        "title": "Terminate with the guarantee",
        "description": "No uncovered edges remain, so {A, B, C, D} is a vertex cover of size 4. The picked edges {A–B, C–D} share no vertices — they form a matching of size 2. Any vertex cover needs at least one endpoint per picked edge, so OPT ≥ 2, and |C| = 4 ≤ 2·2 ≤ 2·OPT.",
        "graphs": {
          "g": {
            "nodeStates": {
              "A": "selected",
              "B": "selected",
              "C": "selected",
              "D": "selected"
            },
            "edgeStates": {
              "A|B": "covered",
              "B|C": "covered",
              "C|D": "covered"
            }
          }
        },
        "table": {
          "columns": [
            "Quantity",
            "Value"
          ],
          "rows": [
            [
              "|C| (algorithm's cover)",
              4
            ],
            [
              "|M| (picked matching)",
              2
            ],
            [
              "OPT (unknown optimum)",
              "≥ 2"
            ],
            [
              "Guarantee",
              "|C| ≤ 2·OPT (ρ = 2)"
            ]
          ]
        }
      }
    ]
  },
  {
    "id": "max-cut",
    "topicId": "randomized-algorithms",
    "tabLabel": "Max-Cut",
    "title": "Randomized Max-Cut",
    "caption": "Seeded coin flips put each vertex on one side of the cut. Each trial's crossing edges are counted; the expectation is m/2, not a promise about one run.",
    "exampleId": "ex-max-cut",
    "solverId": "randomized-max-cut",
    "graphs": [
      {
        "key": "g",
        "label": "G = (V, E), m = 5 edges",
        "nodes": [
          {
            "id": "A",
            "label": "A",
            "x": 60,
            "y": 60
          },
          {
            "id": "B",
            "label": "B",
            "x": 180,
            "y": 60
          },
          {
            "id": "C",
            "label": "C",
            "x": 60,
            "y": 180
          },
          {
            "id": "D",
            "label": "D",
            "x": 180,
            "y": 180
          }
        ],
        "edges": [
          {
            "source": "A",
            "target": "B"
          },
          {
            "source": "A",
            "target": "C"
          },
          {
            "source": "B",
            "target": "C"
          },
          {
            "source": "B",
            "target": "D"
          },
          {
            "source": "C",
            "target": "D"
          }
        ]
      }
    ],
    "steps": [
      {
        "step": 1,
        "title": "Set up the seeded experiment",
        "description": "Graph with 4 vertices and 5 edges. Each of the 5 trials flips a fair seeded coin per vertex (seed = 42) and counts the cut edges. The theoretical expectation is E[cut] = m/2 = 2.5.",
        "graphs": {
          "g": {
            "nodeStates": {
              "A": "default",
              "B": "default",
              "C": "default",
              "D": "default"
            },
            "edgeStates": {
              "A|B": "default",
              "A|C": "default",
              "B|C": "default",
              "B|D": "default",
              "C|D": "default"
            }
          }
        },
        "signals": []
      },
      {
        "step": 2,
        "title": "Trial 1: assignment {A:B, B:A, C:B, D:B}",
        "description": "3 edges cut (A–B, B–C, B–D). Running average: 3.00.",
        "graphs": {
          "g": {
            "nodeStates": {
              "A": "side_b",
              "B": "side_a",
              "C": "side_b",
              "D": "side_b"
            },
            "edgeStates": {
              "A|B": "cut",
              "A|C": "uncut",
              "B|C": "cut",
              "B|D": "cut",
              "C|D": "uncut"
            }
          }
        },
        "table": {
          "columns": [
            "Trial",
            "Cut value",
            "Running average"
          ],
          "rows": [
            [
              1,
              3,
              "3.00"
            ]
          ],
          "accumulate": true
        },
        "signals": [
          "A|B",
          "B|C",
          "B|D"
        ]
      },
      {
        "step": 3,
        "title": "Trial 2: assignment {A:A, B:B, C:A, D:B}",
        "description": "3 edges cut (A–B, B–C, C–D). Running average: 3.00.",
        "graphs": {
          "g": {
            "nodeStates": {
              "A": "side_a",
              "B": "side_b",
              "C": "side_a",
              "D": "side_b"
            },
            "edgeStates": {
              "A|B": "cut",
              "A|C": "uncut",
              "B|C": "cut",
              "B|D": "uncut",
              "C|D": "cut"
            }
          }
        },
        "table": {
          "columns": [
            "Trial",
            "Cut value",
            "Running average"
          ],
          "rows": [
            [
              2,
              3,
              "3.00"
            ]
          ],
          "accumulate": true
        },
        "signals": [
          "A|B",
          "B|C",
          "C|D"
        ]
      },
      {
        "step": 4,
        "title": "Trial 3: assignment {A:B, B:A, C:A, D:B}",
        "description": "4 edges cut (A–B, A–C, B–D, C–D). Running average: 3.33.",
        "graphs": {
          "g": {
            "nodeStates": {
              "A": "side_b",
              "B": "side_a",
              "C": "side_a",
              "D": "side_b"
            },
            "edgeStates": {
              "A|B": "cut",
              "A|C": "cut",
              "B|C": "uncut",
              "B|D": "cut",
              "C|D": "cut"
            }
          }
        },
        "table": {
          "columns": [
            "Trial",
            "Cut value",
            "Running average"
          ],
          "rows": [
            [
              3,
              4,
              "3.33"
            ]
          ],
          "accumulate": true
        },
        "signals": [
          "A|B",
          "A|C",
          "B|D",
          "C|D"
        ]
      },
      {
        "step": 5,
        "title": "Trial 4: assignment {A:B, B:A, C:A, D:B}",
        "description": "4 edges cut (A–B, A–C, B–D, C–D). Running average: 3.50.",
        "graphs": {
          "g": {
            "nodeStates": {
              "A": "side_b",
              "B": "side_a",
              "C": "side_a",
              "D": "side_b"
            },
            "edgeStates": {
              "A|B": "cut",
              "A|C": "cut",
              "B|C": "uncut",
              "B|D": "cut",
              "C|D": "cut"
            }
          }
        },
        "table": {
          "columns": [
            "Trial",
            "Cut value",
            "Running average"
          ],
          "rows": [
            [
              4,
              4,
              "3.50"
            ]
          ],
          "accumulate": true
        },
        "signals": [
          "A|B",
          "A|C",
          "B|D",
          "C|D"
        ]
      },
      {
        "step": 6,
        "title": "Trial 5: assignment {A:B, B:B, C:A, D:A}",
        "description": "3 edges cut (A–C, B–C, B–D). Running average: 3.40.",
        "graphs": {
          "g": {
            "nodeStates": {
              "A": "side_b",
              "B": "side_b",
              "C": "side_a",
              "D": "side_a"
            },
            "edgeStates": {
              "A|B": "uncut",
              "A|C": "cut",
              "B|C": "cut",
              "B|D": "cut",
              "C|D": "uncut"
            }
          }
        },
        "table": {
          "columns": [
            "Trial",
            "Cut value",
            "Running average"
          ],
          "rows": [
            [
              5,
              3,
              "3.40"
            ]
          ],
          "accumulate": true
        },
        "signals": [
          "A|C",
          "B|C",
          "B|D"
        ]
      },
      {
        "step": 7,
        "title": "Accumulated statistics",
        "description": "Over 5 seeded trials: average cut 3.40, best 4, worst 3. The theoretical expectation over all 2^4 assignments is E[cut] = m/2 = 2.5 ≥ OPT/2. The seeded trials are one reproducible sample — different seeds give different sequences, and a small number of trials need not average exactly 2.5.",
        "graphs": {
          "g": {
            "nodeStates": {
              "A": "side_b",
              "B": "side_a",
              "C": "side_a",
              "D": "side_b"
            },
            "edgeStates": {
              "A|B": "cut",
              "A|C": "cut",
              "B|C": "uncut",
              "B|D": "cut",
              "C|D": "cut"
            }
          }
        },
        "table": {
          "columns": [
            "Statistic",
            "Value"
          ],
          "rows": [
            [
              "Trials (seeded)",
              5
            ],
            [
              "Average cut",
              "3.40"
            ],
            [
              "Best cut",
              4
            ],
            [
              "Worst cut",
              3
            ],
            [
              "Theoretical E[cut] = m/2",
              2.5
            ]
          ],
          "accumulate": false
        },
        "signals": [
          "A|B",
          "A|C",
          "B|D",
          "C|D"
        ]
      }
    ]
  },
  {
    "id": "cook-levin",
    "topicId": "cook-levin",
    "tabLabel": "Cook–Levin",
    "title": "Cook–Levin tableau",
    "caption": "One fixed tiny machine, a bounded step budget, and the accepting computation written out as a tableau: rows are time steps, columns are tape cells.",
    "exampleId": "ex-cook-levin",
    "solverId": "cook-levin-tableau",
    "graphs": [],
    "tableau": {
      "caption": "Tableau for input '01' with T = 3 (4 rows × 6 tape columns)",
      "machine": {
        "states": [
          "q0",
          "q1",
          "qacc"
        ],
        "alphabet": [
          "0",
          "1",
          "_"
        ],
        "startState": "q0",
        "acceptState": "qacc",
        "transitions": [
          {
            "from": "q0",
            "read": "0",
            "to": "q1",
            "write": "1",
            "move": "R"
          },
          {
            "from": "q1",
            "read": "1",
            "to": "qacc",
            "write": "1",
            "move": "R"
          },
          {
            "from": "q0",
            "read": "1",
            "to": "q0",
            "write": "1",
            "move": "L"
          }
        ]
      },
      "input": "01",
      "stepBound": 3
    },
    "steps": [
      {
        "step": 1,
        "title": "Set up the tableau",
        "description": "The tableau has T + 1 = 4 rows (times 0..3) and 6 tape columns (input length 2 plus room for the head to move within the bound). Each cell at each time gets one variable per symbol and one per head/state.",
        "table": {
          "columns": [
            "Quantity",
            "Value"
          ],
          "rows": [
            [
              "Rows (times 0..T)",
              4
            ],
            [
              "Tape columns",
              6
            ],
            [
              "Variables x(t,h,s)",
              72
            ],
            [
              "Variables q(t,h,r)",
              72
            ],
            [
              "Total variables",
              144
            ]
          ]
        },
        "tableau": {}
      },
      {
        "step": 2,
        "title": "Encode the initial configuration",
        "description": "Row 0 spells the input '01' with blanks elsewhere, and the head starts at cell 0 in state q0. This contributes 18 symbol clauses (each cell gets its symbol) and 18 head/state clauses (head only at cell 0 in q0) — 36 unit clauses in total.",
        "tableau": {
          "filled": true,
          "initialConfig": true
        }
      },
      {
        "step": 3,
        "title": "Encode the accepting condition",
        "description": "One clause requires at least one of the 4 × 6 accepting-state head variables q(t, h, qacc) to be true — the machine must enter qacc within 3 steps.",
        "tableau": {
          "filled": true,
          "initialConfig": true,
          "accept": true
        }
      },
      {
        "step": 4,
        "title": "Encode local transition consistency",
        "description": "For each adjacent row pair and each center cell, every 2×3 window that matches no legal transition and is not a head-free identity is forbidden by a clause. Of 2985984 possible windows, 432 are valid and 2985552 are forbidden.",
        "table": {
          "columns": [
            "Quantity",
            "Value"
          ],
          "rows": [
            [
              "Possible 2×3 windows",
              2985984
            ],
            [
              "Valid windows",
              432
            ],
            [
              "Forbidden-window clauses",
              2985552
            ]
          ]
        },
        "tableau": {
          "filled": true,
          "initialConfig": true,
          "accept": true,
          "window": {
            "row": 0,
            "col": 1
          }
        }
      },
      {
        "step": 5,
        "title": "The encoded formula",
        "description": "The CNF formula has 144 variables. The solver generates 2985589 distinct clause templates (initial + accepting + 2985552 forbidden-window templates). A complete tableau formula instantiates the window templates at each of the 12 valid (t, h) positions, yielding 35826661 total clauses. It is satisfiable if and only if the fixed machine accepts '01' within 3 steps. This is the genuine Cook–Levin construction applied to one bounded instance — a pedagogical illustration, not a general-purpose translator for arbitrary Turing machines.",
        "table": {
          "columns": [
            "Quantity",
            "Value"
          ],
          "rows": [
            [
              "Variables",
              144
            ],
            [
              "Clause templates",
              2985589
            ],
            [
              "Window positions (T × (H−2))",
              12
            ],
            [
              "Complete formula clauses",
              35826661
            ]
          ]
        },
        "tableau": {
          "filled": true,
          "initialConfig": true,
          "accept": true,
          "window": {
            "row": 0,
            "col": 1
          }
        }
      }
    ]
  }
];

/** Look up a scene by id. */
export function sceneById(id: string): Scene | undefined {
  return landingScenes.find((s) => s.id === id);
}

/** Scenes that belong to a real topic slug. */
export function scenesForTopic(topicId: string): Scene[] {
  return landingScenes.filter((s) => s.topicId === topicId);
}

/**
 * Interactive demonstration entries for the landing page.
 *
 * `trace` is the app's own AlgorithmTrace, produced by the server's
 * `traceFromResult` on a live solver run of the curated example, so the demo
 * section can hand it straight to the chat's existing trace component. The
 * server test asserts this equals a fresh `traceFromResult(runSolver(...))`.
 */
export interface LandingDemo {
  /** Curated example id. */
  id: string;
  label: string;
  caption: string;
  exampleTitle: string;
  solverId: string;
  trace: AlgorithmTrace;
}

export const landingDemos: LandingDemo[] = [
  {
    "id": "ex-vertex-cover",
    "label": "Vertex Cover 2-approximation",
    "caption": "The curated path example A–B–C–D. Step through the solver's own trace: the cover, the matching and the 2·OPT guarantee are all computed, and the graph changes with the step.",
    "exampleTitle": "2-approximation Vertex Cover on a 4-vertex path",
    "solverId": "vertex-cover-2approx",
    "trace": {
      "algorithmId": "vertex-cover-2approx",
      "algorithmName": "2-Approximation Vertex Cover",
      "title": "2-Approximation Vertex Cover",
      "steps": [
        {
          "step": 1,
          "title": "Initialize",
          "description": "Start with an empty cover and all 3 edges uncovered. While any edge remains uncovered, pick the first uncovered edge (in sorted order) and add both endpoints to the cover.",
          "graph": {
            "nodes": [
              {
                "id": "A",
                "label": "A",
                "x": 60,
                "y": 160,
                "state": "default"
              },
              {
                "id": "B",
                "label": "B",
                "x": 200,
                "y": 160,
                "state": "default"
              },
              {
                "id": "C",
                "label": "C",
                "x": 340,
                "y": 160,
                "state": "default"
              },
              {
                "id": "D",
                "label": "D",
                "x": 480,
                "y": 160,
                "state": "default"
              }
            ],
            "edges": [
              {
                "id": "e0",
                "source": "A",
                "target": "B",
                "state": "uncovered"
              },
              {
                "id": "e1",
                "source": "B",
                "target": "C",
                "state": "uncovered"
              },
              {
                "id": "e2",
                "source": "C",
                "target": "D",
                "state": "uncovered"
              }
            ],
            "layout": "linear",
            "edgeType": "straight"
          },
          "table": {
            "columns": [
              {
                "key": "cover",
                "header": "Current cover"
              },
              {
                "key": "uncovered",
                "header": "Uncovered edges"
              }
            ],
            "rows": [
              {
                "cover": "∅",
                "uncovered": 3
              }
            ]
          }
        },
        {
          "step": 2,
          "title": "Pick uncovered edge A–B",
          "description": "Add A and B to the cover, which newly covers A–B, B–C. 1 edge still uncovered.",
          "highlightNodes": [
            "A",
            "B"
          ],
          "highlightEdges": [
            "A|B"
          ],
          "graph": {
            "nodes": [
              {
                "id": "A",
                "label": "A",
                "x": 60,
                "y": 160,
                "state": "selected"
              },
              {
                "id": "B",
                "label": "B",
                "x": 200,
                "y": 160,
                "state": "selected"
              },
              {
                "id": "C",
                "label": "C",
                "x": 340,
                "y": 160,
                "state": "default"
              },
              {
                "id": "D",
                "label": "D",
                "x": 480,
                "y": 160,
                "state": "default"
              }
            ],
            "edges": [
              {
                "id": "e0",
                "source": "A",
                "target": "B",
                "state": "active"
              },
              {
                "id": "e1",
                "source": "B",
                "target": "C",
                "state": "covered"
              },
              {
                "id": "e2",
                "source": "C",
                "target": "D",
                "state": "uncovered"
              }
            ],
            "layout": "linear",
            "edgeType": "straight"
          },
          "table": {
            "columns": [
              {
                "key": "cover",
                "header": "Current cover"
              },
              {
                "key": "uncovered",
                "header": "Uncovered edges"
              }
            ],
            "rows": [
              {
                "cover": "{A, B}",
                "uncovered": 1
              }
            ]
          }
        },
        {
          "step": 3,
          "title": "Pick uncovered edge C–D",
          "description": "Add C and D to the cover, which newly covers C–D. 0 edges still uncovered.",
          "highlightNodes": [
            "C",
            "D"
          ],
          "highlightEdges": [
            "C|D"
          ],
          "graph": {
            "nodes": [
              {
                "id": "A",
                "label": "A",
                "x": 60,
                "y": 160,
                "state": "selected"
              },
              {
                "id": "B",
                "label": "B",
                "x": 200,
                "y": 160,
                "state": "selected"
              },
              {
                "id": "C",
                "label": "C",
                "x": 340,
                "y": 160,
                "state": "selected"
              },
              {
                "id": "D",
                "label": "D",
                "x": 480,
                "y": 160,
                "state": "selected"
              }
            ],
            "edges": [
              {
                "id": "e0",
                "source": "A",
                "target": "B",
                "state": "covered"
              },
              {
                "id": "e1",
                "source": "B",
                "target": "C",
                "state": "covered"
              },
              {
                "id": "e2",
                "source": "C",
                "target": "D",
                "state": "active"
              }
            ],
            "layout": "linear",
            "edgeType": "straight"
          },
          "table": {
            "columns": [
              {
                "key": "cover",
                "header": "Current cover"
              },
              {
                "key": "uncovered",
                "header": "Uncovered edges"
              }
            ],
            "rows": [
              {
                "cover": "{A, B, C, D}",
                "uncovered": 0
              }
            ]
          }
        },
        {
          "step": 4,
          "title": "Terminate with the guarantee",
          "description": "No uncovered edges remain, so {A, B, C, D} is a vertex cover of size 4. The picked edges {A–B, C–D} share no vertices — they form a matching of size 2. Any vertex cover needs at least one endpoint per picked edge, so OPT ≥ 2, and |C| = 4 ≤ 2·2 ≤ 2·OPT.",
          "graph": {
            "nodes": [
              {
                "id": "A",
                "label": "A",
                "x": 60,
                "y": 160,
                "state": "selected"
              },
              {
                "id": "B",
                "label": "B",
                "x": 200,
                "y": 160,
                "state": "selected"
              },
              {
                "id": "C",
                "label": "C",
                "x": 340,
                "y": 160,
                "state": "selected"
              },
              {
                "id": "D",
                "label": "D",
                "x": 480,
                "y": 160,
                "state": "selected"
              }
            ],
            "edges": [
              {
                "id": "e0",
                "source": "A",
                "target": "B",
                "state": "covered"
              },
              {
                "id": "e1",
                "source": "B",
                "target": "C",
                "state": "covered"
              },
              {
                "id": "e2",
                "source": "C",
                "target": "D",
                "state": "covered"
              }
            ],
            "layout": "linear"
          },
          "table": {
            "columns": [
              {
                "key": "quantity",
                "header": "Quantity"
              },
              {
                "key": "value",
                "header": "Value"
              }
            ],
            "rows": [
              {
                "quantity": "|C| (algorithm's cover)",
                "value": 4
              },
              {
                "quantity": "|M| (picked matching)",
                "value": 2
              },
              {
                "quantity": "OPT (unknown optimum)",
                "value": "≥ 2"
              },
              {
                "quantity": "Guarantee",
                "value": "|C| ≤ 2·OPT (ρ = 2)"
              }
            ]
          }
        }
      ],
      "result": {
        "cover": [
          "A",
          "B",
          "C",
          "D"
        ],
        "coverSize": 4,
        "pickedEdges": [
          "A–B",
          "C–D"
        ],
        "matchingSize": 2,
        "optimalLowerBound": 2
      },
      "complexity": {
        "time": "O(n + m)",
        "space": "O(n + m)"
      },
      "guarantee": "The picked edges form a matching of size 2, so |C| = 2|M| ≤ 2·OPT (2-approximation, worst case)."
    }
  },
  {
    "id": "ex-reduction-p4",
    "label": "Independent Set → Vertex Cover",
    "caption": "The same graph read as two instances. Step 3 verifies the complement duality on this exact graph, and the parameter mapping k ↦ n − k is computed by the solver.",
    "exampleTitle": "Independent Set → Vertex Cover on a 4-vertex path",
    "solverId": "reduction-is-to-vc",
    "trace": {
      "algorithmId": "reduction-is-to-vc",
      "algorithmName": "Independent Set ≤p Vertex Cover",
      "title": "Independent Set ≤p Vertex Cover",
      "steps": [
        {
          "step": 1,
          "title": "Validate the source instance",
          "description": "The instance is a graph with 4 vertices and 3 edges, and parameter k = 2 for Independent Set. The graph is well formed: unique vertex ids, valid edge endpoints, no duplicate edges.",
          "graph": {
            "nodes": [
              {
                "id": "A",
                "label": "A",
                "x": 60,
                "y": 160,
                "state": "default"
              },
              {
                "id": "B",
                "label": "B",
                "x": 200,
                "y": 160,
                "state": "default"
              },
              {
                "id": "C",
                "label": "C",
                "x": 340,
                "y": 160,
                "state": "default"
              },
              {
                "id": "D",
                "label": "D",
                "x": 480,
                "y": 160,
                "state": "default"
              }
            ],
            "edges": [
              {
                "id": "e0",
                "source": "A",
                "target": "B",
                "state": "default"
              },
              {
                "id": "e1",
                "source": "B",
                "target": "C",
                "state": "default"
              },
              {
                "id": "e2",
                "source": "C",
                "target": "D",
                "state": "default"
              }
            ],
            "layout": "linear",
            "edgeType": "straight"
          }
        },
        {
          "step": 2,
          "title": "Apply the transformation f(G, k) = (G, n − k)",
          "description": "Keep the same graph and map the parameter: k = 2 ↦ n − k = 4 − 2 = 2. The transformed instance asks whether the graph has a vertex cover of size ≤ 2. The transformation runs in O(n + m) time.",
          "graph": {
            "nodes": [
              {
                "id": "A",
                "label": "A",
                "x": 60,
                "y": 160,
                "state": "default"
              },
              {
                "id": "B",
                "label": "B",
                "x": 200,
                "y": 160,
                "state": "default"
              },
              {
                "id": "C",
                "label": "C",
                "x": 340,
                "y": 160,
                "state": "default"
              },
              {
                "id": "D",
                "label": "D",
                "x": 480,
                "y": 160,
                "state": "default"
              }
            ],
            "edges": [
              {
                "id": "e0",
                "source": "A",
                "target": "B",
                "state": "default"
              },
              {
                "id": "e1",
                "source": "B",
                "target": "C",
                "state": "default"
              },
              {
                "id": "e2",
                "source": "C",
                "target": "D",
                "state": "default"
              }
            ],
            "layout": "linear",
            "edgeType": "straight"
          },
          "table": {
            "columns": [
              {
                "key": "quantity",
                "header": "Quantity"
              },
              {
                "key": "value",
                "header": "Value"
              }
            ],
            "rows": [
              {
                "quantity": "n (vertices)",
                "value": 4
              },
              {
                "quantity": "m (edges)",
                "value": 3
              },
              {
                "quantity": "k (Independent Set parameter)",
                "value": 2
              },
              {
                "quantity": "n − k (Vertex Cover parameter)",
                "value": 2
              }
            ]
          }
        },
        {
          "step": 3,
          "title": "Verify the complement duality on this instance",
          "description": "The graph has an independent set S = {A, C} of size 2. Its complement V ∖ S = {B, D} touches every edge: verified — it is a vertex cover. This witnesses the (⇒) direction: a YES instance of Independent Set maps to a YES instance of Vertex Cover.",
          "graph": {
            "nodes": [
              {
                "id": "A",
                "label": "A",
                "x": 60,
                "y": 160,
                "state": "selected"
              },
              {
                "id": "B",
                "label": "B",
                "x": 200,
                "y": 160,
                "state": "covered"
              },
              {
                "id": "C",
                "label": "C",
                "x": 340,
                "y": 160,
                "state": "selected"
              },
              {
                "id": "D",
                "label": "D",
                "x": 480,
                "y": 160,
                "state": "covered"
              }
            ],
            "edges": [
              {
                "id": "e0",
                "source": "A",
                "target": "B",
                "state": "covered"
              },
              {
                "id": "e1",
                "source": "B",
                "target": "C",
                "state": "covered"
              },
              {
                "id": "e2",
                "source": "C",
                "target": "D",
                "state": "covered"
              }
            ],
            "layout": "linear"
          },
          "table": {
            "columns": [
              {
                "key": "set",
                "header": "Set"
              },
              {
                "key": "members",
                "header": "Members"
              },
              {
                "key": "property",
                "header": "Verified property"
              }
            ],
            "rows": [
              {
                "set": "S",
                "members": "{A, C}",
                "property": "no edge inside (independent set)"
              },
              {
                "set": "V ∖ S",
                "members": "{B, D}",
                "property": "touches every edge (vertex cover)"
              }
            ]
          }
        },
        {
          "step": 4,
          "title": "Complexity of the transformation",
          "description": "Copying the graph takes O(n + m) time and O(n + m) space; computing n − k is O(1). The transformation is polynomial-time, as required for a polynomial-time reduction.",
          "graph": {
            "nodes": [
              {
                "id": "A",
                "label": "A",
                "x": 60,
                "y": 160,
                "state": "default"
              },
              {
                "id": "B",
                "label": "B",
                "x": 200,
                "y": 160,
                "state": "default"
              },
              {
                "id": "C",
                "label": "C",
                "x": 340,
                "y": 160,
                "state": "default"
              },
              {
                "id": "D",
                "label": "D",
                "x": 480,
                "y": 160,
                "state": "default"
              }
            ],
            "edges": [
              {
                "id": "e0",
                "source": "A",
                "target": "B",
                "state": "default"
              },
              {
                "id": "e1",
                "source": "B",
                "target": "C",
                "state": "default"
              },
              {
                "id": "e2",
                "source": "C",
                "target": "D",
                "state": "default"
              }
            ],
            "layout": "linear",
            "edgeType": "straight"
          }
        }
      ],
      "result": {
        "transformation": "f(G, k) = (G, n − k)",
        "sourceParameter": 2,
        "targetParameter": 2,
        "duality": "S independent ⟺ V ∖ S vertex cover",
        "witness": {
          "independentSet": [
            "A",
            "C"
          ],
          "complementCover": [
            "B",
            "D"
          ]
        }
      },
      "complexity": {
        "time": "O(n + m)",
        "space": "O(n + m)"
      },
      "guarantee": "Answer-preserving in both directions: x ∈ Independent Set ⟺ f(x) ∈ Vertex Cover.",
      "warnings": []
    }
  }
];

/**
 * Build a chat prompt for a topic. Used by the landing page's topic actions so
 * the chat opens with a question that names the topic's own worked example.
 */
export const TOPIC_PROMPTS: Record<string, string> = {
  "polynomial-reductions": "Explain polynomial-time reductions and why preserving the YES/NO answer matters",
  "formal-reductions": "Show me the Independent Set to Vertex Cover reduction with a worked example",
  "cook-levin": "Explain the Cook–Levin theorem and how the tableau encoding works",
  "approximation-algorithms": "Run the 2-approximation Vertex Cover algorithm on a graph and explain the guarantee",
  "randomized-algorithms": "Run a randomized Max-Cut demo and explain the expected cut value",
};
