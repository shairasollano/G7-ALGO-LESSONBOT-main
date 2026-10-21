/**
 * Minimal history-API router for the two real routes this app has:
 *   /       → the public landing page
 *   /chat   → the conversation application
 *
 * Deliberately dependency-free and tiny: the app ships as a single SPA with no
 * router library, and the chat application's own state (conversations,
 * streaming, topic selection) is untouched by navigation.
 *
 * Every link is a real `<a href>` — the href is a genuine destination, so
 * middle-click, "open in new tab" and a direct refresh all work; the click
 * handler only upgrades a plain left click into a client-side navigation.
 */
import { useCallback, useMemo, useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from "react";

export const ROUTES = { landing: "/", chat: "/chat" } as const;

export interface ChatRouteParams {
  /** Question to seed the chat composer with. */
  ask: string | null;
  /** Topic slug to preselect. */
  topic: string | null;
}

export type Route = { name: "landing" } | ({ name: "chat" } & ChatRouteParams);

/** Longest accepted `ask` value; the server rejects messages over 2000 chars. */
const MAX_ASK_LENGTH = 600;

/**
 * Parse a pathname (+query) into a route. Anything that is not exactly `/chat`
 * resolves to the landing page, so an unknown or trailing-slash URL still
 * renders something real instead of a blank screen.
 */
export function parseRoute(href: string): Route {
  const url = new URL(href, "http://localhost");
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path !== ROUTES.chat) return { name: "landing" };
  const ask = url.searchParams.get("ask");
  const topic = url.searchParams.get("topic");
  return {
    name: "chat",
    ask: ask && ask.trim() ? ask.trim().slice(0, MAX_ASK_LENGTH) : null,
    topic: topic && topic.trim() ? topic.trim() : null,
  };
}

/** Build a chat href with optional seed question and topic context. */
export function chatHref(params: ChatRouteParams = { ask: null, topic: null }): string {
  const search = new URLSearchParams();
  if (params.ask) search.set("ask", params.ask.slice(0, MAX_ASK_LENGTH));
  if (params.topic) search.set("topic", params.topic);
  const query = search.toString();
  return query ? `${ROUTES.chat}?${query}` : ROUTES.chat;
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}

function emit() {
  for (const listener of [...listeners]) listener();
}

/** Current location as `pathname + search`; the snapshot the router subscribes to. */
export function currentHref(): string {
  return window.location.pathname + window.location.search;
}

function serverHref(): string {
  return ROUTES.landing;
}

/**
 * Navigate client-side. A same-URL navigation emits without pushing, so
 * clicking "Try the Chat" while already on /chat cannot stack duplicate
 * history entries and Back still leaves the page.
 */
export function navigate(to: string, options: { replace?: boolean } = {}): void {
  const next = new URL(to, window.location.origin);
  const target = next.pathname + next.search;
  const current = currentHref();
  if (target === current) {
    emit();
    return;
  }
  if (options.replace) window.history.replaceState(null, "", target);
  else window.history.pushState(null, "", target);
  emit();
}

/** The active route; re-renders on pushState, replaceState and popstate. */
export function useRoute(): Route {
  const href = useSyncExternalStore(subscribe, currentHref, serverHref);
  return useMemo(() => parseRoute(href), [href]);
}

export interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  /** Destination path, e.g. "/chat" or "/chat?ask=...". */
  to: string;
}

/**
 * An anchor that behaves like a link and navigates client-side for a plain
 * left click. Modified clicks, middle clicks and non-left buttons fall through
 * to the browser so new-tab behaviour is preserved.
 */
export function Link({ to, onClick, children, ...rest }: LinkProps) {
  const handleClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      onClick?.(event);
      if (event.defaultPrevented) return;
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      navigate(to);
    },
    [onClick, to],
  );

  return (
    <a href={to} onClick={handleClick} {...rest}>
      {children}
    </a>
  );
}
