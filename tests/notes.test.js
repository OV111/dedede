import { describe, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../src/app.js";
import { openDb } from "../src/db.js";

const makeConfig = (over = {}) => ({
  port: 0,
  jwtSecret: "test-secret-test-secret",
  databaseFile: ":memory:",
  bcryptRounds: 4, // fast hashing for tests
  authRateLimit: { windowMs: 60_000, limit: 1000 },
  ...over,
});
// every test gets its own app and its own empty in-memory database
const makeApp = (over) => createApp({ db: openDb(":memory:"), config: makeConfig(over) });

const PASSWORD = "correct-horse-battery";
const signUp = async (app, email = "a@example.com") => {
  const res = await request(app).post("/auth/register").send({ email, password: PASSWORD });
  assert.equal(res.status, 201);
  return res.body.token;
};
const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const createNote = async (app, token, note = { title: "First", body: "hello" }) => {
  const res = await request(app).post("/notes").set(bearer(token)).send(note);
  assert.equal(res.status, 201);
  return res.body;
};

describe("auth", () => {
  test("registers, then logs in with the same credentials", async () => {
    const app = makeApp();
    await signUp(app);
    const res = await request(app).post("/auth/login").send({ email: "A@Example.com", password: PASSWORD });
    assert.equal(res.status, 200); // email is case-insensitive
    assert.ok(res.body.token);
    assert.equal(res.body.user.email, "a@example.com");
    assert.equal(res.body.user.password_hash, undefined);
  });

  test("rejects invalid input with 400 and field details, never a 500", async () => {
    const app = makeApp();
    const res = await request(app).post("/auth/register").send({ email: "not-an-email", password: "short" });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "VALIDATION");
    assert.deepEqual(res.body.error.details.map((d) => d.field).sort(), ["email", "password"]);
  });

  test("refuses a duplicate email with 409", async () => {
    const app = makeApp();
    await signUp(app);
    const res = await request(app).post("/auth/register").send({ email: "a@example.com", password: PASSWORD });
    assert.equal(res.status, 409);
  });

  test("gives the same 401 for a wrong password and an unknown email", async () => {
    const app = makeApp();
    await signUp(app);
    const wrong = await request(app).post("/auth/login").send({ email: "a@example.com", password: "wrong-password" });
    const unknown = await request(app).post("/auth/login").send({ email: "nobody@example.com", password: PASSWORD });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.deepEqual(wrong.body, unknown.body);
  });

  test("rate limits the auth endpoints", async () => {
    const app = makeApp({ authRateLimit: { windowMs: 60_000, limit: 3 } });
    const attempt = () => request(app).post("/auth/login").send({ email: "a@example.com", password: "wrong-password" });
    for (let i = 0; i < 3; i++) assert.equal((await attempt()).status, 401);
    const blocked = await attempt();
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.error.code, "RATE_LIMITED");
  });

  test("protected routes need a valid token", async () => {
    const app = makeApp();
    assert.equal((await request(app).get("/notes")).status, 401);
    assert.equal((await request(app).get("/notes").set(bearer("garbage"))).status, 401);
  });
});

