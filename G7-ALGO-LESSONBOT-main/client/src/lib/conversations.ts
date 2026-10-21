/**
 * Recent conversations — bounded browser-local storage (no database, no sync).
 *
 * A conversation is a full client-side copy of the messages exchanged in a
 * session window. Everything lives in THIS browser's localStorage; nothing is
 * uploaded, and nothing syncs across devices. The store is defensive: every
 * entry is re-validated on load, opaque/corrupt data is dropped, writes are
 * capped so a large history can never exhaust the storage budget.
 */
import type { ChatBlock, LearningLevel } from "@shared/contract";

export interface StoredMessage {
  id: string;
  role: "user" | "assistant";
  text?: string;
  blocks?: ChatBlock[];
  error?: string;
  stopped?: boolean;
}

export interface StoredConversation {
  id: string;
  /** Auto-derived from the first user message; user-renamable. */
  title: string;
  topicId: string;
  level: LearningLevel;
  messages: StoredMessage[];
  updatedAt: number;
}

const STORAGE_KEY = "g7algo:conversations:v1";
/** Keep the newest N conversations; older ones are dropped on write. */
const MAX_CONVERSATIONS = 12;
/** Keep at most this many messages per conversation. */
const MAX_MESSAGES = 120;
/** Max stored characters per message text (long traces are re-rendered from blocks). */
const MAX_TEXT_CHARS = 8000;
export const STORAGE_NOTICE = "Conversations are stored in this browser only — nothing is uploaded or synced.";

 function isValidStoredMessage(m: unknown): m is StoredMessage {
  if (!m || typeof m !== "object") return false;
  const msg = m as StoredMessage;
  if (typeof msg.id !== "string" || msg.id.length === 0 || msg.id.length > 64) return false;
  if (msg.role !== "user" && msg.role !== "assistant") return false;
  if (msg.text !== undefined && typeof msg.text !== "string") return false;
  if (msg.blocks !== undefined && !Array.isArray(msg.blocks)) return false;
  return true;
}

function isValidStoredConversation(c: unknown): c is StoredConversation {
  if (!c || typeof c !== "object") return false;
  const conv = c as StoredConversation;
  if (typeof conv.id !== "string" || conv.id.length === 0 || conv.id.length > 64) return false;
  if (typeof conv.title !== "string" || conv.title.length > 120) return false;
  if (typeof conv.topicId !== "string" || conv.topicId.length > 80) return false;
  const levels = ["beginner", "intermediate", "formal"];
  if (!levels.includes(conv.level)) return false;
  if (typeof conv.updatedAt !== "number" || !Number.isFinite(conv.updatedAt)) return false;
  if (!Array.isArray(conv.messages) || conv.messages.length > MAX_MESSAGES || !conv.messages.every(isValidStoredMessage)) return false;
  return true;
}

function storage(): Storage | null {
  try {
    // Browsers: the global localStorage. Restricted/private modes may throw
    // on access; test DOMs may simply not define it. Treat both as absent.
    if (typeof localStorage !== "undefined" && localStorage) return localStorage;
    return null;
  } catch {
    return null;
  }
}

function capMessages(messages: StoredMessage[]): StoredMessage[] {
  return messages.slice(-MAX_MESSAGES).map((m) => ({
    ...m,
    text: m.text && m.text.length > MAX_TEXT_CHARS ? m.text.slice(0, MAX_TEXT_CHARS) : m.text,
  }));
}

export function loadConversations(): StoredConversation[] {
  const store = storage();
  if (!store) return [];
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isValidStoredConversation)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_CONVERSATIONS);
  } catch {
    return [];
  }
}

export function saveConversations(conversations: StoredConversation[]): StoredConversation[] {
  const store = storage();
  const kept = conversations
    .filter((c) => c.messages.length > 0)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_CONVERSATIONS)
    .map((c) => ({ ...c, messages: capMessages(c.messages) }));
  if (store) {
    try {
      if (kept.length === 0) {
        store.removeItem(STORAGE_KEY);
      } else {
        store.setItem(STORAGE_KEY, JSON.stringify(kept));
      }
    } catch {
      // Quota exceeded or storage unavailable: recent chats silently degrade.
    }
  }
  return kept;
}

export function deleteConversation(id: string, conversations: StoredConversation[]): StoredConversation[] {
  return saveConversations(conversations.filter((c) => c.id !== id));
}

export function renameConversation(id: string, title: string, conversations: StoredConversation[]): StoredConversation[] {
  const trimmed = title.trim().slice(0, 120);
  return saveConversations(
    conversations.map((c) => (c.id === id && trimmed ? { ...c, title: trimmed } : c)),
  );
}

export function newConversationId(): string {
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Derive a short human title from the first user message. */
export function titleFromMessage(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= 48 ? clean : `${clean.slice(0, 48)}…`;
}

export function upsertConversation(
  conversations: StoredConversation[],
  conversation: StoredConversation,
): StoredConversation[] {
  const rest = conversations.filter((c) => c.id !== conversation.id);
  return saveConversations([
    { ...conversation, messages: capMessages(conversation.messages), updatedAt: Date.now() },
    ...rest,
  ]);
}
