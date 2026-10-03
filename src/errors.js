/**
 * One error shape for the whole API:
 *   { "error": { "code": "VALIDATION", "message": "...", "details": [...] } }
 *
 * Routes throw AppError for anything the client caused; the central handler
 * below turns it into JSON. Anything else is a bug: it is logged on the server
 * and the client only ever sees a generic 500 — never a stack trace.
 */
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found" } });
};

// Express recognises an error handler by its four parameters, so `next` must stay.
export const errorHandler = (err, req, res, next) => {
  if (res.headersSent) return next(err);

  if (err instanceof AppError) {
    const body = { code: err.code, message: err.message };
    if (err.details) body.details = err.details;
    return res.status(err.status).json({ error: body });
  }
  // body-parser's own errors carry a `type`
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: { code: "BAD_JSON", message: "Request body is not valid JSON" } });
  }
  if (err.type === "entity.too.large") {
    return res.status(413).json({ error: { code: "TOO_LARGE", message: "Request body is too large" } });
  }

  console.error(err);
  res.status(500).json({ error: { code: "INTERNAL", message: "Something went wrong" } });
};
