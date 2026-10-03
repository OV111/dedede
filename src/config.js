/**
 * All configuration comes from environment variables, read once at startup.
 * A missing or weak JWT secret stops the server immediately: starting with a
 * guessable signing key would be worse than not starting.
 */
export function loadConfig(env = process.env) {
  const jwtSecret = env.JWT_SECRET;
  if (!jwtSecret || jwtSecret.length < 16) {
    throw new Error("JWT_SECRET must be set to 16+ characters. Copy .env.example to .env.");
  }
  return {
    port: Number(env.PORT ?? 3000),
    jwtSecret,
    databaseFile: env.DATABASE_FILE ?? "./data/notes.db",
    bcryptRounds: Number(env.BCRYPT_ROUNDS ?? 12),
    authRateLimit: { windowMs: 15 * 60 * 1000, limit: Number(env.AUTH_RATE_LIMIT ?? 20) },
  };
}
