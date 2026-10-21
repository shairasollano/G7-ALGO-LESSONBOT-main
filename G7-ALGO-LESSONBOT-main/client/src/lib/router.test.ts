/**
 * Router contract: the two real routes, the parameters a landing-page topic
 * action carries into the chat, and the fallbacks that keep an unknown or
 * trailing-slash URL rendering something real instead of a blank screen.
 */
import { describe, expect, it } from "vitest";
import { chatHref, parseRoute, ROUTES } from "./router";

describe("parseRoute", () => {
  it("maps the root to the landing page", () => {
    expect(parseRoute("/")).toEqual({ name: "landing" });
    expect(ROUTES.landing).toBe("/");
  });

  it("maps /chat to the chat route", () => {
    expect(parseRoute("/chat")).toEqual({ name: "chat", ask: null, topic: null });
    expect(ROUTES.chat).toBe("/chat");
  });

  it("treats a trailing slash and unknown paths as the landing page", () => {
    expect(parseRoute("/chat/").name).toBe("chat");
    expect(parseRoute("/nope").name).toBe("landing");
    expect(parseRoute("/").name).toBe("landing");
  });

  it("reads the seed question and topic a topic action carries", () => {
    const route = parseRoute("/chat?ask=Run%20a%20Max-Cut%20demo&topic=randomized-algorithms");
    expect(route).toEqual({
      name: "chat",
      ask: "Run a Max-Cut demo",
      topic: "randomized-algorithms",
    });
  });

  it("ignores blank parameters", () => {
    expect(parseRoute("/chat?ask=%20%20&topic=")).toEqual({ name: "chat", ask: null, topic: null });
  });

  it("caps an absurdly long seed question", () => {
    const route = parseRoute(`/chat?ask=${"x".repeat(5000)}`);
    expect(route.name).toBe("chat");
    expect(route.name === "chat" && route.ask!.length).toBe(600);
  });
});

describe("chatHref", () => {
  it("returns a bare /chat when there is nothing to carry", () => {
    expect(chatHref()).toBe("/chat");
    expect(chatHref({ ask: null, topic: null })).toBe("/chat");
  });

  it("encodes the seed question and topic", () => {
    const href = chatHref({ ask: "Explain Cook–Levin simply", topic: "cook-levin" });
    expect(href.startsWith("/chat?")).toBe(true);
    const query = new URLSearchParams(href.slice(href.indexOf("?") + 1));
    expect(query.get("ask")).toBe("Explain Cook–Levin simply");
    expect(query.get("topic")).toBe("cook-levin");
    // Round-trips back through the parser.
    expect(parseRoute(href)).toEqual({
      name: "chat",
      ask: "Explain Cook–Levin simply",
      topic: "cook-levin",
    });
  });
});