describe("notes", () => {
  test("creates, reads, updates and deletes a note", async () => {
    const app = makeApp();
    const token = await signUp(app);
    const note = await createNote(app, token);
    assert.equal(note.version, 1);

    const read = await request(app).get(`/notes/${note.id}`).set(bearer(token));
    assert.equal(read.body.title, "First");

    const patched = await request(app).patch(`/notes/${note.id}`).set(bearer(token)).send({ body: "changed" });
    assert.equal(patched.status, 200);
    assert.deepEqual([patched.body.title, patched.body.body], ["First", "changed"]);

    assert.equal((await request(app).delete(`/notes/${note.id}`).set(bearer(token))).status, 204);
    assert.equal((await request(app).get(`/notes/${note.id}`).set(bearer(token))).status, 404);
  });

  test("validates note input", async () => {
    const app = makeApp();
    const token = await signUp(app);
    const empty = await request(app).post("/notes").set(bearer(token)).send({ title: "   " });
    assert.equal(empty.status, 400);
    const note = await createNote(app, token);
    const nothing = await request(app).patch(`/notes/${note.id}`).set(bearer(token)).send({});
    assert.equal(nothing.status, 400);
    assert.equal((await request(app).get("/notes/abc").set(bearer(token))).status, 400);
  });

  test("paginates the list, newest first", async () => {
    const app = makeApp();
    const token = await signUp(app);
    for (let i = 1; i <= 25; i++) await createNote(app, token, { title: `Note ${i}`, body: "" });

    const page2 = await request(app).get("/notes?page=2&limit=10").set(bearer(token));
    assert.equal(page2.status, 200);
    assert.equal(page2.body.data.length, 10);
    assert.equal(page2.body.total, 25);
    assert.equal(page2.body.totalPages, 3);
    assert.equal(page2.body.data[0].title, "Note 15");

    const last = await request(app).get("/notes?page=3&limit=10").set(bearer(token));
    assert.equal(last.body.data.length, 5);
    assert.equal((await request(app).get("/notes?limit=500").set(bearer(token))).status, 400);
  });

  test("a user can never see or change another user's notes", async () => {
    const app = makeApp();
    const alice = await signUp(app, "alice@example.com");
    const bob = await signUp(app, "bob@example.com");
    const note = await createNote(app, alice, { title: "Alice's secret", body: "private" });

    // Bob gets 404 — the same answer as for a note that does not exist
    for (const res of [
      await request(app).get(`/notes/${note.id}`).set(bearer(bob)),
      await request(app).patch(`/notes/${note.id}`).set(bearer(bob)).send({ title: "hacked" }),
      await request(app).delete(`/notes/${note.id}`).set(bearer(bob)),
      await request(app).get(`/notes/${note.id}/versions`).set(bearer(bob)),
      await request(app).post(`/notes/${note.id}/versions/1/restore`).set(bearer(bob)),
    ]) {
      assert.equal(res.status, 404);
    }

    const bobsList = await request(app).get("/notes").set(bearer(bob));
    assert.equal(bobsList.body.total, 0);

    // …and Alice's note is untouched
    const still = await request(app).get(`/notes/${note.id}`).set(bearer(alice));
    assert.deepEqual([still.body.title, still.body.version], ["Alice's secret", 1]);
  });
});

describe("version history", () => {
  test("every update keeps the previous version, newest first", async () => {
    const app = makeApp();
    const token = await signUp(app);
    const note = await createNote(app, token, { title: "Draft", body: "v1 text" });
    await request(app).patch(`/notes/${note.id}`).set(bearer(token)).send({ body: "v2 text" });
    await request(app).patch(`/notes/${note.id}`).set(bearer(token)).send({ title: "Final" });

    const res = await request(app).get(`/notes/${note.id}/versions`).set(bearer(token));
    assert.equal(res.status, 200);
    assert.equal(res.body.currentVersion, 3);
    assert.deepEqual(
      res.body.versions.map((v) => [v.version, v.title, v.body]),
      [
        [2, "Draft", "v2 text"],
        [1, "Draft", "v1 text"],
      ],
    );
  });

  test("restoring an old version creates a new version and loses nothing", async () => {
    const app = makeApp();
    const token = await signUp(app);
    const note = await createNote(app, token, { title: "Draft", body: "v1 text" });
    await request(app).patch(`/notes/${note.id}`).set(bearer(token)).send({ body: "v2 text" });

    const restored = await request(app).post(`/notes/${note.id}/versions/1/restore`).set(bearer(token));
    assert.equal(restored.status, 200);
    assert.equal(restored.body.body, "v1 text");
    assert.equal(restored.body.version, 3);

    const history = await request(app).get(`/notes/${note.id}/versions`).set(bearer(token));
    assert.deepEqual(history.body.versions.map((v) => v.version), [2, 1]);
    assert.equal(history.body.versions[0].body, "v2 text"); // the replaced content is archived too
  });

  test("restoring a version that does not exist is a 404", async () => {
    const app = makeApp();
    const token = await signUp(app);
    const note = await createNote(app, token);
    const res = await request(app).post(`/notes/${note.id}/versions/9/restore`).set(bearer(token));
    assert.equal(res.status, 404);
  });
});

describe("error handling", () => {
  test("malformed JSON is a 400 in the standard shape", async () => {
    const app = makeApp();
    const res = await request(app).post("/auth/login").set("Content-Type", "application/json").send("{ not json");
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "BAD_JSON");
  });

  test("unknown routes are a JSON 404 and no response ever contains a stack trace", async () => {
    const app = makeApp();
    const res = await request(app).get("/nope");
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, "NOT_FOUND");
    assert.ok(!JSON.stringify(res.body).includes("stack"));
  });

  test("health check", async () => {
    const res = await request(makeApp()).get("/health");
    assert.deepEqual([res.status, res.body], [200, { status: "ok" }]);
  });
});
