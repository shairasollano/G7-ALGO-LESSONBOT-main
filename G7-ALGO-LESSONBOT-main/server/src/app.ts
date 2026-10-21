/**
 * Express app assembly: middleware, routes, error handling.
 */
import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { healthRouter } from "./routes/health.js";
import { topicsRouter } from "./routes/topics.js";
import { tutorRouter } from "./routes/tutor.js";
import { problemsRouter } from "./routes/problems.js";
import { quizzesRouter } from "./routes/quizzes.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: config.clientOrigins,
      credentials: false,
    }),
  );
  app.use(express.json({ limit: "256kb" }));

  app.use(healthRouter);
  app.use(topicsRouter);
  app.use(tutorRouter);
  app.use(problemsRouter);
  app.use(quizzesRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
