/** Topic catalog routes. */
import { Router } from "express";
import { getTopic, listTopicSummaries } from "../data/topics.js";

export const topicsRouter = Router();

topicsRouter.get("/api/topics", (_req, res) => {
  res.json({ topics: listTopicSummaries() });
});

topicsRouter.get("/api/topics/:slug", (req, res) => {
  const topic = getTopic(req.params.slug);
  if (!topic) {
    res.status(404).json({
      error: {
        code: "topic_not_found",
        message: `No topic with slug "${req.params.slug}".`,
        details: { available: listTopicSummaries().map((t) => t.slug) },
      },
    });
    return;
  }
  res.json({ topic });
});
