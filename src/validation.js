import { z } from "zod";
import { AppError } from "./errors.js";

// bcrypt only uses the first 72 bytes of a password, so longer input is refused
// rather than silently truncated.
export const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8).max(72),
});

export const noteSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().max(10_000).default(""),
});

export const notePatchSchema = noteSchema
  .partial()
  .refine((v) => v.title !== undefined || v.body !== undefined, { message: "Provide a title and/or a body" });

export const idParams = z.object({ id: z.coerce.number().int().positive() });
export const versionParams = idParams.extend({ version: z.coerce.number().int().positive() });

export const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

/**
 * Validate req.body / req.params / req.query before the handler runs, so a
 * handler can trust req.valid.<source>. Bad input is always a 400 with the
 * offending fields listed, never a 500 from a downstream failure.
 */
export const validate =
  (schema, source = "body") =>
  (req, res, next) => {
    const parsed = schema.safeParse(req[source]);
    if (!parsed.success) {
      throw new AppError(
        400,
        "VALIDATION",
        "Invalid request",
        parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      );
    }
    (req.valid ??= {})[source] = parsed.data;
    next();
  };
