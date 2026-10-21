/**
 * Route switch: the public landing page at `/`, the existing chat at `/chat`.
 *
 * The chat application is mounted only on its own route, so nothing about its
 * state, streaming, provider handling or browser-local conversation storage
 * changes — it simply has a landing page in front of it now. The seed question
 * and topic a topic CTA carries arrive as route parameters and are handed to
 * the chat as props.
 */
import { useEffect } from "react";
import App from "./App";
import { Landing } from "./landing/Landing";
import { useRoute } from "./lib/router";

export default function Root() {
  const route = useRoute();

  // A route change starts at the top of the new page. Same-page section links
  // are plain anchors, so the browser still handles those.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [route.name]);

  if (route.name === "chat") {
    return <App prefill={route.ask} topicFromRoute={route.topic} />;
  }

  return <Landing />;
}
