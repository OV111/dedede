import express from "express";
import helmet from "helmet";
import { authRouter } from "./auth.js";
import { errorHandler, notFound } from "./errors.js";
import { notesRouter } from "./notes.js";

/**
 * Build the Express app from its dependencies (a database handle and a config
 * object) instead of reading globals, so tests can run it against an in-memory
 * database with their own settings.
 */
export function createApp({ db, config }) {
  const app = express();

  app.use(helmet());
  app.use(express.json({ limit: "100kb" }));

  app.get("/health", (req, res) => {
    db.prepare("SELECT 1").get(); // fails loudly if the database is unreachable
    res.json({ status: "ok" });
  });

  app.use("/auth", authRouter({ db, config }));
  app.use("/notes", notesRouter({ db, config }));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
