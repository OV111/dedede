import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import { AppError } from "./errors.js";
import { credentialsSchema, validate } from "./validation.js";

/** POST /auth/register and POST /auth/login — rate limited per IP. */
export function authRouter({ db, config }) {
  const router = Router();

  // Slows password guessing and signup spam. Counters are per process.
  router.use(
    rateLimit({
      ...config.authRateLimit,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      message: { error: { code: "RATE_LIMITED", message: "Too many attempts, try again later" } },
    }),
  );

  const insertUser = db.prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)");
  const findUser = db.prepare("SELECT id, email, password_hash FROM users WHERE email = ?");
  // Compared against when the email is unknown, so "no such user" and "wrong
  // password" take the same time and cannot be told apart by timing.
  const dummyHash = bcrypt.hashSync("not-a-real-password", config.bcryptRounds);

  const issueToken = (userId) =>
    jwt.sign({ sub: String(userId) }, config.jwtSecret, { algorithm: "HS256", expiresIn: "1h" });

  router.post("/register", validate(credentialsSchema), async (req, res) => {
    const { email, password } = req.valid.body;
    const hash = await bcrypt.hash(password, config.bcryptRounds);
    try {
      const { lastInsertRowid } = insertUser.run(email, hash);
      res.status(201).json({ user: { id: Number(lastInsertRowid), email }, token: issueToken(lastInsertRowid) });
    } catch (err) {
      // The UNIQUE constraint is the source of truth: two simultaneous signups
      // for one email cannot both succeed, whatever a pre-check would say.
      if (err.code === "SQLITE_CONSTRAINT_UNIQUE") {
        throw new AppError(409, "EMAIL_TAKEN", "An account with this email already exists");
      }
      throw err;
    }
  });

  router.post("/login", validate(credentialsSchema), async (req, res) => {
    const { email, password } = req.valid.body;
    const user = findUser.get(email);
    const ok = await bcrypt.compare(password, user?.password_hash ?? dummyHash);
    if (!user || !ok) throw new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password");
    res.json({ user: { id: user.id, email: user.email }, token: issueToken(user.id) });
  });

  return router;
}

/** Require "Authorization: Bearer <token>"; sets req.userId. */
export const requireAuth = (config) => (req, res, next) => {
  const [scheme, token] = (req.get("authorization") ?? "").split(" ");
  if (scheme !== "Bearer" || !token) {
    throw new AppError(401, "UNAUTHENTICATED", "Missing bearer token");
  }
  try {
    // algorithms is pinned so a token cannot pick its own (e.g. "none")
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"] });
    req.userId = Number(payload.sub);
  } catch {
    throw new AppError(401, "UNAUTHENTICATED", "Invalid or expired token");
  }
  next();
};
