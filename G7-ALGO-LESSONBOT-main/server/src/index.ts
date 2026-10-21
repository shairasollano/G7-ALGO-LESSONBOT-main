/**
 * Server entry point.
 */
import { createApp } from "./app.js";
import { config, isXKiroEnabled } from "./config.js";

// Safe startup diagnostic: a configured-but-unusable AI provider is reported
// without revealing any secret values.
if (config.ai.provider === "xkiro" && !isXKiroEnabled()) {
  const missing: string[] = [];
  if (!config.ai.xkiroApiKey) missing.push("XKIRO_API_KEY");
  if (!config.ai.xkiroModel) missing.push("XKIRO_MODEL");
  console.warn(
    `[startup] AI provider "xkiro" selected but not enabled — missing: ${missing.join(", ")}. Using the curated offline provider.`,
  );
}

const app = createApp();

app.listen(config.port, () => {
  // Safe logging: never log the API key or full config.
  console.log(`AlgoTutor AI server listening on port ${config.port} (env: ${config.env})`);
  console.log(`CORS origins: ${config.clientOrigins.join(", ")}`);
});
