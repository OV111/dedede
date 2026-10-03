# Notes API

A multi-user notes REST API with **version history**: every edit keeps the
previous version, you can list a note's history and restore an earlier version.

Built with Node.js 22, Express 5, SQLite (better-sqlite3), JWT and zod. It was
written as a test submission for the Vahoha "Ship It" capstone.

## Run it

### With Docker (one command)

```bash
cp .env.example .env        # then set JWT_SECRET to a long random string
docker compose up --build
```

The API is on http://localhost:3000. The SQLite database lives in a named Docker
volume, so notes survive restarts.

### Without Docker

```bash
cp .env.example .env
npm ci
npm start
```

Requires Node.js 22 or newer.

## Configuration

All settings are environment variables (see `.env.example`). The server refuses
to start without a strong `JWT_SECRET`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `JWT_SECRET` | none, required | Signs login tokens. 16+ characters. |
| `PORT` | `3000` | HTTP port |
| `DATABASE_FILE` | `./data/notes.db` | SQLite file |
| `BCRYPT_ROUNDS` | `12` | Password hashing cost |
| `AUTH_RATE_LIMIT` | `20` | Register/login requests per IP per 15 minutes |

## Tests and lint

```bash
npm test        # node:test + supertest, against an in-memory database
npm run lint    # eslint
```

The tests cover registration and login, validation errors, pagination,
**ownership** (one user can never read, change, delete or restore another user's
note), the version history, rate limiting and the error format.

## API

All `/notes` routes need `Authorization: Bearer <token>` (from register or login).

| Method | Path | Description |
| --- | --- | --- |
| POST | `/auth/register` | `{ email, password }` → `201 { user, token }` |
| POST | `/auth/login` | `{ email, password }` → `200 { user, token }` |
| POST | `/notes` | `{ title, body? }` → `201` the note |
| GET | `/notes?page=1&limit=10` | Your notes, newest first, with `total` and `totalPages` |
| GET | `/notes/:id` | One note |
| PATCH | `/notes/:id` | `{ title?, body? }` → updates, keeping the old version |
| DELETE | `/notes/:id` | `204` |
| GET | `/notes/:id/versions` | `{ currentVersion, versions: [...] }`, previous versions newest first |
| POST | `/notes/:id/versions/:version/restore` | Restores an old version as a **new** version |
| GET | `/health` | `{ status: "ok" }` |

Errors always look like `{ "error": { "code": "...", "message": "...", "details": [...] } }`
with a correct status code (400 validation, 401 auth, 404 not found, 409 duplicate
email, 429 rate limited). Stack traces are never returned.

## Design decisions

- **Ownership is enforced in the query.** Every note statement filters by the
  caller's user id in the same SQL statement, and a note that is not yours is a
  `404`, identical to one that does not exist, so ids cannot be probed.
- **Passwords** are hashed with bcrypt. Login takes the same time and gives the
  same answer for an unknown email and a wrong password.
- **Tokens** are HS256 JWTs valid for one hour; the algorithm is pinned when
  verifying so a token cannot choose its own.
- **Version history.** `notes` holds the current version; `note_versions` holds
  every earlier one. An update copies the current content into `note_versions`
  and overwrites the note in a single transaction. Restoring is just another
  update, so history only ever grows and nothing is lost.
- **Validation** is zod at the route boundary; handlers can trust their input.
- **Central error handler** turns thrown errors into one JSON shape, and
  anything unexpected becomes a generic 500 that is logged, not leaked.
- **Rate limiting** protects register and login from guessing and signup spam.
  Counters are in memory (per process): fine for one instance, use a shared
  store such as Redis before running several.
- **SQLite** keeps the project one `docker compose up` away. For several
  instances you would move to PostgreSQL.

## Project layout

```
src/
  app.js          builds the Express app from a database and a config
  server.js       starts it; graceful shutdown on SIGTERM/SIGINT
  config.js       environment variables, validated at startup
  db.js           schema
  auth.js         register, login, bearer-token middleware, rate limit
  notes.js        CRUD, pagination, version history
  validation.js   zod schemas and the validate() middleware
  errors.js       AppError and the central handler
tests/notes.test.js
```
