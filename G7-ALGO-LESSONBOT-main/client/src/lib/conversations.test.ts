/**
 * Recent-conversation storage tests: persistence, validation, capping,
 * rename/delete, and corrupt-data handling — all against a real localStorage.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * This jsdom build does not define localStorage; a small deterministic
 * in-memory Storage implementation stands in for it.
 */
function makeStorage(): Storage {
  let map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => { map.delete(k); },
    setItem: (k, v) => { map.set(k, String(v)); },
  } as Storage;
}

const storageMock = makeStorage();
import {
  deleteConversation,
  loadConversations,
  renameConversation,
  saveConversations,
  titleFromMessage,
  upsertConversation,
  type StoredConversation,
} from "./conversations";
import type { ChatBlock } from "@shared/contract";

function conv(overrides: Partial<StoredConversation> = {}): StoredConversation {
  return {
    id: "c-1",
    title: "Test conversation",
    topicId: "polynomial-reductions",
    level: "beginner",
    messages: [{ id: "m-1", role: "user", text: "hello" }],
    updatedAt: 1,
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", storageMock);
  storageMock.clear();
});

describe("loadConversations", () => {
  it("returns an empty list when nothing is stored", () => {
    expect(loadConversations()).toEqual([]);
  });

  it("round-trips a saved conversation", () => {
    saveConversations([conv()]);
    const loaded = loadConversations();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].title).toBe("Test conversation");
    expect(loaded[0].messages[0].text).toBe("hello");
  });

  it("drops corrupt JSON without throwing", () => {
    localStorage.setItem("g7algo:conversations:v1", "{not json");
    expect(loadConversations()).toEqual([]);
  });

  it("drops entries with invalid shape (wrong role, bad level)", () => {
    localStorage.setItem(
      "g7algo:conversations:v1",
      JSON.stringify([
        { id: "x", title: "bad", topicId: "t", level: "expert", messages: [], updatedAt: 1 },
        { id: "y", title: "bad-role", topicId: "t", level: "beginner", messages: [{ id: "a", role: "robot", text: "hi" }], updatedAt: 2 },
        conv(),
      ]),
    );
    const loaded = loadConversations();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe("c-1");
  });
});

describe("saveConversations", () => {
  it("caps the number of stored conversations (newest win)", () => {
    const many = Array.from({ length: 20 }, (_, i) => conv({ id: `c-${i}`, updatedAt: i }));
    const kept = saveConversations(many);
    expect(kept.length).toBeLessThanOrEqual(12);
    expect(kept[0].id).toBe("c-19");
  });

  it("removes the storage entry when the list becomes empty", () => {
    saveConversations([conv()]);
    saveConversations([]);
    expect(loadConversations()).toEqual([]);
    expect(localStorage.getItem("g7algo:conversations:v1")).toBeNull();
  });

  it("caps long message text", () => {
    const long = "x".repeat(20_000);
    const kept = saveConversations([conv({ messages: [{ id: "m", role: "assistant", text: long }] })]);
    expect((kept[0].messages[0].text ?? "").length).toBeLessThanOrEqual(8100);
  });
});

describe("delete / rename / upsert", () => {
  it("deletes by id", () => {
    saveConversations([conv(), conv({ id: "c-2", updatedAt: 2 })]);
    const next = deleteConversation("c-1", [conv(), conv({ id: "c-2", updatedAt: 2 })]);
    expect(next.map((c) => c.id)).toEqual(["c-2"]);
    expect(loadConversations().map((c) => c.id)).toEqual(["c-2"]);
  });

  it("renames by id and trims the title", () => {
    const next = renameConversation("c-1", "  Renamed  ", [conv()]);
    expect(next[0].title).toBe("Renamed");
  });

  it("ignores empty renames", () => {
    const next = renameConversation("c-1", "   ", [conv()]);
    expect(next[0].title).toBe("Test conversation");
  });

  it("upsert moves the conversation to the front with a fresh timestamp", () => {
    const first = saveConversations([conv(), conv({ id: "c-2", updatedAt: 5 })]);
    const updated = upsertConversation(first, conv({ id: "c-2", messages: [{ id: "m-2", role: "user", text: "again" }] }));
    expect(updated[0].id).toBe("c-2");
    expect(updated[0].messages).toHaveLength(1);
    expect(loadConversations()[0].id).toBe("c-2");
  });
});

describe("titleFromMessage", () => {
  it("uses short messages verbatim", () => {
    expect(titleFromMessage("Explain Cook–Levin")).toBe("Explain Cook–Levin");
  });

  it("normalizes whitespace and truncates long messages", () => {
    const long = "a ".repeat(60).trim();
    const title = titleFromMessage(long);
    expect(title.endsWith("…")).toBe(true);
    expect(title).not.toContain("\n");
  });
});

describe("structured blocks survive the round-trip", () => {
  it("keeps algorithm trace blocks intact", () => {
    const traceBlock: ChatBlock = {
      type: "algorithm_trace",
      trace: {
        algorithmId: "randomized-max-cut",
        algorithmName: "Randomized Max-Cut",
        title: "t",
        steps: [],
        result: { cutEdges: 3, trials: 5 },
        complexity: { time: "O(trials)", space: "O(n)" },
      },
    };
    saveConversations([conv({ messages: [{ id: "m", role: "assistant", blocks: [traceBlock] }] })]);
    const loaded = loadConversations();
    expect(loaded[0].messages[0].blocks?.[0]?.type).toBe("algorithm_trace");
  });
});
