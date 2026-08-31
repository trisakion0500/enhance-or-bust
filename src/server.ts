import express from "express";
import log4js from "log4js";

export function createServer() {
  const app = express();
  app.use(log4js.connectLogger(log4js.getLogger(), { level: "info" }));
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  return app;
}
