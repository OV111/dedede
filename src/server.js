import fs from "node:fs";
import path from "node:path";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { openDb } from "./db.js";

const config = loadConfig();
fs.mkdirSync(path.dirname(config.databaseFile), { recursive: true });
const db = openDb(config.databaseFile);

const server = createApp({ db, config }).listen(config.port, () => {
  console.log(`notes-api listening on :${config.port}`);
});

// Finish in-flight requests, then close the database cleanly.
const shutdown = () => {
  server.close(() => {
    db.close();
    process.exit(0);
  });
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
